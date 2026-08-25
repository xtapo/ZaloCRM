/**
 * Pipeline status cấp KH (Contact.status) — dùng chung giữa ContactsView,
 * automation ActionEditor và backend. Trước đây ActionEditor hardcode riêng
 * một bộ status lệch với phần còn lại của app.
 * Phải khớp bộ stage trong backend/src/modules/analytics/reports/conversion-funnel.ts.
 */
export const CONTACT_STATUSES = [
  { value: 'new', label: 'Mới' },
  { value: 'contacted', label: 'Đã liên hệ' },
  { value: 'interested', label: 'Quan tâm' },
  { value: 'converted', label: 'Chuyển đổi' },
  { value: 'lost', label: 'Mất' },
] as const;

export type ContactStatusValue = (typeof CONTACT_STATUSES)[number]['value'];
