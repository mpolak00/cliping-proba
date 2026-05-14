import fs from 'fs';
import path from 'path';
import { applyReplacements } from './wordReplacements.js';

export interface Word {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  text: string;
  words: Word[];
}

export async function transcribeVideo(
  videoPath: string
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      text: 'Transkripcija nije dostupna (dodaj OPENAI_API_KEY u environment varijable)',
      words: [],
    };
  }

  try {
    // Dynamically import OpenAI so the server still starts without the key
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey });

    const fileStream = fs.createReadStream(videoPath);
    const ext = path.extname(videoPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
    };

    const response = await openai.audio.transcriptions.create({
      file: fileStream as unknown as File,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
      language: 'hr',
    });

    const rawText = (response as { text: string }).text || '';
    const rawWords: Word[] = ((response as { words?: { word: string; start: number; end: number }[] }).words || []).map(
      (w) => ({
        word: w.word,
        start: w.start,
        end: w.end,
      })
    );

    const processedText = applyReplacements(rawText);
    const processedWords = rawWords.map((w) => ({
      ...w,
      word: applyReplacements(w.word),
    }));

    return {
      text: processedText,
      words: processedWords,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[transcribe] OpenAI Whisper error:', message);
    return {
      text: `Greška pri transkripciji: ${message}`,
      words: [],
    };
  }
}
