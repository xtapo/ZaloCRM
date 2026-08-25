/**
 * activity-types.ts — UI mapping cho ActivityLog (icon, label tiếng Việt,
 * default visibility trong compact timeline).
 *
 * Backend tham chiếu trong:
 *   backend/src/modules/activity/action-types.ts
 *
 * Default visibility:
 *   true  = mặc định HIỆN trong compact view (timeline panel Ghi chú)
 *   false = mặc định ẨN, user tự bật trong settings (sync nhiều, có thể nhiễu)
 *
 * Màu category bám theo design token trong src/style.css (--smax-*) và
 * BRAND trong src/constants/chart-theme.ts — không dùng palette Material cũ.
 */

export type ActivityCategory =
  | 'customer_info'
  | 'tags_crm'
  | 'tags_zalo'
  | 'status_care'
  | 'score'
  | 'appointment'
  | 'interaction'
  | 'system'
  | 'automation'
  | 'security'
  | 'auth'
  | 'admin';

export interface CategoryMeta {
  label: string;
  icon: string;
  color: string;
  defaultVisible: boolean;
}

export const CATEGORY_META: Record<ActivityCategory, CategoryMeta> = {
  customer_info: { label: 'Thông tin KH',  icon: '📝', color: '#16a34a', defaultVisible: true },
  tags_crm:      { label: 'Tag CRM',       icon: '🏷️', color: '#8b5cf6', defaultVisible: true },
  tags_zalo:     { label: 'Tag Zalo',      icon: '🔵', color: '#0ea5e9', defaultVisible: false }, // sync nhiều
  status_care:   { label: 'Trạng thái',    icon: '🔄', color: '#15803d', defaultVisible: true },
  score:         { label: 'Điểm số',       icon: '📈', color: '#f59e0b', defaultVisible: true },
  appointment:   { label: 'Lịch hến',      icon: '📅', color: '#7c3aed', defaultVisible: true },
  interaction:   { label: 'Tương tác',     icon: '💬', color: '#0f766e', defaultVisible: false }, // nhiều event
  system:        { label: 'Hệ thống',      icon: '⚙️', color: '#6b7280', defaultVisible: false },
  automation:    { label: 'Tự động (Bot)', icon: '🤖', color: '#0f6b34', defaultVisible: true }, // bao gồm auto_tag_change — sale cần thấy KH state change
  security:      { label: 'Bảo mật',       icon: '🛡️', color: '#ef4444', defaultVisible: true },
  auth:          { label: 'Đăng nhập',     icon: '🔑', color: '#2563eb', defaultVisible: true },
  admin:         { label: 'Quản trị',      icon: '🛠️', color: '#9333ea', defaultVisible: true },
};

/* Action-level metadata — icon đặc biệt + label động cho từng action.
 * Nếu action không có ở đây → fallback CATEGORY_META[category].icon + action raw. */
export interface ActionMeta {
  label: string;
  icon?: string;
}

export const ACTION_META: Record<string, ActionMeta> = {
  // customer_info
  customer_update:         { label: 'Cập nhật thông tin' },
  customer_create:         { label: 'Tạo KH', icon: '✨' },
  customer_rename:         { label: 'Đổi tên' },
  customer_phone_change:   { label: 'Đổi SĐT', icon: '📞' },
  customer_birthday_change:{ label: 'Đổi ngày sinh', icon: '🎂' },
  customer_gender_change:  { label: 'Đổi giới tính' },
  customer_assign:         { label: 'Gán phụ trách', icon: '👤' },
  friend_alias_change:     { label: 'Đổi tên gợi nhớ' },
  friend_zalo_name_change: { label: 'Tên Zalo đổi', icon: '🔄' },

  // tags_crm
  tag_add_crm:    { label: 'Gắn tag', icon: '➕' },
  tag_remove_crm: { label: 'Gỡ tag', icon: '➖' },
  tag_replace_crm:{ label: 'Đổi tag' },

  // tags_zalo
  tag_add_zalo:        { label: 'Gắn tag Zalo' },
  tag_remove_zalo:     { label: 'Gỡ tag Zalo' },
  tag_change_zalo:     { label: 'Chuyển tag Zalo' },
  zalo_label_renamed:  { label: 'Đổi tên tag Zalo' },
  zalo_label_deleted:  { label: 'Xoá tag Zalo' },

  // status_care
  status_change: { label: 'Đổi trạng thái' },

  // score
  score_change: { label: 'Đổi điểm' },

  // appointment
  appointment_create:     { label: 'Tạo lịch hến', icon: '✨' },
  appointment_update:     { label: 'Sửa lịch hến' },
  appointment_complete:   { label: 'Hoàn thành lịch', icon: '✅' },
  appointment_cancel:     { label: 'Huỷ lịch', icon: '❌' },
  appointment_reschedule: { label: 'Dời lịch', icon: '🔁' },
  appointment_no_show:    { label: 'Vắng mặt', icon: '😶' },

  // interaction
  first_inbound:           { label: 'KH nhắn lần đầu', icon: '📩' },
  first_outbound:          { label: 'Mình nhắn lần đầu', icon: '📤' },
  silent_30d:              { label: 'Im lặng 30 ngày', icon: '🔇' },
  call_logged:             { label: 'Đã gọi', icon: '📞' },
  meeting_logged:          { label: 'Đã gặp', icon: '🤝' },

  // system
  contact_link_parent:     { label: 'Liên kết KH cha' },
  contact_unlink_parent:   { label: 'Gỡ liên kết cha' },
  parent_candidate_accept: { label: 'Accept đề xuất cha' },
  contact_merge:           { label: 'Gộp KH' },
  contact_split:           { label: 'Tách KH' },
  data_import:             { label: 'Import dữ liệu', icon: '⬇️' },
  data_export:             { label: 'Export dữ liệu', icon: '⬆️' },

  // automation
  bot_tag_auto:       { label: 'Bot auto-tag' },
  bot_score_calc:     { label: 'Bot tính điểm' },
  bot_status_suggest: { label: 'Bot suggest status' },
  auto_tag_change:    { label: 'Cập nhật auto-tag', icon: '🤖' },

  // security
  security_scope_denied:     { label: 'Truy cập ngoài phạm vi', icon: '🚫' },
  privacy_locked_access:     { label: 'Truy cập nick riêng tư', icon: '🔒' },
  security_scope_regression: { label: 'Rò rỉ dữ liệu phát hiện', icon: '⚠️' },
  zalo_session_down:         { label: 'Zalo mất kết nối', icon: '🔴' },
  zalo_session_recovered:    { label: 'Zalo kết nối lại', icon: '🟢' },

  // auth
  auth_login:        { label: 'Đăng nhập', icon: '🔑' },
  auth_login_failed: { label: 'Đăng nhập thất bại', icon: '⚠️' },
  auth_setup:        { label: 'Khởi tạo hệ thống', icon: '🚀' },
  password_change_self:   { label: 'Đổi mật khẩu (bản thân)', icon: '🔒' },
  password_change_by_admin: { label: 'Admin đặt lại mật khẩu', icon: '🔑' },

  // admin — users
  user_create: { label: 'Tạo user', icon: '✨' },
  user_update: { label: 'Cập nhật user' },
  user_delete: { label: 'Vô hiệu hoá user', icon: '🚫' },
  user_assign_permission_group: { label: 'Gán nhóm quyền', icon: '👤' },

  // admin — permission groups
  permission_group_create: { label: 'Tạo nhóm quyền', icon: '✨' },
  permission_group_update: { label: 'Cập nhật nhóm quyền' },
  permission_group_delete: { label: 'Xoá nhóm quyền', icon: '🗑️' },

  // admin — departments
  department_create:       { label: 'Tạo phòng ban', icon: '✨' },
  department_update:       { label: 'Cập nhật phòng ban' },
  department_delete:       { label: 'Xoá phòng ban', icon: '🗑️' },
  department_member_add:    { label: 'Thêm thành viên phòng ban', icon: '➕' },
  department_member_remove: { label: 'Gỡ thành viên phòng ban', icon: '➖' },

  // admin — campaign & automation
  campaign_create: { label: 'Tạo chiến dịch', icon: '✨' },
  campaign_update: { label: 'Cập nhật chiến dịch' },
  campaign_delete: { label: 'Xoá chiến dịch', icon: '🗑️' },
  campaign_send:   { label: 'Gửi chiến dịch', icon: '📨' },
  campaign_cancel: { label: 'Huỷ chiến dịch', icon: '❌' },
  automation_rule_create: { label: 'Tạo rule tự động', icon: '✨' },
  automation_rule_update: { label: 'Cập nhật rule tự động' },
  automation_rule_delete: { label: 'Xoá rule tự động', icon: '🗑️' },

  // integrations / zalo
  integration_update:       { label: 'Cập nhật tích hợp', icon: '🔌' },
  integration_delete:       { label: 'Xoá tích hợp', icon: '🗑️' },
  zalo_account_connect:     { label: 'Kết nối Zalo', icon: '🟢' },
  zalo_account_disconnect:  { label: 'Ngắt kết nối Zalo', icon: '🔴' },
  zalo_credentials_export:  { label: 'Export credentials Zalo', icon: '⬆️' },
  zalo_credentials_import:  { label: 'Import credentials Zalo', icon: '⬇️' },
  zalo_access_grant: { label: 'Cấp quyền truy cập Zalo', icon: '🔓' },
  zalo_access_revoke:{ label: 'Thu hồi quyền truy cập Zalo', icon: '🔐' },
};

export function categoryOf(action: string, fallback: ActivityCategory = 'system'): ActivityCategory {
  // Same mapping as backend — duplicate ở FE để render độc lập
  const map: Record<string, ActivityCategory> = {
    customer_update: 'customer_info', customer_create: 'customer_info',
    customer_rename: 'customer_info', customer_phone_change: 'customer_info',
    customer_birthday_change: 'customer_info', customer_gender_change: 'customer_info',
    customer_assign: 'customer_info', friend_alias_change: 'customer_info',
    friend_zalo_name_change: 'customer_info',
    tag_add_crm: 'tags_crm', tag_remove_crm: 'tags_crm', tag_replace_crm: 'tags_crm',
    tag_add_zalo: 'tags_zalo', tag_remove_zalo: 'tags_zalo', tag_change_zalo: 'tags_zalo',
    zalo_label_renamed: 'tags_zalo', zalo_label_deleted: 'tags_zalo',
    status_change: 'status_care',
    score_change: 'score',
    appointment_create: 'appointment', appointment_update: 'appointment',
    appointment_complete: 'appointment', appointment_cancel: 'appointment',
    appointment_reschedule: 'appointment', appointment_no_show: 'appointment',
    first_inbound: 'interaction', first_outbound: 'interaction',
    silent_30d: 'interaction', call_logged: 'interaction', meeting_logged: 'interaction',
    contact_link_parent: 'system', contact_unlink_parent: 'system',
    parent_candidate_accept: 'system', contact_merge: 'system',
    contact_split: 'system', data_import: 'system', data_export: 'system',
    bot_tag_auto: 'automation', bot_score_calc: 'automation', bot_status_suggest: 'automation',
    auto_tag_change: 'automation',
    security_scope_denied: 'security', privacy_locked_access: 'security',
    security_scope_regression: 'security', zalo_session_down: 'security',
    zalo_session_recovered: 'security',
    // auth
    auth_login: 'auth', auth_login_failed: 'auth', auth_setup: 'auth',
    password_change_self: 'auth', password_change_by_admin: 'auth',
    // admin — users & rbac
    user_create: 'admin', user_update: 'admin', user_delete: 'admin',
    user_assign_permission_group: 'admin',
    permission_group_create: 'admin', permission_group_update: 'admin',
    permission_group_delete: 'admin',
    department_create: 'admin', department_update: 'admin', department_delete: 'admin',
    department_member_add: 'admin', department_member_remove: 'admin',
    // campaign & automation
    campaign_create: 'admin', campaign_update: 'admin', campaign_delete: 'admin',
    campaign_send: 'admin', campaign_cancel: 'admin',
    automation_rule_create: 'admin', automation_rule_update: 'admin',
    automation_rule_delete: 'admin',
    // integrations / zalo
    integration_update: 'admin', integration_delete: 'admin',
    zalo_account_connect: 'admin', zalo_account_disconnect: 'admin',
    zalo_credentials_export: 'security', zalo_credentials_import: 'admin',
    zalo_access_grant: 'admin', zalo_access_revoke: 'admin',
  };
  return map[action] || fallback;
}

/** Default visible categories khi user chưa set preference */
export function getDefaultVisibleCategories(): ActivityCategory[] {
  return (Object.entries(CATEGORY_META) as [ActivityCategory, CategoryMeta][])
    .filter(([, m]) => m.defaultVisible)
    .map(([k]) => k);
}

/** All categories list cho settings dropdown */
export const ALL_CATEGORIES: ActivityCategory[] = Object.keys(CATEGORY_META) as ActivityCategory[];
