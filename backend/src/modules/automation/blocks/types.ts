// Phase 7 — Block types & content schema.
//
// Block.actionType discriminates content shape. Engine reads block.content
// based on actionType to dispatch to the right action handler.
//
// Phase G ship first 3 actions: request_friend, send_message, update_status.
// Other actionTypes here are reserved for future phases (do NOT remove from
// the enum — UI components key off these strings).

export type BlockChannel = 'zalo_user';

export type BlockActionType =
  | 'request_friend'
  | 'send_message'
  | 'update_status'
  // Reserved for future phases:
  | 'send_image'
  | 'send_file'
  | 'send_template'
  | 'add_tag'
  | 'remove_tag'
  | 'assign_user'
  | 'update_lead_score';

export const SUPPORTED_ACTION_TYPES: readonly BlockActionType[] = [
  'request_friend',
  'send_message',
  'update_status',
  'add_tag',
  'remove_tag',
  'assign_user',
];

// ── Content shapes per actionType ──────────────────────────────────────────
//
// `*Variants` arrays let a single block carry multiple wordings; engine picks
// one randomly at execution time to vary outgoing text across nicks (memory:
// project_zalocrm_phase7_automation — template variation per nick).

// A/B variant strategy: 'random' picks uniformly at runtime; 'even_split'
// hashes a seed (taskId) so retries keep the same variant mid-flow.
export type VariantStrategy = 'random' | 'even_split';

export interface RequestFriendContent {
  greetingVariants: string[]; // 1+ entries, engine picks one per execution
  variantStrategy?: VariantStrategy;
}

export interface MessageAttachment {
  kind: 'image' | 'video' | 'file' | 'link';
  url: string;
  caption?: string;
  // Optional: thumbnail for video, alt text for image
  thumbnailUrl?: string;
  altText?: string;
}

export interface SendMessageContent {
  textVariants: string[];
  attachments?: MessageAttachment[];
  variantStrategy?: VariantStrategy;
}

export interface UpdateStatusContent {
  statusId: string;
  // Optional: only apply if contact currently in one of these statuses
  onlyFromStatusIds?: string[];
}

// Phase 7+ — tag/assign actions (no Zalo SDK touch, like update_status)
export interface TagContent {
  tags: string[];
}

export interface AssignUserContent {
  userId: string;
}

export type BlockContent =
  | RequestFriendContent
  | SendMessageContent
  | UpdateStatusContent
  | TagContent
  | AssignUserContent;

// ── Validators ─────────────────────────────────────────────────────────────
//
// Each returns `{ ok: true }` or `{ ok: false, error: 'human readable msg' }`.
// Called by block routes on create/update + by engine before execute.

function validateVariantStrategy(value: unknown): { ok: true } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (value !== 'random' && value !== 'even_split') {
    return { ok: false, error: "variantStrategy phải là 'random' hoặc 'even_split'" };
  }
  return { ok: true };
}

export function validateBlockContent(
  actionType: BlockActionType,
  content: unknown,
): { ok: true } | { ok: false; error: string } {
  if (typeof content !== 'object' || content === null) {
    return { ok: false, error: 'content phải là object' };
  }
  const c = content as Record<string, unknown>;

  switch (actionType) {
    case 'request_friend': {
      const variants = c.greetingVariants;
      if (!Array.isArray(variants) || variants.length === 0) {
        return { ok: false, error: 'greetingVariants phải là mảng có ít nhất 1 phần tử' };
      }
      if (!variants.every((v) => typeof v === 'string' && v.trim().length > 0)) {
        return { ok: false, error: 'mỗi greetingVariant phải là chuỗi không rỗng' };
      }
      return validateVariantStrategy(c.variantStrategy);
    }

    case 'send_message': {
      const variants = c.textVariants;
      if (!Array.isArray(variants) || variants.length === 0) {
        return { ok: false, error: 'textVariants phải là mảng có ít nhất 1 phần tử' };
      }
      if (!variants.every((v) => typeof v === 'string' && v.trim().length > 0)) {
        return { ok: false, error: 'mỗi textVariant phải là chuỗi không rỗng' };
      }
      const strategyResult = validateVariantStrategy(c.variantStrategy);
      if (!strategyResult.ok) return strategyResult;
      const atts = c.attachments;
      if (atts !== undefined) {
        if (!Array.isArray(atts)) return { ok: false, error: 'attachments phải là mảng' };
        for (const att of atts) {
          if (typeof att !== 'object' || att === null) {
            return { ok: false, error: 'mỗi attachment phải là object' };
          }
          const a = att as Record<string, unknown>;
          if (!['image', 'video', 'file', 'link'].includes(a.kind as string)) {
            return { ok: false, error: 'attachment.kind phải là image | video | file | link' };
          }
          if (typeof a.url !== 'string' || !a.url) {
            return { ok: false, error: 'attachment.url phải là chuỗi không rỗng' };
          }
        }
      }
      return { ok: true };
    }

    case 'update_status': {
      if (typeof c.statusId !== 'string' || !c.statusId) {
        return { ok: false, error: 'statusId phải là chuỗi không rỗng' };
      }
      if (c.onlyFromStatusIds !== undefined && !Array.isArray(c.onlyFromStatusIds)) {
        return { ok: false, error: 'onlyFromStatusIds phải là mảng' };
      }
      return { ok: true };
    }

    case 'add_tag':
    case 'remove_tag': {
      const tags = c.tags;
      if (!Array.isArray(tags) || tags.length === 0) {
        return { ok: false, error: 'tags phải là mảng có ít nhất 1 phần tử' };
      }
      if (!tags.every((t) => typeof t === 'string' && t.trim().length > 0)) {
        return { ok: false, error: 'mỗi tag phải là chuỗi không rỗng' };
      }
      return { ok: true };
    }

    case 'assign_user': {
      if (typeof c.userId !== 'string' || !c.userId) {
        return { ok: false, error: 'userId phải là chuỗi không rỗng' };
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: `actionType '${actionType}' chưa được hỗ trợ ở phase này` };
  }
}

export function isSupportedActionType(value: unknown): value is BlockActionType {
  return typeof value === 'string' && SUPPORTED_ACTION_TYPES.includes(value as BlockActionType);
}
