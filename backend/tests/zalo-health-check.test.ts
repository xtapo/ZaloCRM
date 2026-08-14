import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/shared/database/prisma-client.js';
import { startZaloHealthCheck } from '../src/modules/zalo/zalo-health-check.js';
import { zaloPool } from '../src/modules/zalo/zalo-pool.js';
import cron from 'node-cron';

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    zaloAccount: { findMany: vi.fn() }
  }
}));

vi.mock('../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: { getStatus: vi.fn(), reconnect: vi.fn().mockResolvedValue(true) }
}));

vi.mock('../src/modules/activity/activity-logger.js', () => ({
  logActivity: vi.fn()
}));
import { logActivity } from '../src/modules/activity/activity-logger.js';

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() }
}));

describe('zalo-health-check', () => {
  let mockIo: any;
  let cronCallback: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIo = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn()
    };
    
    // capture the cron callback
    vi.mocked(cron.schedule).mockImplementation((exp, cb) => {
      if (exp === '*/5 * * * *') cronCallback = cb;
      return {} as any;
    });

    startZaloHealthCheck(mockIo);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('down < 15 mins -> reconnects but no alert', async () => {
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc1', orgId: 'o1', displayName: 'Nick 1', sessionData: { imei: '123' } }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected');

    // Tick 1 (down 0 mins)
    await cronCallback();
    expect(zaloPool.reconnect).toHaveBeenCalledWith('acc1', { imei: '123' });
    expect(mockIo.emit).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('down > 15 mins -> emits alert ONCE', async () => {
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc1', orgId: 'o1', displayName: 'Nick 1', sessionData: { imei: '123' } }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected');

    // Tick 1 (0 mins)
    await cronCallback();
    
    // Advance 16 mins
    vi.advanceTimersByTime(16 * 60 * 1000);

    // Tick 2 (16 mins)
    await cronCallback();
    expect(mockIo.emit).toHaveBeenCalledWith('zalo:session-alert', expect.objectContaining({ accountId: 'acc1', downMinutes: 16 }));
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'zalo_session_down' }));
    
    // Tick 3 (another 5 mins, total 21 mins down)
    vi.mocked(mockIo.emit).mockClear();
    vi.mocked(logActivity).mockClear();
    vi.advanceTimersByTime(5 * 60 * 1000);
    await cronCallback();
    expect(mockIo.emit).not.toHaveBeenCalled(); // Should not emit again
  });

  it('recovered -> emits recovered ONCE', async () => {
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc1', orgId: 'o1', displayName: 'Nick 1', sessionData: { imei: '123' } }
    ] as any);
    
    // Go down and alert
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected');
    await cronCallback();
    vi.advanceTimersByTime(16 * 60 * 1000);
    await cronCallback(); // alerted here
    
    vi.mocked(mockIo.emit).mockClear();
    vi.mocked(logActivity).mockClear();

    // Now recover
    vi.mocked(zaloPool.getStatus).mockReturnValue('connected');
    await cronCallback(); // should emit recovered
    
    expect(mockIo.emit).toHaveBeenCalledWith('zalo:session-recovered', expect.objectContaining({ accountId: 'acc1' }));
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'zalo_session_recovered' }));

    // Tick again, shouldn't emit recovered again
    vi.mocked(mockIo.emit).mockClear();
    vi.mocked(logActivity).mockClear();
    await cronCallback();
    expect(mockIo.emit).not.toHaveBeenCalled();
  });
});
