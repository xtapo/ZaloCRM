/**
 * Validation cho automation rules — dùng chung bởi POST/PUT /automation/rules.
 * Trước khi có module này, body được lưu raw: trigger bất kỳ, conditions/actions
 * JSON mọi hình dạng → engine chạy vào action malformed là nổ runtime (review C2).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';

export const VALID_TRIGGERS = ['message_received', 'contact_created', 'status_changed'] as const;

const VALID_CONDITION_FIELDS = [
  'contact.source',
  'contact.status',
  'contact.assignedUserId',
  'message.content',
  'message.contentType',
  'conversation.unreadCount',
] as const;

const VALID_CONDITION_OPS = ['eq', 'neq', 'contains', 'in', 'gt', 'lt', 'is_empty', 'is_not_empty'] as const;

const VALID_ACTION_TYPES = ['assign_user', 'send_template', 'update_status', 'create_appointment'] as const;

// Giới hạn kích thước — chặn rule khổng lồ treo engine.
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_VALUE = 500;

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && /^[\w-]+$/.test(value);
}

/** Validate + chuẩn hóa payload rule. Trả về lỗi đầu tiên tìm thấy, hoặc null nếu hợp lệ. */
export function validateRulePayload(
  body: Record<string, unknown>,
  mode: 'create' | 'update',
): { error: string } | { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name is required' };
    if (body.name.trim().length > MAX_NAME_LENGTH) return { error: `name must be at most ${MAX_NAME_LENGTH} characters` };
    data.name = body.name.trim();
  } else if (mode === 'create') {
    return { error: 'name is required' };
  }

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') return { error: 'description must be a string' };
    if (typeof body.description === 'string' && body.description.length > MAX_DESCRIPTION_LENGTH) {
      return { error: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters` };
    }
    data.description = body.description;
  }

  if (body.trigger !== undefined) {
    if (!VALID_TRIGGERS.includes(body.trigger as (typeof VALID_TRIGGERS)[number])) {
      return { error: `trigger must be one of: ${VALID_TRIGGERS.join(', ')}` };
    }
    data.trigger = body.trigger;
  } else if (mode === 'create') {
    return { error: `trigger must be one of: ${VALID_TRIGGERS.join(', ')}` };
  }

  if (body.conditions !== undefined || mode === 'create') {
    const conditions = Array.isArray(body.conditions) ? body.conditions : [];
    if (conditions.length > MAX_ARRAY_ITEMS) return { error: `conditions must have at most ${MAX_ARRAY_ITEMS} items` };
    for (const condition of conditions) {
      const err = validateCondition(condition as Record<string, unknown>);
      if (err) return { error: err };
    }
    data.conditions = conditions;
  }

  if (body.actions !== undefined || mode === 'create') {
    const actions = Array.isArray(body.actions) ? body.actions : [];
    if (actions.length > MAX_ARRAY_ITEMS) return { error: `actions must have at most ${MAX_ARRAY_ITEMS} items` };
    for (const action of actions) {
      const err = validateAction(action as Record<string, unknown>);
      if (err) return { error: err };
    }
    data.actions = actions;
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return { error: 'enabled must be a boolean' };
    data.enabled = body.enabled;
  }

  if (body.priority !== undefined) {
    if (typeof body.priority !== 'number' || !Number.isInteger(body.priority)) return { error: 'priority must be an integer' };
    data.priority = Math.max(-1000, Math.min(1000, body.priority));
  }

  return { data };
}

function validateCondition(condition: Record<string, unknown>): string | null {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return 'each condition must be an object';
  if (!VALID_CONDITION_FIELDS.includes(condition.field as (typeof VALID_CONDITION_FIELDS)[number])) {
    return `condition.field must be one of: ${VALID_CONDITION_FIELDS.join(', ')}`;
  }
  if (!VALID_CONDITION_OPS.includes(condition.op as (typeof VALID_CONDITION_OPS)[number])) {
    return `condition.op must be one of: ${VALID_CONDITION_OPS.join(', ')}`;
  }
  // is_empty / is_not_empty không cần giá trị; các op còn lại bắt buộc có
  if (condition.op !== 'is_empty' && condition.op !== 'is_not_empty') {
    if (condition.value === undefined || condition.value === null) {
      return `condition.value is required for op "${condition.op}"`;
    }
    if (Array.isArray(condition.value)) {
      if (condition.value.length > MAX_ARRAY_ITEMS) return 'condition.value array too large';
      if (condition.value.some((v) => typeof v !== 'string' || v.length > MAX_STRING_VALUE)) {
        return `condition.value items must be strings of at most ${MAX_STRING_VALUE} characters`;
      }
    } else if (typeof condition.value === 'number') {
      if (!Number.isFinite(condition.value)) return 'condition.value must be a finite number';
    } else if (typeof condition.value !== 'string' || condition.value.length > MAX_STRING_VALUE) {
      return `condition.value must be a string of at most ${MAX_STRING_VALUE} characters, a number, or a string array`;
    }
  }
  return null;
}

function validateAction(action: Record<string, unknown>): string | null {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return 'each action must be an object';
  switch (action.type) {
    case 'assign_user':
      if (!isValidId(action.userId)) return 'action assign_user requires a valid userId';
      return null;
    case 'send_template':
      if (!isValidId(action.templateId)) return 'action send_template requires a valid templateId';
      return null;
    case 'update_status':
      if (typeof action.status !== 'string' || !action.status || action.status.length > 50) {
        return 'action update_status requires a status string (max 50 chars)';
      }
      return null;
    case 'create_appointment':
      if (action.offsetHours !== undefined) {
        if (typeof action.offsetHours !== 'number' || !Number.isFinite(action.offsetHours) || Math.abs(action.offsetHours) > 24 * 365) {
          return 'action create_appointment.offsetHours must be a finite number within ±8760';
        }
      }
      for (const key of ['typeLabel', 'notes'] as const) {
        if (action[key] !== undefined && (typeof action[key] !== 'string' || (action[key] as string).length > MAX_STRING_VALUE)) {
          return `action create_appointment.${key} must be a string of at most ${MAX_STRING_VALUE} characters`;
        }
      }
      return null;
    default:
      return `action.type must be one of: ${VALID_ACTION_TYPES.join(', ')}`;
  }
}

/**
 * Gắn vào route như preHandler — validate request.body, reply 400 nếu sai.
 * PHẢI là hàm async: với fastify 5.x trên Windows, lifecycle hook đồng bộ
 * làm request treo vĩnh viễn (đã tái hiện bằng script node thuần).
 */
export function ruleValidationPreHandler(mode: 'create' | 'update') {
  return async (request: FastifyRequest<{ Body?: Record<string, unknown> }>, reply: FastifyReply): Promise<void> => {
    const result = validateRulePayload((request.body ?? {}) as Record<string, unknown>, mode);
    if ('error' in result) {
      await reply.status(400).send({ error: result.error });
      return;
    }
    // Gắn payload đã validate/trim để handler không phải validate lại
    (request as FastifyRequest & { validatedRuleBody?: Record<string, unknown> }).validatedRuleBody = result.data;
  };
}
