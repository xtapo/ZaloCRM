import bcrypt from 'bcryptjs';

const email = process.argv[2];
const password = process.argv[3];
const fullName = process.argv[4] || 'Nhân viên mới';

if (!email || !password) {
  console.log('Cách dùng: node add-user.mjs <email> <password> ["Họ tên"]');
  process.exit(1);
}

import dotenv from 'dotenv';
dotenv.config({ path: '../backend/.env' });
import { prisma } from '../backend/src/shared/database/prisma-client.ts';

async function main() {
  // Tìm org đầu tiên (hoặc default)
  const org = await prisma.organization.findFirst();
  if (!org) {
    console.error('Không tìm thấy Organization nào trong DB. Vui lòng chạy setup trước.');
    process.exit(1);
  }

  const passHash = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        email,
        passwordHash: passHash,
        fullName,
        role: 'member', // Mặc định là member
        isActive: true,
      },
    });
    console.log(`✅ Đã tạo thành công nhân viên: ${user.fullName} (${user.email})`);
    console.log('Bạn có thể vào giao diện Quản lý nhân viên để phân quyền / gán phòng ban cho user này.');
  } catch (error) {
    console.error('❌ Lỗi khi tạo user (có thể email đã tồn tại):', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
