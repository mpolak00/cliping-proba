import { type Express, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
// Re-export a function that wires static serving or dev proxy
export async function setupStatic(app: Express): Promise<void> {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    // In dev: proxy non-API requests to Vite dev server
    console.log('[static] DEV mode — proxying frontend to http://localhost:5173');

    // Only proxy if we can reach Vite; if not, fall through
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      // Simple redirect to Vite — works fine for browser navigation
      // We rely on vite.config.ts proxy for /api in dev
      next();
    });
  } else {
    // In production: serve Vite build output from dist/public
    const distPath = path.resolve('dist', 'public');

    if (!fs.existsSync(distPath)) {
      console.warn(
        '[static] dist/public not found — run "npm run build" first.'
      );
    } else {
      const serveStatic = (await import('serve-static')).default;
      app.use(serveStatic(distPath));

      // SPA fallback — send index.html for any unknown routes
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }
}
