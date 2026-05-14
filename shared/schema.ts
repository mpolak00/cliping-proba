import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(), // pending | processing | done | error
  inputPath: text('input_path'),
  outputPath: text('output_path'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
