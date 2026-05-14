# PeptidiHR Video Brander v4.3

Server-side video branding tool for PeptidiHR content. Processes short-form videos (9:16) with logos, overlay text, audio pitch/speed correction, colour grading, and optional Whisper AI transcription.

## Tech Stack

- **Backend**: Node.js + TypeScript + Express
- **Video**: fluent-ffmpeg + ffmpeg-static (no system FFmpeg needed)
- **Database**: Drizzle ORM + better-sqlite3 (SQLite)
- **Frontend**: Vanilla TypeScript + Vite + Tailwind CSS CDN
- **AI**: OpenAI Whisper (optional, requires API key)

---

## 1. Replit Deploy (recommended)

1. Fork or import this repo into [Replit](https://replit.com)
2. Open the **Shell** tab and run:
   ```bash
   npm install
   npm run dev
   ```
3. Replit will expose port 5000 (API) and 5173 (Vite dev server) automatically.
4. Open the Webview — it will proxy to the Vite frontend.

---

## 2. Adding OPENAI_API_KEY for Whisper Transcription

Whisper transcription is optional. Without it the app runs fully but returns a placeholder text.

**On Replit:**
1. Click the **Secrets** tab (padlock icon)
2. Add key: `OPENAI_API_KEY`, value: your OpenAI API key
3. Restart the server

**Locally:**
Create a `.env` file in the project root:
```
OPENAI_API_KEY=sk-...your-key-here...
```
Then install `dotenv` or use a tool like `dotenv-cli`:
```bash
npx dotenv-cli -e .env -- npm run dev
```

---

## 3. Local Development

### Prerequisites
- Node.js 20+
- npm 9+

### Setup
```bash
# Clone and enter the directory
git clone https://github.com/mpolak00/cliping-proba.git
cd cliping-proba

# Install dependencies (ffmpeg-static downloads the FFmpeg binary automatically)
npm install

# Start dev servers (Express on :5000, Vite on :5173)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

The Vite dev server proxies all `/api/*` requests to Express on port 5000.

### Production Build
```bash
npm run build   # Vite builds client into dist/public/
npm start       # Express serves everything on port 5000
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/upload` | Upload video + logo + outroImage |
| `POST` | `/api/process` | Start FFmpeg processing job |
| `GET` | `/api/progress/:jobId` | SSE stream for real-time progress |
| `GET` | `/api/download/:jobId` | Stream finished MP4 |
| `POST` | `/api/transcribe` | Whisper AI transcription |

---

## Features

- **9:16 Auto-crop** — landscape videos get side-cropped; portrait gets padded
- **Colour grading** — brightness, contrast, saturation sliders
- **Film grain + vignette** — authentic look
- **Horizontal flip** — bypass similarity detection
- **Logo overlay** — 4 corner positions, size & opacity control
- **Overlay text** — custom text, colour, size at bottom of frame
- **Pitch shift** — ±15% without affecting speed
- **Speed control** — 0.8x–1.4x
- **Audio normalisation** — compand + volume boost
- **Outro** — 2s branded end screen with image + text
- **Whisper AI** — Croatian language transcription with brand word replacements
- **Auto-randomisation** — slight brightness/saturation/pitch variance per export to avoid duplicate fingerprints
- **SQLite job tracking** — persisted job state, auto-cleanup after 24h
- **SSE progress** — real-time progress bar in browser

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Express server port |
| `NODE_ENV` | `development` | Set to `production` for static serving |
| `OPENAI_API_KEY` | *(none)* | Required for Whisper transcription |
| `ALLOWED_ORIGIN` | `*` | CORS allowed origin in production |
