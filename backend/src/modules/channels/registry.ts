/**
 * registry.ts — provider lookup theo tên. Import provider mới ở đây (lazy import
 * trong hàm để tránh load Graph client khi không dùng).
 */
import type { ChannelProvider, ChannelProviderName } from './types.js';

const providers = new Map<ChannelProviderName, ChannelProvider>();

export function registerProvider(p: ChannelProvider): void {
  providers.set(p.name, p);
}

export function isProviderName(name: string): name is ChannelProviderName {
  return name === 'messenger' || name === 'telegram' || name === 'whatsapp';
}

export async function getProvider(name: string): Promise<ChannelProvider | null> {
  if (!isProviderName(name)) return null; // 'zalo' + tên lạ → code path riêng / không hỗ trợ
  if (!providers.has(name)) {
    if (name === 'messenger') {
      const mod = await import('./messenger/messenger-provider.js');
      registerProvider(mod.messengerProvider);
    }
    // telegram / whatsapp — thêm nhánh khi implement provider tương ứng
  }
  return providers.get(name) ?? null;
}
