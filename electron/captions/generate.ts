import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import {
  getPreferredModelPath,
  resolveWhisperExecutablePath,
  downloadWhisperModel,
  getWhisperModelStatus
} from './whisper';

const execFileAsync = promisify(execFile);

export type CaptionWordPayload = {
  text: string;
  startMs: number;
  endMs: number;
  leadingSpace?: boolean;
};

export type CaptionCuePayload = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  words?: CaptionWordPayload[];
};

type WhisperJsonToken = {
  text?: string;
  offsets?: {
    from?: number;
    to?: number;
  };
};

type WhisperJsonSegment = {
  text?: string;
  offsets?: {
    from?: number;
    to?: number;
  };
  tokens?: WhisperJsonToken[];
};

export function parseWhisperJsonWords(tokens: unknown): CaptionWordPayload[] {
  if (!Array.isArray(tokens)) return [];

  const words: CaptionWordPayload[] = [];
  let nextLeadingSpace = false;

  for (const token of tokens) {
    if (!token || typeof token !== 'object') continue;
    const tokenData = token as WhisperJsonToken;
    const tokenText = typeof tokenData.text === 'string' ? tokenData.text : '';

    // Ignore special whisper tokens like [_BEG_], [_TT_100], etc.
    if (!tokenText || /^\[_[^\]]+\]$/.test(tokenText.trim())) {
      continue;
    }

    const tokenStartMs = typeof tokenData.offsets?.from === 'number' ? Math.round(tokenData.offsets.from) : null;
    const tokenEndMs = typeof tokenData.offsets?.to === 'number' ? Math.round(tokenData.offsets.to) : null;

    const parts = tokenText.match(/\s+|[^\s]+/g) ?? [];

    for (const part of parts) {
      if (/^\s+$/.test(part)) {
        nextLeadingSpace = words.length > 0;
        continue;
      }

      const previousWord = words.length > 0 ? words[words.length - 1] : null;
      if (previousWord && !nextLeadingSpace && /^[.,!?;:…]+$/.test(part)) {
        previousWord.text += part;
        continue;
      }

      if (tokenStartMs == null || tokenEndMs == null || tokenEndMs <= tokenStartMs) {
        continue;
      }

      if (!previousWord || nextLeadingSpace) {
        words.push({
          text: part,
          startMs: tokenStartMs,
          endMs: tokenEndMs,
          ...(words.length > 0 && nextLeadingSpace ? { leadingSpace: true } : {})
        });
      } else {
        previousWord.text += part;
        previousWord.endMs = Math.max(previousWord.endMs, tokenEndMs);
      }

      nextLeadingSpace = false;
    }
  }

  return words.filter((w) => w.text.trim().length > 0);
}

export function parseSrtCues(content: string): CaptionCuePayload[] {
  const blocks = content.trim().split(/\r?\n\r?\n/);
  const cues: CaptionCuePayload[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const timeLineIndex = lines[0].includes('-->') ? 0 : 1;
    const timeLine = lines[timeLineIndex];
    if (!timeLine || !timeLine.includes('-->')) continue;

    const [startStr, endStr] = timeLine.split('-->').map((s) => s.trim());
    const startMs = parseSrtTimestamp(startStr);
    const endMs = parseSrtTimestamp(endStr);
    if (startMs == null || endMs == null) continue;

    const textLines = lines.slice(timeLineIndex + 1);
    const text = textLines.join(' ').replace(/<[^>]+>/g, '').trim();
    if (!text) continue;

    cues.push({
      id: `cue-${cues.length + 1}-${startMs}`,
      startMs,
      endMs,
      text
    });
  }

  return cues;
}

function parseSrtTimestamp(ts: string): number | null {
  const match = ts.match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const ms = parseInt(match[4], 10);
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
}

/**
 * Re-segments cues into clean phrases (around 3 to 7 words per cue, breaking on punctuation or pauses)
 * so subtitles don't look like giant walls of text and pop dynamically.
 */
export function resegmentWordsIntoCues(allWords: CaptionWordPayload[], maxWordsPerCue = 6): CaptionCuePayload[] {
  if (allWords.length === 0) return [];

  const cues: CaptionCuePayload[] = [];
  let currentWords: CaptionWordPayload[] = [];

  for (let i = 0; i < allWords.length; i++) {
    const word = allWords[i];
    currentWords.push(word);

    const hasPunctuation = /[.?!]$/.test(word.text);
    const hasComma = /[,;:]$/.test(word.text);
    const isAtLimit = currentWords.length >= maxWordsPerCue;
    const isPause = i < allWords.length - 1 && (allWords[i + 1].startMs - word.endMs > 650);

    if (hasPunctuation || isPause || (isAtLimit && (hasComma || currentWords.length >= 7)) || i === allWords.length - 1) {
      const startMs = currentWords[0].startMs;
      const endMs = currentWords[currentWords.length - 1].endMs;
      const text = currentWords.map((w, idx) => (idx > 0 && w.leadingSpace !== false ? ' ' : '') + w.text).join('').trim();

      if (text) {
        cues.push({
          id: `cue-${cues.length + 1}-${startMs}`,
          startMs,
          endMs,
          text,
          words: [...currentWords]
        });
      }
      currentWords = [];
    }
  }

  return cues;
}

export async function generateCaptions(options: {
  videoPath: string;
  webcamPath?: string;
  language?: string;
  onProgress?: (progress: number) => void;
}): Promise<CaptionCuePayload[]> {
  const videoPath = options.videoPath;
  if (!existsSync(videoPath) && (!options.webcamPath || !existsSync(options.webcamPath))) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  // 1. Resolve Whisper executable
  const whisperExecutable = await resolveWhisperExecutablePath();

  // 2. Resolve Whisper model (auto-download if missing)
  let modelStatus = await getWhisperModelStatus();
  let modelPath = modelStatus.path;
  if (!modelStatus.exists || !modelPath) {
    console.log('[captions] Model not found, downloading default model...');
    modelPath = await downloadWhisperModel((p) => {
      if (options.onProgress) options.onProgress(p);
    });
  }

  // 3. Extract audio to 16kHz mono WAV using ffmpeg
  const tempDir = path.join(app.getPath('temp'), `reframe-captions-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  const wavPath = path.join(tempDir, 'audio.wav');
  const outputBase = path.join(tempDir, 'whisper-out');

  try {
    // Look for ffmpeg binary (ffmpeg-static or system ffmpeg)
    let ffmpegBin = 'ffmpeg';
    try {
      const ffmpegStatic = await import('ffmpeg-static');
      const staticPath = typeof ffmpegStatic?.default === 'string' ? ffmpegStatic.default : null;
      if (staticPath && existsSync(staticPath)) {
        ffmpegBin = staticPath;
      }
    } catch {}

    const audioCandidates: string[] = [];
    if (existsSync(videoPath)) {
      audioCandidates.push(videoPath);
    }
    if (options.webcamPath && existsSync(options.webcamPath) && options.webcamPath !== videoPath) {
      audioCandidates.push(options.webcamPath);
    }

    let audioExtracted = false;
    for (const candidate of audioCandidates) {
      try {
        console.log('[captions] Extracting audio with ffmpeg from:', candidate);
        await execFileAsync(
          ffmpegBin,
          [
            '-y',
            '-i',
            candidate,
            '-vn',
            '-ac',
            '1',
            '-ar',
            '16000',
            '-c:a',
            'pcm_s16le',
            wavPath
          ],
          { timeout: 5 * 60 * 1000 }
        );
        const stat = await fs.stat(wavPath).catch(() => null);
        if (stat && stat.size > 1000) {
          audioExtracted = true;
          break;
        }
      } catch (err) {
        console.warn('[captions] Candidate had no audio or failed:', candidate);
      }
    }

    if (!audioExtracted) {
      throw new Error('No audio stream found in the recording or video file.');
    }

    // 4. Run whisper-cli
    const lang = options.language && options.language.trim() ? options.language.trim() : 'auto';
    const threads = String(Math.max(1, Math.min(8, os.cpus().length || 4)));
    const whisperArgs = [
      '-m',
      modelPath,
      '-f',
      wavPath,
      '-t',
      threads,
      '-nf',
      '-osrt',
      '-ojf',
      '-of',
      outputBase,
      '-l',
      lang,
      '-np',
      '-mc',
      '0'
    ];

    console.log('[captions] Running whisper-cli:', whisperExecutable, whisperArgs.join(' '));
    await execFileAsync(whisperExecutable, whisperArgs, {
      timeout: 10 * 60 * 1000,
      maxBuffer: 25 * 1024 * 1024
    });

    // 5. Read output JSON or SRT
    const jsonPath = `${outputBase}.json`;
    const srtPath = `${outputBase}.srt`;

    if (existsSync(jsonPath)) {
      const jsonRaw = await fs.readFile(jsonPath, 'utf-8');
      const parsed = JSON.parse(jsonRaw) as {
        transcription?: WhisperJsonSegment[];
      };

      if (Array.isArray(parsed.transcription)) {
        const allWords: CaptionWordPayload[] = [];
        for (const seg of parsed.transcription) {
          if (seg.tokens) {
            const segWords = parseWhisperJsonWords(seg.tokens);
            allWords.push(...segWords);
          }
        }

        if (allWords.length > 0) {
          const cues = resegmentWordsIntoCues(allWords);
          if (cues.length > 0) return cues;
        }

        // Fallback: segments directly from whisper
        const segmentCues: CaptionCuePayload[] = [];
        for (let i = 0; i < parsed.transcription.length; i++) {
          const seg = parsed.transcription[i];
          const text = (seg.text ?? '').trim();
          if (!text) continue;
          const startMs = seg.offsets?.from ?? 0;
          const endMs = seg.offsets?.to ?? startMs + 1000;
          segmentCues.push({
            id: `cue-${i + 1}-${startMs}`,
            startMs,
            endMs,
            text,
            words: seg.tokens ? parseWhisperJsonWords(seg.tokens) : undefined
          });
        }
        if (segmentCues.length > 0) return segmentCues;
      }
    }

    // Fallback: parse SRT
    if (existsSync(srtPath)) {
      const srtRaw = await fs.readFile(srtPath, 'utf-8');
      return parseSrtCues(srtRaw);
    }

    return [];
  } finally {
    // Clean up scratch temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}
