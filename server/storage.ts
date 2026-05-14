import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, lt } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { jobs } from '../shared/schema.js';
import type { Job, NewJob } from '../shared/schema.js';

// Ensure data directory exists
const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const sqlite = new Database(path.join(DATA_DIR, 'peptidhr.db'));
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite);

// Create table if it doesn't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    input_path TEXT,
    output_path TEXT,
    error_message TEXT,
    created_at INTEGER
  );
`);

export async function createJob(inputPath?: string): Promise<Job> {
  const newJob: NewJob = {
    id: uuidv4(),
    status: 'pending',
    inputPath: inputPath ?? null,
    outputPath: null,
    errorMessage: null,
    createdAt: new Date(),
  };

  await db.insert(jobs).values(newJob);
  return newJob as Job;
}

export async function updateJob(
  id: string,
  data: Partial<Omit<Job, 'id' | 'createdAt'>>
): Promise<void> {
  await db.update(jobs).set(data).where(eq(jobs.id, id));
}

export async function getJob(id: string): Promise<Job | undefined> {
  const result = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return result[0];
}

export async function cleanupOldJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

  const oldJobs = await db
    .select()
    .from(jobs)
    .where(lt(jobs.createdAt, cutoff));

  for (const job of oldJobs) {
    // Remove associated files
    if (job.inputPath && fs.existsSync(job.inputPath)) {
      try {
        fs.unlinkSync(job.inputPath);
      } catch (e) {
        console.warn('[storage] Could not delete inputPath:', job.inputPath);
      }
    }
    if (job.outputPath && fs.existsSync(job.outputPath)) {
      try {
        fs.unlinkSync(job.outputPath);
      } catch (e) {
        console.warn('[storage] Could not delete outputPath:', job.outputPath);
      }
    }
    await db.delete(jobs).where(eq(jobs.id, job.id));
  }

  if (oldJobs.length > 0) {
    console.log(`[storage] Cleaned up ${oldJobs.length} old job(s).`);
  }
}

// Schedule cleanup every hour
setInterval(
  () => {
    cleanupOldJobs().catch((err) =>
      console.error('[storage] Cleanup error:', err)
    );
  },
  60 * 60 * 1000
);
