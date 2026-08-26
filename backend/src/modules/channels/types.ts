/**
 * types.ts — ChannelProvider abstraction cho multi-channel messaging (2026-08-26).
 *
 * Mỗi kênh ngoài Zalo (messenger, telegram, whatsapp...) implement interface này.
 * Zalo KHÔNG implement provider — code path Zalo giữ nguyên trong modules/zalo +
 * chat-routes; abstraction này chỉ phục vụ conv có `provider != 'zalo'`.
 * Lý do: zca-js listener/pool quá khác biệt webhook-based platforms — bọc Zalo vào
 * interface chỉ để "đẹp" sẽ phải refactor 52 file đang chạy vì lợi ích không rõ.
 *
 * Luồng inbound:  platform webhook → provider.parseWebhook() → NormalizedInbound[]
 *                 → handleIncomingMessage() (message-handler, channel-aware)
 * Luồng outbound: route → ChannelRouter.send() → provider.sendMessage()
 */

export type ChannelProviderName = 'messenger' | 'telegram' | 'whatsapp';

/** Capability matrix — FE mirror ở frontend/src/constants/channel-capabilities.ts */
export interface ChannelCapabilities {
  text: boolean;
  image: boolean;
  file: boolean;
  voice: boolean;
  video: boolean;
  sticker: boolean;
  /** Thu hồi tin đã gửi (Zalo undo) — Messenger false */
  undo: boolean;
  reactions: boolean;
  quoteReply: boolean;
  editMessage: boolean;
  typingIndicator: boolean;
  readReceipts: boolean;
  groupThreads: boolean;
}

/** Row shape tối thiểu của ChannelAccount mà provider cần khi gửi tin. */
export interface ChannelAccountRow {
  id: string;
  orgId: string;
  provider: string;
  externalId: string;
  displayName: string | null;
  /** Đã decrypt sẵn — router chịu trách nhiệm decrypt trước khi gọi provider. */
  accessToken: string;
  status: string;
}

/**
 * Chuẩn hóa inbound event — CỐ TÌNH giữ shape giống `IncomingMessage` của
 * message-handler.ts + thêm `provider`, để handleIncomingMessage chỉ cần thay đổi
 * tối thiểu. Xem IncomingMessage để ý nghĩa từng field.
 */
export interface NormalizedInbound {
  provider: ChannelProviderName;
  accountId: string; // ChannelAccount.id
  senderUid: string; // PSID / chat_id / wa_id
  senderName: string;
  content: string;
  contentType: 'text' | 'image' | 'file' | 'voice' | 'video' | 'link';
  msgId: string; // external msg id (FB mid...) — dedup qua Message.externalMsgId
  timestamp: number; // epoch ms
  isSelf: boolean; // echo event (page tự gửi từ Inbox FB)
  threadId: string; // = senderUid cho DM 1-1 (MVP không hỗ trợ group FB)
  threadType: 'user';
  attachments?: Array<Record<string, unknown>>; // shape chuẩn CRM (giống Zalo attachments JSON)
  quote?: unknown;
  /** URL gốc của attachment trên CDN nền tảng — persistence tự tải lên MinIO nếu cần */
  sourceUrl?: string;
}

export interface OutboundPayload {
  text?: string;
  /** Attachment đã upload MinIO — public URL. Provider gửi qua attachment_url. */
  attachments?: Array<{
    kind: 'image' | 'file' | 'voice' | 'video';
    url: string;
    mimeType?: string;
    fileName?: string;
  }>;
  /** Reply-to external msg id (nếu capability.quoteReply) */
  replyToExternalMsgId?: string;
}

export interface SendResult {
  externalMsgId: string;
  raw?: unknown;
}

export class CapabilityError extends Error {
  statusCode = 400;
  code = 'CAPABILITY_UNSUPPORTED';
  constructor(capability: string, provider: string) {
    super(`Channel '${provider}' does not support '${capability}'`);
  }
}

export interface ChannelProvider {
  readonly name: ChannelProviderName;
  readonly capabilities: ChannelCapabilities;

  /** GET /webhook verify — trả challenge string nếu hợp lệ, null nếu từ chối. */
  verifyWebhook(query: Record<string, string>): string | null;

  /** POST /webhook — verify HMAC + parse body thành normalized events.
   *  Ném Error nếu signature sai (route trả 401). Trả [] nếu body hợp lệ nhưng
   *  không chứa event relevant (delivery/read vẫn trả events riêng). */
  parseWebhook(rawBody: Buffer, signature?: string): Promise<NormalizedInbound[]>;

  /** Gửi tin ra ngoài. Router đảm bảo payload nằm trong capabilities. */
  sendMessage(
    channelAccount: ChannelAccountRow,
    externalThreadId: string,
    payload: OutboundPayload,
  ): Promise<SendResult>;

  /** Fetch profile của external user (name/avatar) — best-effort, trả null khi fail. */
  fetchProfile(channelAccount: ChannelAccountRow, externalUserId: string): Promise<{ fullName?: string; avatarUrl?: string } | null>;

  /** Kiểm tra messaging window (vd Messenger 24h rule). Trả true = được phép gửi. */
  canSendMessage(lastInboundAt: Date | null): { allowed: boolean; reason?: string };
}
