/**
 * messenger-api.ts — Axios wrappers for Messenger channel endpoints.
 * All paths relative to /api/v1 (baseURL set in api/index.ts).
 *
 * Multi-channel 2026-08-26: enable/disable hộp thư Messenger trên page
 * đã kết nối Facebook Lead Ads.
 */
import { api } from '@/api/index';

const MS = '/integrations/messenger';

export interface MessengerChannelAccountDto {
  id: string;
  externalId: string; // page id
  displayName: string;
  avatarUrl: string | null;
  status: 'connected' | 'revoked' | 'error' | 'disabled';
  lastError: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
}

/** List messenger ChannelAccounts của org. */
export async function listMessengerPages(): Promise<MessengerChannelAccountDto[]> {
  const { data } = await api.get<MessengerChannelAccountDto[]>(`${MS}/pages`);
  return data;
}

/** Bật inbox Messenger cho 1 page (subscribe messages + upsert ChannelAccount). */
export async function enableMessengerPage(pageId: string): Promise<{ id: string; status: string }> {
  const { data } = await api.post<{ id: string; status: string }>(
    `${MS}/pages/${pageId}/enable`,
  );
  return data;
}

/** Tắt inbox Messenger (status='disabled' — conv giữ nguyên). */
export async function disableMessengerPage(pageId: string): Promise<{ ok: boolean }> {
  const { data } = await api.post<{ ok: boolean }>(`${MS}/pages/${pageId}/disable`);
  return data;
}
