// In-memory storage — no native deps, works on all platforms including Render free tier
import fs from 'fs';

export interface Job {
  id: string;
  status: string;
  inputPath: string | null;
  outputPath: string | null;
  errorMessage: string | null;
  createdAt: Date | null;
}

const jobs = new Map<string, Job>();

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
  if (job) jobs.set(id, { ...job, ...data });
}

export async function getJob(id: string): Promise<Job | undefined> {
  return jobs.get(id);
}

export async function cleanupOldJobs(): Promise<void> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt && job.createdAt.getTime() < cutoff) {
      if (job.inputPath)  try { fs.unlinkSync(job.inputPath);  } catch {}
      if (job.outputPath) try { fs.unlinkSync(job.outputPath); } catch {}
      jobs.delete(id);
    }
  }
}

// Cleanup every hour
setInterval(() => cleanupOldJobs().catch(console.error), 60 * 60 * 1000);
