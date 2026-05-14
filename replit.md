# PeptidiHR Video Brander — Replit Guide

## Overview

This is a full-stack TypeScript application that brands short-form videos for PeptidiHR. It runs on a single Replit instance with two concurrent processes:

- **Express server** (port 5000) — REST API + FFmpeg video processing
- **Vite dev server** (port 5173) — React-free TypeScript frontend

## Running on Replit

The `.replit` file is pre-configured. Simply click **Run** and both servers start via `concurrently`.

```
npm run dev
```

## File Structure

```
├── client/          # Vite frontend (Vanilla TS + Tailwind CDN)
│   ├── index.html   # Single-page app with full UI
│   └── src/
│       ├── main.ts  # Entry point
│       ├── app.ts   # All UI logic (upload, process, SSE, download)
│       └── style.css
├── server/          # Express backend
│   ├── index.ts     # Server bootstrap
│   ├── routes.ts    # All REST endpoints + SSE
│   ├── ffmpeg.ts    # fluent-ffmpeg pipeline
│   ├── storage.ts   # Drizzle ORM + SQLite
│   ├── transcribe.ts # OpenAI Whisper integration
│   ├── static.ts    # Static file serving
│   └── wordReplacements.ts  # Brand word substitutions
├── shared/
│   └── schema.ts    # Drizzle SQLite schema
└── data/            # SQLite database (auto-created)
```

## Secrets Required

Add these in the **Secrets** tab:

| Secret | Required | Purpose |
|--------|----------|---------|
| `OPENAI_API_KEY` | Optional | Whisper AI transcription |

## Ports

| Port | Service |
|------|---------|
| 5000 | Express API |
| 5173 | Vite frontend (dev) |

## Deployment

For production on Replit Deployments:
1. The `.replit` `[deployment]` section runs `npm run build && npm start`
2. Vite builds the frontend into `dist/public/`
3. Express serves `dist/public/` as static files on port 5000

## Notes

- FFmpeg binary is bundled via `ffmpeg-static` — no system FFmpeg needed
- Uploaded files are stored in OS temp directory (`/tmp/uploads/`)
- Jobs are tracked in SQLite at `./data/peptidhr.db`
- Old jobs (>24h) are automatically cleaned up
- All video processing is async; progress is streamed via Server-Sent Events
