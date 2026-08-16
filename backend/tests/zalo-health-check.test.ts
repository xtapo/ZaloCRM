import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../src/shared/database/prisma-client.js';
import { startZaloHealthCheck } from '../src/modules/zalo/zalo-health-check.js';
import { zaloPool } from '../src/modules/zalo/zalo-pool.js';
import { getDownSince } from '../src/modules/zalo/status-log-service.js';
import cron from 'node-cron';

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    zaloAccount: { findMany: vi.fn() },
    activityLog: { findFirst: vi.fn() }
  }
}));

vi.mock('../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: { getStatus: vi.fn(), reconnect: vi.fn().mockResolvedValue(true) }
}));

vi.mock('../src/modules/zalo/status-log-service.js', () => ({
  getDownSince: vi.fn()
}));

vi.mock('../src/modules/activity/activity-logger.js', () => ({
  logActivity: vi.fn()
}));
import { logActivity } from '../src/modules/activity/activity-logger.js';

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() }
}));

const MINUTE = 60 * 1000;

describe('zalo-health-check', () => {
  let mockIo: any;
  let cronCallback: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIo = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn()
    };

    // capture the cron callback
    vi.mocked(cron.schedule).mockImplementation((exp: any, cb: any) => {
      if (exp === '*/5 * * * *') cronCallback = cb;
      return {} as any;
    });

    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc1', orgId: 'o1', displayName: 'Nick 1', sessionData: { imei: '123' } }
    ] as any);
    vi.mocked(prisma.activityLog.findFirst).mockResolvedValue(null as any);
    vi.mocked(getDownSince).mockResolvedValue(null);
    vi.mocked(zaloPool.reconnect).mockResolvedValue(true as any);

    startZaloHealthCheck(mockIo);
  });

  it('rớt < 15 phút -> reconnect nhưng chưa cảnh báo', async () => {
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected');
    vi.mocked(getDownSince).mockResolvedValue(Date.now() - 5 * MINUTE);

    await cronCallback();

    expect(zaloPool.reconnect).toHaveBeenCalledWith('acc1', { imei: '123' });
    expect(mockIo.emit).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('downSince lấy từ status log -> cảnh báo ngay tick đầu sau restart', async () => {
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected');
    vi.mocked(getDownSince).mockResolvedValue(Date.now() - 20 * MINUTE);

    await cronCallback();

    expect(mockIo.emit).toHaveBeenCalledWith(
      'zalo:session-alert',
      expect.objectContaining({ accountId: 'acc1', downMinutes: 20 })
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'zalo_session_down' })
    );
  });

  it('đã có log zalo_session_down trong episode -> không cảnh báo lại (chống trùng đa instance)', async () => {
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected');
    vi.mocked(getDownSince).mockResolvedValue(Date.now() - 25 * MINUTE);
    vi.mocked(prisma.activityLog.findFirst).mockResolvedValue({ id: 'log1' } as any);

    await cronCallback();

    expect(mockIo.emit).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('kết nối lại sau khi đã cảnh báo -> báo recovered', async () => {
    vi.mocked(zaloPool.getStatus).mockReturnValue('connected');
    (vi.mocked(prisma.activityLog.findFirst) as any).mockImplementation(async (args: any) => {
      if (args?.where?.action === 'zalo_session_down') {
        return { createdAt: new Date(Date.now() - 10 * MINUTE) } as any;
      }
      return null as any;
    });

    await cronCallback();

    expect(mockIo.emit).toHaveBeenCalledWith(
      'zalo:session-recovered',
      expect.objectContaining({ accountId: 'acc1' })
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'zalo_session_recovered' })
    );
  });

  it('đã có log recovered mới hơn -> không báo recovered lần nữa', async () => {
    vi.mocked(zaloPool.getStatus).mockReturnValue('connected');
    (vi.mocked(prisma.activityLog.findFirst) as any).mockImplementation(async (args: any) => {
      if (args?.where?.action === 'zalo_session_down') {
        return { createdAt: new Date(Date.now() - 30 * MINUTE) } as any;
      }
      if (args?.where?.action === 'zalo_session_recovered') {
        return { createdAt: new Date(Date.now() - 5 * MINUTE) } as any;
      }
      return null as any;
    });

    await cronCallback();

    expect(mockIo.emit).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('chưa từng rớt -> connected không phát recovered', async () => {
    vi.mocked(zaloPool.getStatus).mockReturnValue('connected');
    vi.mocked(prisma.activityLog.findFirst).mockResolvedValue(null as any);

    await cronCallback();

    expect(mockIo.emit).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('vùng phủ: lọc OR sessionData hoặc lastConnectedAt, không chỉ sessionData', async () => {
    vi.mocked(zaloPool.getStatus).mockReturnValue('connected');

    await cronCallback();

    const arg = vi.mocked(prisma.zaloAccount.findMany).mock.calls[0][0] as any;
    expect(arg.where.OR).toEqual([
      { sessionData: expect.anything() },
      { lastConnectedAt: { not: null } },
    ]);
  });

  it('nick từng kết nối nhưng mất sessionData -> vẫn cảnh báo, không gọi reconnect', async () => {
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc2', orgId: 'o1', displayName: 'Nick mất session', sessionData: null }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected');
    vi.mocked(getDownSince).mockResolvedValue(Date.now() - 45 * MINUTE);

    await cronCallback();

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'zalo_session_down', entityId: 'acc2' })
    );
    expect(mockIo.emit).toHaveBeenCalledWith(
      'zalo:session-alert',
      expect.objectContaining({ accountId: 'acc2', downMinutes: 45 })
    );
    expect(zaloPool.reconnect).not.toHaveBeenCalled();
  });
});
