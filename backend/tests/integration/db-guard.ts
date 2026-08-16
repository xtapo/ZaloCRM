/**
 * db-guard.ts — Database Safety Guard for Integration Tests
 *
 * Chặn đứng mọi nguy cơ chạy integration test lên DB không phải test DB.
 * Bắt buộc thỏa mãn ĐỒNG THỜI cả hai điều kiện:
 * 1. Tên database trong DATABASE_URL phải kết thúc bằng '_test'.
 * 2. Biến môi trường ALLOW_INTEGRATION_DB phải có giá trị '1'.
 */

const dbUrl = process.env.DATABASE_URL || '';

// Trích xuất tên database từ URL (loại bỏ query params nếu có)
const urlWithoutQuery = dbUrl.split('?')[0] || '';
const dbName = urlWithoutQuery.split('/').pop() || '';

const isTestDbName = dbName.endsWith('_test') && dbName.length > 5;
const isExplicitlyAllowed = process.env.ALLOW_INTEGRATION_DB === '1';

if (!dbUrl || !isTestDbName || !isExplicitlyAllowed) {
  const reasons: string[] = [];
  if (!dbUrl) reasons.push('DATABASE_URL chưa được thiết lập');
  if (!isTestDbName) reasons.push(`tên database "${dbName}" không kết thúc bằng "_test"`);
  if (!isExplicitlyAllowed) reasons.push('ALLOW_INTEGRATION_DB !== "1"');

  throw new Error(
    `[GUARD BẢO VỆ DATABASE] BỊ CHẶN: Integration test chỉ được phép chạy khi thỏa mãn cả 2 điều kiện:\n` +
    `  1. Tên database phải kết thúc bằng "_test"\n` +
    `  2. ALLOW_INTEGRATION_DB="1"\n` +
    `Lý do bị từ chối: ${reasons.join(', ')}.\n` +
    `DATABASE_URL hiện tại: "${dbUrl}"`
  );
}
