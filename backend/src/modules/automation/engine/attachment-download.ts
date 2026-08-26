// Automation engine — resolve attachment URL → local temp file for zca-js.
//
// zca-js uploadAttachment only accepts filesystem paths (or Buffer sources);
// a raw http(s) URL fails with "File not found". Video is the exception —
// sendVideo fetches the remote URL itself — so only image/file need this.
//
// Pattern copied from chat-operations-routes.ts (candidateDownloadUrls +
// downloadMediaToTemp): remap public MinIO URL to the internal S3 endpoint,
// fetch with 30s timeout, write into a per-task mkdtemp dir. The caller owns
// cleanup() because handlers run in the background worker, outside any
// request lifecycle.

import { mkdtemp } from 'node:fs/promises';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logger } from '../../../shared/utils/logger.js';
import { config } from '../../../config/index.js';

export interface ResolvedAttachment {
  /** Local filesystem path to pass to zaloOps. */
  filePath: string;
  /** Remove the temp dir. Safe to call multiple times. */
  cleanup: () => Promise<void>;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    const au = new URL(a);
    const bu = new URL(b);
    return au.protocol === bu.protocol && au.host === bu.host;
  } catch {
    return false;
  }
}

function candidateDownloadUrls(url: string): string[] {
  const candidates = [url];
  try {
    if (sameOrigin(url, config.s3PublicUrl)) {
      const publicUrl = new URL(config.s3PublicUrl);
      const endpoint = new URL(config.s3Endpoint);
      const original = new URL(url);
      original.protocol = endpoint.protocol;
      original.host = endpoint.host;
      const publicPath = publicUrl.pathname.replace(/\/$/, '');
      if (publicPath && original.pathname.startsWith(publicPath)) {
        original.pathname = original.pathname.slice(publicPath.length) || '/';
      }
      candidates.push(original.toString());
    }
  } catch {
    // keep original only
  }
  return [...new Set(candidates)];
}

function filenameFromUrl(url: string, fallbackExt: string): string {
  try {
    const name = new URL(url).pathname.split('/').filter(Boolean).pop();
    const cleaned = name ? decodeURIComponent(name).replace(/[^\w.\-() ]+/g, '_') : '';
    if (cleaned && path.extname(cleaned)) return cleaned;
    if (cleaned) return `${cleaned}${fallbackExt}`;
  } catch {
    // fall through
  }
  return `attachment-${Date.now()}${fallbackExt}`;
}

const EXT_BY_KIND: Record<string, string> = {
  image: '.jpg',
  file: '',
};

/**
 * Download an attachment URL to a temp file. Returns null when the URL is
 * not http(s) (assume it's already a local path — pass through untouched).
 */
export async function resolveAttachmentSource(
  url: string,
  kind: 'image' | 'file',
): Promise<ResolvedAttachment | null> {
  if (!/^https?:\/\//i.test(url)) return null;

  const ext = EXT_BY_KIND[kind] ?? '';
  let lastError: unknown;
  for (const candidate of candidateDownloadUrls(url)) {
    try {
      const response = await fetch(candidate, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) throw new Error('empty response');

      const dir = await mkdtemp(path.join(tmpdir(), 'zalocrm-auto-att-'));
      const filePath = path.join(dir, filenameFromUrl(candidate, ext));
      await writeFile(filePath, buffer);
      let cleaned = false;
      return {
        filePath,
        cleanup: async () => {
          if (cleaned) return;
          cleaned = true;
          await rm(dir, { recursive: true, force: true }).catch((err) => {
            logger.warn(`[automation-attachment] temp cleanup failed for ${filePath}:`, err);
          });
        },
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Không tải được attachment để gửi: ${(lastError as Error)?.message ?? String(lastError)}`);
}
