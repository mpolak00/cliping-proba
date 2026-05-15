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
  onProgress?: (progress: number) => void;
}

function randomOffset(range: number): number {
  return (Math.random() * 2 - 1) * range;
}

function buildLogoPosition(
  position: ProcessOptions['logoPosition'],
  size: number,
  margin = 20
): string {
  const h = size;
  const w = size;
  switch (position) {
    case 'TL':
      return `x=${margin}:y=${margin}`;
    case 'TR':
      return `x=W-${w}-${margin}:y=${margin}`;
    case 'BL':
      return `x=${margin}:y=H-${h}-${margin}`;
    case 'BR':
    default:
      return `x=W-${w}-${margin}:y=H-${h}-${margin}`;
  }
}

export function processVideo(options: ProcessOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    // Auto-randomise subtle values to avoid fingerprinting
    const finalBrightness = options.brightness + randomOffset(0.03);
    const finalSaturation = options.saturation + randomOffset(0.1);
    const pitchFactor =
      1 + options.pitchShift / 100 + randomOffset(0.02);
    const speedFactor = options.speed;

    // ──────────────────────────────────────────
    // Video filter chain
    // ──────────────────────────────────────────
    const vfFilters: string[] = [];

    // 1. Scale / crop to 9:16 (1080×1920)
    vfFilters.push(
      [
        `scale=w=1080:h=1920:force_original_aspect_ratio=increase`,
        `crop=1080:1920`,
      ].join(',')
    );

    // 2. Colour corrections
    const eq = [
      `brightness=${finalBrightness.toFixed(4)}`,
      `contrast=${options.contrast.toFixed(4)}`,
      `saturation=${finalSaturation.toFixed(4)}`,
    ].join(':');
    vfFilters.push(`eq=${eq}`);

    // 3. Film grain
    if (options.addGrain) {
      vfFilters.push('noise=c0s=8:c0f=t+u');
    }

    // 4. Vignette
    if (options.addVignette) {
      vfFilters.push('vignette=PI/4');
    }

    // 5. Horizontal flip
    if (options.addFlip) {
      vfFilters.push('hflip');
    }

    // 6. Overlay text (bottom centre)
    if (options.overlayText && options.overlayText.trim().length > 0) {
      const safeText = options.overlayText.replace(/'/g, "\\'").replace(/:/g, '\\:');
      const color = options.textColor.startsWith('#')
        ? options.textColor.slice(1)
        : options.textColor;
      vfFilters.push(
        `drawtext=text='${safeText}':` +
          `fontcolor=0x${color}:` +
          `fontsize=${options.fontSize}:` +
          `x=(w-text_w)/2:` +
          `y=h-text_h-60:` +
          `shadowcolor=black:shadowx=2:shadowy=2`
      );
    }

    // ──────────────────────────────────────────
    // Audio filter chain
    // ──────────────────────────────────────────
    // asetrate changes pitch by adjusting sample rate, then atempo corrects speed
    const newSampleRate = Math.round(44100 * pitchFactor);
    const atempoFactor = speedFactor / pitchFactor;
    // atempo must be between 0.5 and 100; chain multiple if needed
    const atempoFilters: string[] = [];
    let remaining = Math.max(0.5, Math.min(100, atempoFactor));
    while (remaining > 2.0) {
      atempoFilters.push('atempo=2.0');
      remaining /= 2.0;
    }
    while (remaining < 0.5) {
      atempoFilters.push('atempo=0.5');
      remaining /= 0.5;
    }
    atempoFilters.push(`atempo=${remaining.toFixed(6)}`);

    const afFilters = [
      `asetrate=${newSampleRate}`,
      ...atempoFilters,
      'volume=1.5',
      'compand=attacks=0:points=-80/-900|-45/-15|-27/-9|0/-7|20/-7:gain=5',
      'aresample=44100',
    ];

    // ──────────────────────────────────────────
    // Build the command
    // ──────────────────────────────────────────
    let cmd = ffmpeg(options.inputPath);

    // If logo, add it as extra input
    if (options.logoPath && fs.existsSync(options.logoPath)) {
      cmd = cmd.input(options.logoPath);
    }

    // Main video + audio filters
    cmd = cmd
      .videoFilter(vfFilters)
      .audioFilter(afFilters);

    // Logo overlay (complex filtergraph)
    if (options.logoPath && fs.existsSync(options.logoPath)) {
      // Reset and build a full complexFilter chain — no 'copy' placeholders
      cmd = ffmpeg(options.inputPath)
        .input(options.logoPath);

      // Build filter chain dynamically (no 'copy' placeholders)
      const cf: ffmpeg.FilterSpecification[] = [];
      let cur = '0:v';
      let idx = 0;
      const nl = () => `v${idx++}`;

      // Scale + crop to 9:16
      const s1 = nl();
      cf.push({ filter: 'scale', options: 'w=1080:h=1920:force_original_aspect_ratio=increase', inputs: [cur], outputs: [s1] });
      const s2 = nl();
      cf.push({ filter: 'crop', options: '1080:1920', inputs: [s1], outputs: [s2] });
      cur = s2;

      // Color eq
      const s3 = nl();
      cf.push({ filter: 'eq', options: eq, inputs: [cur], outputs: [s3] });
      cur = s3;

      // Grain
      if (options.addGrain) {
        const s4 = nl();
        cf.push({ filter: 'noise', options: 'c0s=8:c0f=t+u', inputs: [cur], outputs: [s4] });
        cur = s4;
      }

      // Vignette
      if (options.addVignette) {
        const s5 = nl();
        cf.push({ filter: 'vignette', options: 'PI/4', inputs: [cur], outputs: [s5] });
        cur = s5;
      }

      // Flip
      if (options.addFlip) {
        const s6 = nl();
        cf.push({ filter: 'hflip', inputs: [cur], outputs: [s6] });
        cur = s6;
      }

      // Drawtext
      if (options.overlayText && options.overlayText.trim().length > 0) {
        const safeText = options.overlayText.replace(/['"\\:]/g, ' ').trim();
        const color = options.textColor.startsWith('#') ? options.textColor.slice(1) : options.textColor;
        const s7 = nl();
        cf.push({
          filter: 'drawtext',
          options: `text='${safeText}':fontcolor=0x${color}:fontsize=${options.fontSize}:x=(w-text_w)/2:y=h-text_h-60:shadowcolor=black:shadowx=2:shadowy=2`,
          inputs: [cur],
          outputs: [s7],
        });
        cur = s7;
      }

      // Logo: scale, rgba, alpha, overlay
      const pos = buildLogoPosition(options.logoPosition, options.logoSize);
      cf.push({ filter: 'scale', options: `${options.logoSize}:-2`, inputs: ['1:v'], outputs: ['ls'] });
      cf.push({ filter: 'format', options: 'rgba', inputs: ['ls'], outputs: ['lr'] });
      cf.push({ filter: 'colorchannelmixer', options: `aa=${options.logoOpacity.toFixed(2)}`, inputs: ['lr'], outputs: ['la'] });
      cf.push({ filter: 'overlay', options: pos, inputs: [cur, 'la'], outputs: ['out'] });

      cmd = cmd
        .complexFilter(cf)
        .map('[out]')
        .audioFilter(afFilters);
    }

    cmd
      .outputOptions([
        '-c:v libx264',
        '-crf 23',
        '-preset ultrafast',
        '-c:a aac',
        '-b:a 128k',
        '-movflags +faststart',
        '-r 30',
        '-pix_fmt yuv420p',
      ])
      .output(options.outputPath)
      .on('start', (cmdLine) => {
        console.log('[ffmpeg] Started:', cmdLine.substring(0, 120) + '...');
      })
      .on('progress', (progress) => {
        if (options.onProgress && progress.percent != null) {
          options.onProgress(Math.min(99, Math.round(progress.percent)));
        }
      })
      .on('end', () => {
        console.log('[ffmpeg] Processing complete:', options.outputPath);
        resolve();
      })
      .on('error', (err, stdout, stderr) => {
        console.error('[ffmpeg] Error:', err.message);
        console.error('[ffmpeg] stderr:', stderr);
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
