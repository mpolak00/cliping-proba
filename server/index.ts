import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { router as apiRouter } from './routes.js';

const app = express();
const PORT = Number(process.env.PORT ?? 5000);

// ──────────────────────────────────────────
// Security middleware
// ──────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // Allow Tailwind CDN + FA CDN in dev
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin:
      process.env.NODE_ENV === 'production'
        ? process.env.ALLOWED_ORIGIN || true
        : true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ──────────────────────────────────────────
// Rate limiting
// ──────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use('/api', limiter);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ──────────────────────────────────────────
// API routes
// ──────────────────────────────────────────
app.use('/api', apiRouter);

// ──────────────────────────────────────────
// Static file serving
// ──────────────────────────────────────────
const isDev = process.env.NODE_ENV !== 'production';

if (!isDev) {
  const distPath = path.resolve('dist', 'public');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    console.warn('[server] dist/public not found — run "npm run build" first.');
  }
} else {
  // In dev, Vite serves the frontend on port 5173
  console.log('[server] DEV mode — Vite serves frontend on http://localhost:5173');
}

// ──────────────────────────────────────────
// Start
// ──────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] PeptidiHR Video Brander running on port ${PORT}`);
  console.log(`[server] API: http://localhost:${PORT}/api/health`);
  if (isDev) {
    console.log(`[server] Frontend: http://localhost:5173`);
  }
});

export default app;
