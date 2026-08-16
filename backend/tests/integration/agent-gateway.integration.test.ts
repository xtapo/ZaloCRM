/**
 * agent-gateway.integration.test.ts — Real DB Integration Tests for Agent Privacy & Tenant Gateway
 *
 * YÊU CẦU:
 * 1. Chạy trên PostgreSQL thật (zalo-crm-db-dev). TUYỆT ĐỐI KHÔNG vi.mock.
 * 2. Xác thực triệt để các ràng buộc bảo mật:
 *    - Privacy PIN isolation: Contact/Conversation gắn với main-nick hoàn toàn vô hình.
 *    - Multi-tenant isolation: Org A không thể truy cập Contact/Conversation của Org B.
 *    - Message query: Bắt buộc conversationId hoặc contactId, sort desc + reverse ra asc.
 *    - Allow-list select: Không lộ bất kỳ trường nhạy cảm nào (notes, preview, demographic).
 *    - Merged contact exclusion: Contact đã mergedInto != null bị loại bỏ hoàn toàn.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../src/shared/database/prisma-client.js';
import {
  getSafeContactForAgent,
  findSafeContactsForAgent,
  getSafeMessagesForAgent,
  SAFE_CONTACT_SELECT,
  SAFE_MESSAGE_SELECT,
} from '../../src/modules/agent/gateway/agent-gateway.js';

describe('Agent Gateway Integration Tests (Real DB without mock)', () => {
  const TEST_PREFIX = `test_agent_${Date.now()}`;

  // Tenant 1
  const org1Id = `${TEST_PREFIX}_org_1`;
  const user1Id = `${TEST_PREFIX}_user_1`;
  const accMain1Id = `${TEST_PREFIX}_acc_main_1`;
  const accSub1Id = `${TEST_PREFIX}_acc_sub_1`;
  const contactAId = `${TEST_PREFIX}_contact_a`; // Sub nick friend only
  const contactBId = `${TEST_PREFIX}_contact_b`; // Main nick friend (private)
  const contactMergedId = `${TEST_PREFIX}_contact_merged`; // Merged into contact A
  const convSub1Id = `${TEST_PREFIX}_conv_sub_1`;
  const convMain1Id = `${TEST_PREFIX}_conv_main_1`;
  const msgSub1Id = `${TEST_PREFIX}_msg_sub_1`;
  const msgSub2Id = `${TEST_PREFIX}_msg_sub_2`;
  const msgMain1Id = `${TEST_PREFIX}_msg_main_1`;
  const msgMain2Id = `${TEST_PREFIX}_msg_main_2`;

  // Kịch bản hỗn hợp (Contact B có conv trên sub-nick)
  const convSubBId = `${TEST_PREFIX}_conv_sub_b`;
  const msgSubB1Id = `${TEST_PREFIX}_msg_sub_b1`;
  const msgSubB2Id = `${TEST_PREFIX}_msg_sub_b2`;

  // Vỏ đã gộp (ContactMerged có conv trên sub-nick)
  const convSubMergedId = `${TEST_PREFIX}_conv_sub_merged`;
  const msgSubMerged1Id = `${TEST_PREFIX}_msg_sub_merged_1`;
  const msgSubMerged2Id = `${TEST_PREFIX}_msg_sub_merged_2`;

  // Tenant 2 (Cross-tenant check)
  const org2Id = `${TEST_PREFIX}_org_2`;
  const user2Id = `${TEST_PREFIX}_user_2`;
  const accSub2Id = `${TEST_PREFIX}_acc_sub_2`;
  const contactOrg2Id = `${TEST_PREFIX}_contact_org2`;
  const convSub2Id = `${TEST_PREFIX}_conv_sub_2`;
  const msgSub2_1Id = `${TEST_PREFIX}_msg_sub2_1`;

  beforeAll(async () => {
    // 1. Tạo Org 1 & User 1
    await prisma.organization.create({
      data: {
        id: org1Id,
        name: 'Test Org 1 Agent',
      },
    });

    await prisma.user.create({
      data: {
        id: user1Id,
        orgId: org1Id,
        email: `${TEST_PREFIX}_u1@test.com`,
        passwordHash: 'hash',
        fullName: 'User Org 1',
        role: 'admin',
      },
    });

    // 2. Tạo 2 ZaloAccount cho Org 1: 1 main, 1 sub
    await prisma.zaloAccount.create({
      data: {
        id: accMain1Id,
        orgId: org1Id,
        ownerUserId: user1Id,
        zaloUid: `${TEST_PREFIX}_zalo_main_1`,
        displayName: 'Nick Main Riêng Tư',
        privacyMode: 'main',
      },
    });

    await prisma.zaloAccount.create({
      data: {
        id: accSub1Id,
        orgId: org1Id,
        ownerUserId: user1Id,
        zaloUid: `${TEST_PREFIX}_zalo_sub_1`,
        displayName: 'Nick Sub Công Khai',
        privacyMode: 'sub',
      },
    });

    // 3. Tạo Contacts cho Org 1
    // Contact A: Khách công khai, chỉ kết bạn với nick sub
    await prisma.contact.create({
      data: {
        id: contactAId,
        orgId: org1Id,
        fullName: 'Khách A Sub Only',
        crmName: 'CRM Khách A',
        phone: '0901000001',
        phoneNormalized: '0901000001',
        zaloUid: `${TEST_PREFIX}_uid_a`,
        leadScore: 80,
        priorityScore: 85,
        notes: 'Ghi chú nội bộ nhạy cảm không được lộ',
        lastInboundPreview: 'Tin nhắn preview nhạy cảm',
        gender: 'male',
        birthYear: 1990,
        addressLine: '123 Đường ABC',
      },
    });

    // Friend row: Contact A <-> Nick Sub 1
    await prisma.friend.create({
      data: {
        id: `${TEST_PREFIX}_friend_a_sub`,
        orgId: org1Id,
        contactId: contactAId,
        zaloAccountId: accSub1Id,
        zaloUidInNick: `${TEST_PREFIX}_uid_a`,
        zaloDisplayName: 'Zalo Khách A',
        friendshipStatus: 'friend',
      },
    });

    // Contact B: Khách riêng tư, kết bạn với nick main (phải bị khóa vô hình hoàn toàn)
    await prisma.contact.create({
      data: {
        id: contactBId,
        orgId: org1Id,
        fullName: 'Khách B Main Private',
        crmName: 'CRM Khách B',
        phone: '0902000002',
        phoneNormalized: '0902000002',
        zaloUid: `${TEST_PREFIX}_uid_b`,
        leadScore: 99,
        priorityScore: 99,
        notes: 'Ghi chú bí mật VIP',
        lastInboundPreview: 'Tin nhắn bí mật',
      },
    });

    // Friend row: Contact B <-> Nick Main 1
    await prisma.friend.create({
      data: {
        id: `${TEST_PREFIX}_friend_b_main`,
        orgId: org1Id,
        contactId: contactBId,
        zaloAccountId: accMain1Id,
        zaloUidInNick: `${TEST_PREFIX}_uid_b`,
        zaloDisplayName: 'Zalo Khách B VIP',
        friendshipStatus: 'friend',
      },
    });

    // Contact Merged: Đã gộp vào Contact A
    await prisma.contact.create({
      data: {
        id: contactMergedId,
        orgId: org1Id,
        fullName: 'Khách Đã Gộp',
        phone: '0903000003',
        phoneNormalized: '0903000003',
        mergedInto: contactAId,
      },
    });

    // 4. Tạo Conversations & Messages cho Org 1
    // Conversation 1 (thuộc Nick Sub 1, gắn với Contact A)
    await prisma.conversation.create({
      data: {
        id: convSub1Id,
        orgId: org1Id,
        zaloAccountId: accSub1Id,
        contactId: contactAId,
        externalThreadId: `${TEST_PREFIX}_zconv_sub_1`,
        tab: 'main',
      },
    });

    const timeT1 = new Date('2026-08-16T08:00:00.000Z');
    const timeT2 = new Date('2026-08-16T08:05:00.000Z');

    await prisma.message.create({
      data: {
        id: msgSub1Id,
        conversationId: convSub1Id,
        zaloMsgId: `${TEST_PREFIX}_zmsg_sub_1`,
        senderType: 'customer',
        senderUid: `${TEST_PREFIX}_uid_a`,
        senderName: 'Khách A',
        content: 'Tin nhắn 1 cũ hơn từ khách A',
        sentAt: timeT1,
        sentVia: 'user',
      },
    });

    await prisma.message.create({
      data: {
        id: msgSub2Id,
        conversationId: convSub1Id,
        zaloMsgId: `${TEST_PREFIX}_zmsg_sub_2`,
        senderType: 'staff',
        senderUid: user1Id,
        senderName: 'Nhân viên 1',
        content: 'Tin nhắn 2 mới hơn từ nhân viên',
        sentAt: timeT2,
        sentVia: 'user',
      },
    });

    // Conversation 2 (thuộc Nick Main 1 riêng tư)
    await prisma.conversation.create({
      data: {
        id: convMain1Id,
        orgId: org1Id,
        zaloAccountId: accMain1Id,
        contactId: contactBId,
        externalThreadId: `${TEST_PREFIX}_zconv_main_1`,
        tab: 'main',
      },
    });

    await prisma.message.create({
      data: {
        id: msgMain1Id,
        conversationId: convMain1Id,
        zaloMsgId: `${TEST_PREFIX}_zmsg_main_1`,
        senderType: 'customer',
        senderUid: `${TEST_PREFIX}_uid_b`,
        senderName: 'Khách B VIP',
        content: 'Tin nhắn riêng tư 1',
        sentAt: timeT1,
        sentVia: 'user',
      },
    });

    await prisma.message.create({
      data: {
        id: msgMain2Id,
        conversationId: convMain1Id,
        zaloMsgId: `${TEST_PREFIX}_zmsg_main_2`,
        senderType: 'staff',
        senderUid: user1Id,
        senderName: 'Chủ tài khoản',
        content: 'Tin nhắn riêng tư 2',
        sentAt: timeT2,
        sentVia: 'user',
      },
    });

    // Kịch bản hỗn hợp: Contact B (có friend nick main) có thêm 1 hội thoại trên nick SUB
    await prisma.conversation.create({
      data: {
        id: convSubBId,
        orgId: org1Id,
        zaloAccountId: accSub1Id,
        contactId: contactBId,
        externalThreadId: `${TEST_PREFIX}_zconv_sub_b`,
        tab: 'main',
      },
    });

    await prisma.message.create({
      data: {
        id: msgSubB1Id,
        conversationId: convSubBId,
        zaloMsgId: `${TEST_PREFIX}_zmsg_sub_b1`,
        senderType: 'customer',
        senderUid: `${TEST_PREFIX}_uid_b`,
        senderName: 'Khách B VIP',
        content: 'Tin nhắn trên nick sub của khách B',
        originalContent: 'Nội dung cũ nháp của B đã bị sửa',
        editedAt: timeT2,
        sentAt: timeT1,
        sentVia: 'user',
      },
    });

    await prisma.message.create({
      data: {
        id: msgSubB2Id,
        conversationId: convSubBId,
        zaloMsgId: `${TEST_PREFIX}_zmsg_sub_b2`,
        senderType: 'staff',
        senderUid: user1Id,
        senderName: 'Nhân viên',
        content: 'Tin nhắn trả lời khách B trên nick sub',
        sentAt: timeT2,
        sentVia: 'user',
      },
    });

    // Vỏ đã gộp: ContactMerged có hội thoại trên nick SUB
    await prisma.conversation.create({
      data: {
        id: convSubMergedId,
        orgId: org1Id,
        zaloAccountId: accSub1Id,
        contactId: contactMergedId,
        externalThreadId: `${TEST_PREFIX}_zconv_sub_merged`,
        tab: 'main',
      },
    });

    await prisma.message.create({
      data: {
        id: msgSubMerged1Id,
        conversationId: convSubMergedId,
        zaloMsgId: `${TEST_PREFIX}_zmsg_sub_merged_1`,
        senderType: 'customer',
        senderUid: 'merged_uid',
        senderName: 'Khách Đã Gộp',
        content: 'Tin nhắn của vỏ đã gộp',
        sentAt: timeT1,
        sentVia: 'user',
      },
    });

    await prisma.message.create({
      data: {
        id: msgSubMerged2Id,
        conversationId: convSubMergedId,
        zaloMsgId: `${TEST_PREFIX}_zmsg_sub_merged_2`,
        senderType: 'staff',
        senderUid: user1Id,
        senderName: 'Nhân viên',
        content: 'Tin trả lời vỏ đã gộp',
        sentAt: timeT2,
        sentVia: 'user',
      },
    });

    // 5. Tạo Tenant 2 (Org 2)
    await prisma.organization.create({
      data: {
        id: org2Id,
        name: 'Test Org 2 Agent',
      },
    });

    await prisma.user.create({
      data: {
        id: user2Id,
        orgId: org2Id,
        email: `${TEST_PREFIX}_u2@test.com`,
        passwordHash: 'hash',
        fullName: 'User Org 2',
        role: 'admin',
      },
    });

    await prisma.zaloAccount.create({
      data: {
        id: accSub2Id,
        orgId: org2Id,
        ownerUserId: user2Id,
        zaloUid: `${TEST_PREFIX}_zalo_sub_2`,
        displayName: 'Nick Sub Org 2',
        privacyMode: 'sub',
      },
    });

    await prisma.contact.create({
      data: {
        id: contactOrg2Id,
        orgId: org2Id,
        fullName: 'Khách của Org 2',
        phone: '0909999999',
        phoneNormalized: '0909999999',
      },
    });

    await prisma.conversation.create({
      data: {
        id: convSub2Id,
        orgId: org2Id,
        zaloAccountId: accSub2Id,
        contactId: contactOrg2Id,
        externalThreadId: `${TEST_PREFIX}_zconv_sub_2`,
        tab: 'main',
      },
    });

    await prisma.message.create({
      data: {
        id: msgSub2_1Id,
        conversationId: convSub2Id,
        zaloMsgId: `${TEST_PREFIX}_zmsg_sub2_1`,
        senderType: 'customer',
        senderUid: 'u2',
        senderName: 'Khách Org 2',
        content: 'Tin của Org 2',
        sentAt: timeT1,
        sentVia: 'user',
      },
    });
  });

  afterAll(async () => {
    // Dọn sạch toàn bộ dữ liệu test
    await prisma.message.deleteMany({
      where: {
        id: {
          in: [
            msgSub1Id,
            msgSub2Id,
            msgMain1Id,
            msgMain2Id,
            msgSubB1Id,
            msgSubB2Id,
            msgSubMerged1Id,
            msgSubMerged2Id,
            msgSub2_1Id,
          ],
        },
      },
    });
    await prisma.conversation.deleteMany({
      where: {
        id: {
          in: [convSub1Id, convMain1Id, convSubBId, convSubMergedId, convSub2Id],
        },
      },
    });
    await prisma.friend.deleteMany({
      where: { id: { in: [`${TEST_PREFIX}_friend_a_sub`, `${TEST_PREFIX}_friend_b_main`] } },
    });
    await prisma.contact.deleteMany({
      where: { id: { in: [contactAId, contactBId, contactMergedId, contactOrg2Id] } },
    });
    await prisma.zaloAccount.deleteMany({
      where: { id: { in: [accMain1Id, accSub1Id, accSub2Id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [user1Id, user2Id] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [org1Id, org2Id] } },
    });
  });

  // ── 1. getSafeContactForAgent ─────────────────────────────────────────────
  it('getSafeContactForAgent: trả Contact A (nick sub), trả null cho Contact B (nick main)', async () => {
    const contactA = await getSafeContactForAgent(contactAId, { orgId: org1Id });
    expect(contactA).not.toBeNull();
    expect(contactA?.id).toBe(contactAId);
    expect(contactA?.fullName).toBe('Khách A Sub Only');

    // Contact B kết bạn với nick main -> hoàn toàn vô hình (null)
    const contactB = await getSafeContactForAgent(contactBId, { orgId: org1Id });
    expect(contactB).toBeNull();
  });

  it('getSafeContactForAgent: trả null cho contact đã gộp (mergedInto != null)', async () => {
    const mergedContact = await getSafeContactForAgent(contactMergedId, { orgId: org1Id });
    expect(mergedContact).toBeNull();
  });

  it('getSafeContactForAgent: trả null cho contact thuộc Org khác (Multi-tenant isolation)', async () => {
    // Org 1 agent hỏi contact của Org 2
    const crossTenantContact = await getSafeContactForAgent(contactOrg2Id, { orgId: org1Id });
    expect(crossTenantContact).toBeNull();
  });

  // ── 2. findSafeContactsForAgent ───────────────────────────────────────────
  it('findSafeContactsForAgent: không bao giờ chứa Contact B (main nick), không chứa merged contact hay org khác', async () => {
    const contacts = await findSafeContactsForAgent({ query: 'Khách', limit: 10 }, { orgId: org1Id });

    const returnedIds = contacts.map((c) => c.id);
    expect(returnedIds).toContain(contactAId);
    expect(returnedIds).not.toContain(contactBId);
    expect(returnedIds).not.toContain(contactMergedId);
    expect(returnedIds).not.toContain(contactOrg2Id);
  });

  it('findSafeContactsForAgent: tôn trọng take limit', async () => {
    const contacts = await findSafeContactsForAgent({ limit: 1 }, { orgId: org1Id });
    expect(contacts.length).toBeLessThanOrEqual(1);
  });

  // ── 3. getSafeMessagesForAgent ────────────────────────────────────────────
  it('getSafeMessagesForAgent: chỉ trả tin của conversation thuộc nick sub, sắp xếp tăng dần theo sentAt', async () => {
    const messages = await getSafeMessagesForAgent(
      { conversationId: convSub1Id },
      { orgId: org1Id },
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe(msgSub1Id); // Cũ hơn
    expect(messages[1].id).toBe(msgSub2Id); // Mới hơn
    expect(new Date(messages[0].sentAt).getTime()).toBeLessThan(new Date(messages[1].sentAt).getTime());
  });

  it('getSafeMessagesForAgent: trả về rỗng [] khi conversation thuộc nick main riêng tư', async () => {
    const messages = await getSafeMessagesForAgent(
      { conversationId: convMain1Id },
      { orgId: org1Id },
    );

    expect(messages).toEqual([]);
  });

  it('getSafeMessagesForAgent: query qua contactId chỉ trả tin của nick sub, bỏ qua tin nick main', async () => {
    // Contact A chỉ có convSub1
    const messagesA = await getSafeMessagesForAgent(
      { contactId: contactAId },
      { orgId: org1Id },
    );
    expect(messagesA).toHaveLength(2);
    expect(messagesA[0].id).toBe(msgSub1Id);
    expect(messagesA[1].id).toBe(msgSub2Id);

    // Contact B chỉ có convMain1 (riêng tư) -> trả rỗng
    const messagesB = await getSafeMessagesForAgent(
      { contactId: contactBId },
      { orgId: org1Id },
    );
    expect(messagesB).toEqual([]);
  });

  it('getSafeMessagesForAgent: ném lỗi (throw error) khi thiếu cả conversationId lẫn contactId', async () => {
    await expect(getSafeMessagesForAgent({}, { orgId: org1Id })).rejects.toThrow(
      /Either conversationId or contactId is required for getSafeMessagesForAgent/,
    );
  });

  // ── 4. Allow-list Select Key Verification ─────────────────────────────────
  it('Allow-list: getSafeContactForAgent không chứa bất kỳ khoá nào ngoài SAFE_CONTACT_SELECT + friends', async () => {
    const contact = await getSafeContactForAgent(contactAId, { orgId: org1Id });
    expect(contact).not.toBeNull();

    const allowedKeys = [...Object.keys(SAFE_CONTACT_SELECT), 'friends'].sort();
    const actualKeys = Object.keys(contact!).sort();

    // Kiểm tra Object.keys() tuyệt đối khớp danh sách khoá cho phép
    expect(actualKeys).toEqual(allowedKeys);

    // Kiểm tra các trường nhạy cảm hoàn toàn không tồn tại trên object (undefined)
    const rawObj = contact as Record<string, unknown>;
    expect(rawObj.notes).toBeUndefined();
    expect(rawObj.lastInboundPreview).toBeUndefined();
    expect(rawObj.lastOutboundPreview).toBeUndefined();
    expect(rawObj.lastInteractionPayload).toBeUndefined();
    expect(rawObj.metadata).toBeUndefined();
    expect(rawObj.gender).toBeUndefined();
    expect(rawObj.birthYear).toBeUndefined();
    expect(rawObj.birthDate).toBeUndefined();
    expect(rawObj.addressLine).toBeUndefined();
    expect(rawObj.occupation).toBeUndefined();
    expect(rawObj.incomeRange).toBeUndefined();
    expect(rawObj.socialFacebook).toBeUndefined();
    expect(rawObj.socialTiktok).toBeUndefined();
  });

  // ── 5. Lỗ hổng bảo mật nâng cao vừa bịt ──────────────────────────────────────
  it('getSafeMessagesForAgent: Kịch bản hỗn hợp — Contact B có friend nick main thì hội thoại trên nick sub cũng trả về rỗng [] (qua cả contactId lẫn conversationId)', async () => {
    // Hỏi qua contactId -> trả về rỗng
    const messagesByContact = await getSafeMessagesForAgent(
      { contactId: contactBId },
      { orgId: org1Id },
    );
    expect(messagesByContact).toEqual([]);

    // Hỏi trực tiếp qua conversationId của hội thoại nick sub của Contact B -> cũng phải trả về rỗng
    const messagesByConv = await getSafeMessagesForAgent(
      { conversationId: convSubBId },
      { orgId: org1Id },
    );
    expect(messagesByConv).toEqual([]);
  });

  it('getSafeMessagesForAgent: Vỏ đã gộp — ContactMerged có hội thoại trên nick sub cũng trả về rỗng [] (qua cả contactId lẫn conversationId)', async () => {
    // Hỏi qua contactId -> trả về rỗng
    const messagesByContact = await getSafeMessagesForAgent(
      { contactId: contactMergedId },
      { orgId: org1Id },
    );
    expect(messagesByContact).toEqual([]);

    // Hỏi qua conversationId của hội thoại nick sub của contactMerged -> cũng phải trả về rỗng
    const messagesByConv = await getSafeMessagesForAgent(
      { conversationId: convSubMergedId },
      { orgId: org1Id },
    );
    expect(messagesByConv).toEqual([]);
  });

  it('getSafeMessagesForAgent: Cross-tenant isolation — Org 2 hỏi conversationId của Org 1 phải trả về rỗng []', async () => {
    // Org 2 hỏi hội thoại của Org 1
    const crossMessages1 = await getSafeMessagesForAgent(
      { conversationId: convSub1Id },
      { orgId: org2Id },
    );
    expect(crossMessages1).toEqual([]);

    // Org 1 hỏi hội thoại của Org 2
    const crossMessages2 = await getSafeMessagesForAgent(
      { conversationId: convSub2Id },
      { orgId: org1Id },
    );
    expect(crossMessages2).toEqual([]);
  });

  it('Allow-list: getSafeMessagesForAgent chỉ trả các trường trong SAFE_MESSAGE_SELECT, loại bỏ originalContent và audit metadata', async () => {
    const messages = await getSafeMessagesForAgent(
      { conversationId: convSub1Id },
      { orgId: org1Id },
    );
    expect(messages.length).toBeGreaterThan(0);

    const allowedKeys = Object.keys(SAFE_MESSAGE_SELECT).sort();
    for (const msg of messages) {
      expect(Object.keys(msg).sort()).toEqual(allowedKeys);

      const rawMsg = msg as Record<string, unknown>;
      // Bắt buộc loại bỏ originalContent, editedAt và metadata audit
      expect(rawMsg.originalContent).toBeUndefined();
      expect(rawMsg.editedAt).toBeUndefined();
      expect(rawMsg.zaloMsgId).toBeUndefined();
      expect(rawMsg.zaloMsgIdNum).toBeUndefined();
      expect(rawMsg.zaloCliMsgId).toBeUndefined();
      expect(rawMsg.attachments).toBeUndefined();
      expect(rawMsg.quote).toBeUndefined();
      expect(rawMsg.deliveredAt).toBeUndefined();
      expect(rawMsg.seenAt).toBeUndefined();
      expect(rawMsg.repliedByUserId).toBeUndefined();
    }
  });
});
