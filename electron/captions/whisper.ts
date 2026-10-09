import { createWriteStream, existsSync } from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import { get as httpsGet } from 'node:https';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { app } from 'electron';

export const DEFAULT_MODEL_NAME = 'ggml-base.bin';
export const FALLBACK_MODEL_NAME = 'ggml-tiny.bin';

export const MODEL_DOWNLOAD_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${DEFAULT_MODEL_NAME}`;
export const FALLBACK_DOWNLOAD_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${FALLBACK_MODEL_NAME}`;

export function getModelDirectory(): string {
  return path.join(app.getPath('userData'), 'models');
}

export function getPreferredModelPath(): string {
  const dir = getModelDirectory();
  const defaultPath = path.join(dir, DEFAULT_MODEL_NAME);
  if (existsSync(defaultPath)) return defaultPath;
  const fallbackPath = path.join(dir, FALLBACK_MODEL_NAME);
  if (existsSync(fallbackPath)) return fallbackPath;
  // Also check /tmp/whisper_models if present for quick testing
  const tmpBase = path.join('/tmp', 'whisper_models', DEFAULT_MODEL_NAME);
  if (existsSync(tmpBase)) return tmpBase;
  const tmpTiny = path.join('/tmp', 'whisper_models', FALLBACK_MODEL_NAME);
  if (existsSync(tmpTiny)) return tmpTiny;
  return defaultPath;
}

export async function getWhisperModelStatus(): Promise<{ exists: boolean; path: string | null; name: string }> {
  const modelPath = getPreferredModelPath();
  try {
    await fs.access(modelPath, fsConstants.R_OK);
    return { exists: true, path: modelPath, name: path.basename(modelPath) };
  } catch {
    return { exists: false, path: null, name: DEFAULT_MODEL_NAME };
  }
}

export function downloadFileWithProgress(
  url: string,
  destinationPath: string,
  onProgress: (progress: number) => void
): Promise<void> {
  const request = (currentUrl: string, redirectCount = 0): Promise<void> => {
    return new Promise((resolve, reject) => {
      const req = httpsGet(currentUrl, { timeout: 60_000 }, (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          if (redirectCount >= 8) {
            reject(new Error('Too many redirects while downloading Whisper model.'));
            return;
          }
          const nextUrl = new URL(location, currentUrl).toString();
          void request(nextUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Whisper model download failed with HTTP ${statusCode}`));
          return;
        }

        const totalBytes = Number.parseInt(String(response.headers['content-length'] ?? '0'), 10);
        let downloadedBytes = 0;
        const fileStream = createWriteStream(destinationPath);

        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (Number.isFinite(totalBytes) && totalBytes > 0) {
            onProgress(Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
          }
        });

        response.on('error', (err) => {
          fileStream.destroy(err);
        });

        fileStream.on('error', (err) => {
          response.destroy(err);
          reject(err);
        });

        fileStream.on('finish', () => {
          onProgress(100);
          resolve();
        });

        response.pipe(fileStream);
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timed out while downloading Whisper model.'));
      });
    });
  };

  return request(url);
}

export async function downloadWhisperModel(
  onProgress: (progress: number) => void
): Promise<string> {
  const dir = getModelDirectory();
  await fs.mkdir(dir, { recursive: true });
  const targetPath = path.join(dir, DEFAULT_MODEL_NAME);
  const partPath = `${targetPath}.part`;

  try {
    await downloadFileWithProgress(MODEL_DOWNLOAD_URL, partPath, onProgress);
    await fs.rename(partPath, targetPath);
    return targetPath;
  } catch (err) {
    // If base fails or network is slow, try fallback tiny model
    console.warn('[captions] Base model download failed, trying fallback tiny model...', err);
    const fallbackTargetPath = path.join(dir, FALLBACK_MODEL_NAME);
    const fallbackPartPath = `${fallbackTargetPath}.part`;
    try {
      await downloadFileWithProgress(FALLBACK_DOWNLOAD_URL, fallbackPartPath, onProgress);
      await fs.rename(fallbackPartPath, fallbackTargetPath);
      return fallbackTargetPath;
    } catch (fallbackErr) {
      try {
        if (existsSync(partPath)) await fs.unlink(partPath);
        if (existsSync(fallbackPartPath)) await fs.unlink(fallbackPartPath);
      } catch {}
      throw fallbackErr;
    }
  }
}

export function getNativeArchTag(): string {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  }
  if (platform === 'win32') {
    return arch === 'arm64' ? 'win32-arm64' : 'win32-x64';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  }
  return `${platform}-${arch}`;
}

export async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.R_OK | fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveWhisperExecutablePath(): Promise<string> {
  const archTag = getNativeArchTag();
  const binaryName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';

  const candidates: string[] = [
    // Project root during dev
    path.resolve(process.cwd(), 'electron', 'native', 'bin', archTag, binaryName),
    // Dist / appPath
    path.join(app.getAppPath(), 'electron', 'native', 'bin', archTag, binaryName),
    path.join(app.getAppPath(), 'dist-electron', 'native', 'bin', archTag, binaryName),
    // Unpacked in production
    path.join(process.resourcesPath, 'native', 'bin', archTag, binaryName),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'native', 'bin', archTag, binaryName),
    path.join(process.resourcesPath, binaryName),
    // Temp build if developer just built it
    path.join('/tmp', 'whisper_build', 'build_static', 'bin', 'whisper-cli'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && (await isExecutableFile(candidate))) {
      return candidate;
    }
  }

  // System PATH lookup
  const pathCommand = process.platform === 'win32' ? 'where' : 'which';
  const binaryNames =
    process.platform === 'win32'
      ? ['whisper-cli.exe', 'whisper.exe', 'main.exe']
      : ['whisper-cli', 'whisper-cpp', 'whisper', 'main'];

  for (const name of binaryNames) {
    const result = spawnSync(pathCommand, [name], { encoding: 'utf-8' });
    if (result.status === 0) {
      const resolvedPath = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);

      if (resolvedPath && (await isExecutableFile(resolvedPath))) {
        return resolvedPath;
      }
    }
  }

  throw new Error(`Whisper runtime was not found for ${process.platform}/${process.arch}.`);
}

