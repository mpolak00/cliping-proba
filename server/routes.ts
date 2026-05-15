import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { processVideo, appendOutro, type ProcessOptions } from './ffmpeg.js';
import { createJob, updateJob, getJob } from './storage.js';
import { transcribeVideo } from './transcribe.js';

export const router = Router();

// ──────────────────────────────────────────
// Multer configuration
// ──────────────────────────────────────────
const UPLOAD_DIR = path.join(os.tmpdir(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-matroska',
      'video/x-msvideo',
      'image/png',
      'image/jpeg',
      'image/webp',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// In-memory SSE progress store: jobId → progress (0-100)
const progressMap = new Map<string, number>();
const sseClients = new Map<string, Response[]>();

function emitProgress(jobId: string, progress: number): void {
  progressMap.set(jobId, progress);
  const clients = sseClients.get(jobId) || [];
  for (const client of clients) {
    client.write(`data: ${JSON.stringify({ progress })}\n\n`);
  }
}

// ──────────────────────────────────────────
// Health check
// ──────────────────────────────────────────
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ──────────────────────────────────────────
// POST /api/upload
// ──────────────────────────────────────────
router.post(
  '/upload',
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'logo', maxCount: 1 },
    { name: 'outroImage', maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const files = req.files as Record<string, Express.Multer.File[]>;

      if (!files?.video?.[0]) {
        res.status(400).json({ error: 'Video file is required.' });
        return;
      }

      const videoFile = files.video[0];
      const logoFile = files.logo?.[0];
      const outroImageFile = files.outroImage?.[0];

      const fileId = uuidv4();
      const response: Record<string, string> = {
        fileId,
        videoPath: videoFile.path,
      };

      if (logoFile) response.logoPath = logoFile.path;
      if (outroImageFile) response.outroImagePath = outroImageFile.path;

      // Store paths temporarily (use a simple JSON file keyed by fileId)
      const metaPath = path.join(UPLOAD_DIR, `${fileId}.json`);
      fs.writeFileSync(metaPath, JSON.stringify(response), 'utf-8');

      res.json({ fileId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  }
);

// ──────────────────────────────────────────
// POST /api/process
// ──────────────────────────────────────────
router.post('/process', async (req: Request, res: Response) => {
  try {
    const { fileId, options } = req.body as {
      fileId: string;
      options: Omit<ProcessOptions, 'inputPath' | 'outputPath' | 'onProgress'>;
    };

    if (!fileId) {
      res.status(400).json({ error: 'fileId is required.' });
      return;
    }

    const metaPath = path.join(UPLOAD_DIR, `${fileId}.json`);
    if (!fs.existsSync(metaPath)) {
      res.status(404).json({ error: 'Upload not found. Re-upload the file.' });
      return;
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
      videoPath: string;
      logoPath?: string;
      outroImagePath?: string;
    };

    const outputPath = path.join(UPLOAD_DIR, `out_${uuidv4()}.mp4`);

    const job = await createJob(meta.videoPath);
    await updateJob(job.id, { status: 'processing', outputPath });

    // Respond immediately with jobId
    res.json({ jobId: job.id });

    // Process asynchronously
    (async () => {
      try {
        emitProgress(job.id, 0);

        const processOpts: ProcessOptions = {
          ...options,
          inputPath: meta.videoPath,
          outputPath: options.addOutro
            ? path.join(UPLOAD_DIR, `main_${uuidv4()}.mp4`)
            : outputPath,
          logoPath: meta.logoPath,
          onProgress: (pct) => emitProgress(job.id, pct),
        };

        await processVideo(processOpts);

        if (options.addOutro) {
          emitProgress(job.id, 90);
          await appendOutro(
            processOpts.outputPath,
            options.outroText || '',
            meta.outroImagePath,
            outputPath
          );
          // cleanup intermediate
          try {
            fs.unlinkSync(processOpts.outputPath);
          } catch {}
        }

        await updateJob(job.id, { status: 'done', outputPath });
        emitProgress(job.id, 100);

        // Notify all SSE clients done
        const clients = sseClients.get(job.id) || [];
        for (const c of clients) {
          c.write(`data: ${JSON.stringify({ progress: 100, done: true })}\n\n`);
          c.end();
        }
        sseClients.delete(job.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[process] job error:', message);
        await updateJob(job.id, { status: 'error', errorMessage: message });

        const clients = sseClients.get(job.id) || [];
        for (const c of clients) {
          c.write(`data: ${JSON.stringify({ error: message })}\n\n`);
          c.end();
        }
        sseClients.delete(job.id);
      }
    })();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────
// GET /api/status/:jobId  (simple poll)
// ──────────────────────────────────────────
router.get('/status/:jobId', async (req: Request, res: Response) => {
  const job = await getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found or expired' });
    return;
  }
  res.json({
    status: job.status,
    errorMessage: job.errorMessage ?? null,
    hasOutput: !!(job.outputPath && fs.existsSync(job.outputPath)),
  });
});

// ──────────────────────────────────────────
// GET /api/progress/:jobId  (SSE)
// ──────────────────────────────────────────
router.get('/progress/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send current progress if already started
  const current = progressMap.get(jobId) ?? 0;
  res.write(`data: ${JSON.stringify({ progress: current })}\n\n`);

  const clientList = sseClients.get(jobId) || [];
  clientList.push(res);
  sseClients.set(jobId, clientList);

  req.on('close', () => {
    const list = sseClients.get(jobId) || [];
    const filtered = list.filter((c) => c !== res);
    if (filtered.length === 0) {
      sseClients.delete(jobId);
    } else {
      sseClients.set(jobId, filtered);
    }
  });
});

// ──────────────────────────────────────────
// GET /api/download/:jobId
// ──────────────────────────────────────────
router.get('/download/:jobId', async (req: Request, res: Response) => {
  const { jobId } = req.params;

  const job = await getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }

  if (job.status !== 'done') {
    res.status(400).json({ error: `Job status is '${job.status}', not done.` });
    return;
  }

  if (!job.outputPath || !fs.existsSync(job.outputPath)) {
    res.status(404).json({ error: 'Output file not found.' });
    return;
  }

  const filename = `peptidhr_branded_${Date.now()}.mp4`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'video/mp4');

  const stream = fs.createReadStream(job.outputPath);
  stream.pipe(res);

  stream.on('end', () => {
    // Cleanup after download
    setTimeout(() => {
      try {
        if (job.outputPath) fs.unlinkSync(job.outputPath);
        if (job.inputPath) fs.unlinkSync(job.inputPath);
      } catch {}
      progressMap.delete(jobId);
    }, 5000);
  });
});

// ──────────────────────────────────────────
// POST /api/transcribe
// ──────────────────────────────────────────
router.post('/transcribe', async (req: Request, res: Response) => {
  const { fileId } = req.body as { fileId: string };

  if (!fileId) {
    res.status(400).json({ error: 'fileId is required.' });
    return;
  }

  const metaPath = path.join(UPLOAD_DIR, `${fileId}.json`);
  if (!fs.existsSync(metaPath)) {
    res.status(404).json({ error: 'Upload not found.' });
    return;
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
    videoPath: string;
  };

  try {
    const result = await transcribeVideo(meta.videoPath);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
