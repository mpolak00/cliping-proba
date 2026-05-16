import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Point fluent-ffmpeg at the bundled binary
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

export interface ProcessOptions {
  inputPath: string;
  outputPath: string;
  logoPath?: string;
  logoPosition: 'BR' | 'BL' | 'TR' | 'TL';
  logoSize: number;          // px width of logo
  logoOpacity: number;       // 0.0 – 1.0
  overlayText: string;
  textColor: string;         // hex without #, e.g. "00ff00"
  fontSize: number;
  pitchShift: number;        // -15 to +15 (%)
  speed: number;             // 0.8 – 1.4
  brightness: number;        // -1.0 – 1.0 (ffmpeg eq scale)
  contrast: number;          // 0.0 – 2.0
  saturation: number;        // 0.0 – 3.0
  addGrain: boolean;
  addVignette: boolean;
  addFlip: boolean;
  addOutro: boolean;
  outroText: string;
  outroImagePath?: string;
  resolution?: '1080' | '720' | '540';
  onProgress?: (progress: number) => void;
}

function randomOffset(range: number): number {
  return (Math.random() * 2 - 1) * range;
}


export function processVideo(options: ProcessOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const finalBrightness = options.brightness + randomOffset(0.03);
    const finalSaturation = options.saturation + randomOffset(0.1);
    const pitchFactor = 1 + options.pitchShift / 100 + randomOffset(0.02);
    const speedFactor = options.speed;

    const resMap: Record<string, [number, number]> = { '540': [540, 960], '720': [720, 1280], '1080': [1080, 1920] };
    const [rW, rH] = resMap[options.resolution ?? '720'];

    // ── Video filter string (raw, no fluent-ffmpeg FilterSpecification) ──
    const vfParts: string[] = [
      `scale=w=${rW}:h=${rH}:force_original_aspect_ratio=increase`,
      `crop=${rW}:${rH}`,
      `eq=brightness=${finalBrightness.toFixed(4)}:contrast=${options.contrast.toFixed(4)}:saturation=${finalSaturation.toFixed(4)}`,
    ];
    if (options.addGrain)   vfParts.push('noise=c0s=8:c0f=t+u');
    if (options.addVignette) vfParts.push('vignette=PI/4');
    if (options.addFlip)    vfParts.push('hflip');
    if (options.overlayText?.trim()) {
      const safeText = options.overlayText.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').trim();
      const color = options.textColor.replace(/^#/, '');
      vfParts.push(`drawtext=text='${safeText}':fontcolor=0x${color}:fontsize=${options.fontSize}:x=(w-text_w)/2:y=h-text_h-60:shadowcolor=black:shadowx=2:shadowy=2`);
    }
    const vfStr = vfParts.join(',');

    // ── Audio filter string ──────────────────────────────────────────────
    const newSampleRate = Math.round(44100 * pitchFactor);
    const atempoFactor = speedFactor / pitchFactor;
    const atempoFilters: string[] = [];
    let remaining = Math.max(0.5, Math.min(100, atempoFactor));
    while (remaining > 2.0) { atempoFilters.push('atempo=2.0'); remaining /= 2.0; }
    while (remaining < 0.5) { atempoFilters.push('atempo=0.5'); remaining /= 0.5; }
    atempoFilters.push(`atempo=${remaining.toFixed(6)}`);
    const afStr = [`asetrate=${newSampleRate}`, ...atempoFilters, 'volume=1.5', 'compand=attacks=0:points=-80/-900|-45/-15|-27/-9|0/-7|20/-7:gain=5', 'aresample=44100'].join(',');

    // ── Build command ────────────────────────────────────────────────────
    const hasLogo = !!(options.logoPath && fs.existsSync(options.logoPath));
    let cmd = ffmpeg(options.inputPath);

    if (hasLogo) {
      cmd = cmd.input(options.logoPath!);

      // Logo overlay position
      const m = 20, sz = options.logoSize;
      let ox: string, oy: string;
      switch (options.logoPosition) {
        case 'TL': ox = `${m}`;       oy = `${m}`;       break;
        case 'TR': ox = `W-${sz}-${m}`; oy = `${m}`;     break;
        case 'BL': ox = `${m}`;       oy = `H-${sz}-${m}`; break;
        default:   ox = `W-${sz}-${m}`; oy = `H-${sz}-${m}`; break;
      }

      // Raw filter_complex string — no fluent-ffmpeg API, full control
      const fc = [
        `[0:v]${vfStr}[vout]`,
        `[1:v]scale=${sz}:-2[ls]`,
        `[ls]format=rgba[lr]`,
        `[lr]colorchannelmixer=aa=${options.logoOpacity.toFixed(2)}[la]`,
        `[vout][la]overlay=${ox}:${oy}[vfinal]`,
        `[0:a]${afStr}[afinal]`,
      ].join(';');

      cmd = cmd
        .addOption('-filter_complex', fc)
        .addOption('-map', '[vfinal]')
        .addOption('-map', '[afinal]');
    } else {
      cmd = cmd
        .videoFilter(vfStr)
        .audioFilter(afStr);
    }

    const outputOptions = ['-c:v libx264', '-crf 23', '-preset ultrafast', '-c:a aac', '-b:a 128k', '-movflags +faststart', '-r 30', '-pix_fmt yuv420p'];

    cmd
      .outputOptions(outputOptions)
      .output(options.outputPath)
      .on('start', (cmdLine) => { console.log('[ffmpeg] cmd:', cmdLine.slice(0, 400)); })
      .on('progress', (p) => { if (options.onProgress && p.percent != null) options.onProgress(Math.min(99, Math.round(p.percent))); })
      .on('end', () => { console.log('[ffmpeg] done'); resolve(); })
      .on('error', (err, _stdout, stderr) => {
        console.error('[ffmpeg] error:', err.message);
        console.error('[ffmpeg] stderr:', stderr?.slice(-800));
        reject(new Error(`FFmpeg error: ${err.message}`));
      })
      .run();
  });
}

/**
 * Generate a 2-second outro black frame with optional image + text,
 * then concatenate it to the main processed video.
 */
export function appendOutro(
  mainVideoPath: string,
  outroText: string,
  outroImagePath: string | undefined,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmpOutro = path.join(os.tmpdir(), `outro_${Date.now()}.mp4`);

    // Step 1: generate the 2s outro clip
    const outroFilters: string[] = [];

    // Black 1080x1920 background for 2 seconds
    let outroCmd = ffmpeg()
      .input('color=black:size=1080x1920:rate=30:duration=2')
      .inputFormat('lavfi');

    const complexFilters: ffmpeg.FilterSpecification[] = [];

    if (outroImagePath && fs.existsSync(outroImagePath)) {
      outroCmd = outroCmd.input(outroImagePath);
      complexFilters.push(
        {
          filter: 'scale',
          options: '400:400',
          inputs: ['1:v'],
          outputs: ['img_scaled'],
        },
        {
          filter: 'overlay',
          options: 'x=(W-400)/2:y=(H-400)/2-80',
          inputs: ['0:v', 'img_scaled'],
          outputs: ['bg_with_img'],
        }
      );

      if (outroText && outroText.trim()) {
        complexFilters.push({
          filter: 'drawtext',
          options: {
            text: outroText.replace(/'/g, "\\'"),
            fontcolor: 'white',
            fontsize: '48',
            x: '(w-text_w)/2',
            y: '(h-text_h)/2+180',
            shadowcolor: 'black',
            shadowx: '2',
            shadowy: '2',
          },
          inputs: ['bg_with_img'],
          outputs: ['outro'],
        });
      } else {
        complexFilters.push({
          filter: 'null',
          inputs: ['bg_with_img'],
          outputs: ['outro'],
        });
      }
    } else {
      if (outroText && outroText.trim()) {
        complexFilters.push({
          filter: 'drawtext',
          options: {
            text: outroText.replace(/'/g, "\\'"),
            fontcolor: 'white',
            fontsize: '48',
            x: '(w-text_w)/2',
            y: '(h-text_h)/2',
            shadowcolor: 'black',
            shadowx: '2',
            shadowy: '2',
          },
          inputs: ['0:v'],
          outputs: ['outro'],
        });
      } else {
        complexFilters.push({
          filter: 'null',
          inputs: ['0:v'],
          outputs: ['outro'],
        });
      }
    }

    outroCmd
      .complexFilter(complexFilters)
      .map('[outro]')
      .outputOptions([
        '-c:v libx264',
        '-crf 23',
        '-t 2',
        '-an',
        '-pix_fmt yuv420p',
        '-r 30',
      ])
      .output(tmpOutro)
      .on('end', () => {
        // Step 2: concat main + outro
        const concatListPath = path.join(os.tmpdir(), `concat_${Date.now()}.txt`);
        fs.writeFileSync(
          concatListPath,
          `file '${mainVideoPath.replace(/\\/g, '/')}'\nfile '${tmpOutro.replace(/\\/g, '/')}'\n`
        );

        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f concat', '-safe 0'])
          .outputOptions([
            '-c:v libx264',
            '-crf 23',
            '-c:a aac',
            '-b:a 128k',
            '-movflags +faststart',
            '-pix_fmt yuv420p',
          ])
          .output(outputPath)
          .on('end', () => {
            // cleanup tmp files
            try {
              fs.unlinkSync(tmpOutro);
              fs.unlinkSync(concatListPath);
            } catch {}
            resolve();
          })
          .on('error', (err) => {
            reject(new Error(`Outro concat error: ${err.message}`));
          })
          .run();
      })
      .on('error', (err) => {
        reject(new Error(`Outro generation error: ${err.message}`));
      })
      .run();
  });
}
