// Hybrid storage: in-memory Map + JSON file persistence
// Videos survive server sleep (file persists), but not redeploys
import fs from 'fs';
import path from 'path';

export interface Job {
  id: string;
  status: string;
  inputPath: string | null;
  outputPath: string | null;
  errorMessage: string | null;
  createdAt: Date | null;
}

const JOBS_FILE = '/tmp/brander-jobs.json';
const jobs = new Map<string, Job>();

// Load persisted jobs on startup
function loadFromDisk(): void {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8')) as Record<string, Job>;
      for (const [id, job] of Object.entries(raw)) {
        // Only restore done jobs (others are stale)
        if (job.status === 'done' && job.outputPath && fs.existsSync(job.outputPath)) {
          jobs.set(id, { ...job, createdAt: job.createdAt ? new Date(job.createdAt as unknown as string) : null });
        }
      }
      console.log(`[storage] Loaded ${jobs.size} persisted job(s) from disk`);
    }
  } catch (e) {
    console.warn('[storage] Could not load persisted jobs:', e);
  }
}

function saveToDisk(): void {
  try {
    const obj: Record<string, Job> = {};
    for (const [id, job] of jobs.entries()) {
      obj[id] = job;
    }
    fs.writeFileSync(JOBS_FILE, JSON.stringify(obj), 'utf-8');
  } catch (e) {
    console.warn('[storage] Could not persist jobs:', e);
  }
}

loadFromDisk();

export async function createJob(inputPath?: string): Promise<Job> {
  const { v4: uuidv4 } = await import('uuid');
  const job: Job = {
    id: uuidv4(),
    status: 'pending',
    inputPath: inputPath ?? null,
    outputPath: null,
    errorMessage: null,
    createdAt: new Date(),
  };
  jobs.set(job.id, job);
  return job;
}

export async function updateJob(
  id: string,
  data: Partial<Omit<Job, 'id' | 'createdAt'>>
): Promise<void> {
  const job = jobs.get(id);
  if (job) {
    jobs.set(id, { ...job, ...data });
    saveToDisk();
  }
}

export async function getJob(id: string): Promise<Job | undefined> {
  return jobs.get(id);
}

export async function cleanupOldJobs(): Promise<void> {
  const cutoff = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 dana
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt && new Date(job.createdAt).getTime() < cutoff) {
      if (job.inputPath)  try { fs.unlinkSync(job.inputPath);  } catch {}
      if (job.outputPath) try { fs.unlinkSync(job.outputPath); } catch {}
      jobs.delete(id);
    }
  }
  saveToDisk();
}

setInterval(() => cleanupOldJobs().catch(console.error), 60 * 60 * 1000);
