import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: {},
}));

import { computeLeaseTiming } from '../../src/modules/agent/queue/dispatcher.js';

describe('Agent Lease Timing Unit Tests (#67, #77)', () => {
  it('17. Lease timing #67: handler maxDurationMs = 150_000 -> leaseMs = 300_000, leaseRenewIntervalMs = 100_000 < leaseMs', () => {
    const longRunningHandlers = {
      heavy_ai_task: {
        maxDurationMs: 150_000,
        prepare: async () => ({ success: true }),
      },
    };

    const timing = computeLeaseTiming(longRunningHandlers);
    expect(timing.leaseMs).toBe(300_000); // max(60_000, 150_000 * 2) = 300_000
    expect(timing.leaseRenewIntervalMs).toBe(100_000); // floor(300_000 / 3) = 100_000

    // Bất biến cốt lõi: Chu kỳ renew luôn nhỏ hơn đáng kể so với thời hạn lease ban đầu
    expect(timing.leaseRenewIntervalMs).toBeLessThan(timing.leaseMs);
    expect(timing.leaseMs / timing.leaseRenewIntervalMs).toBeGreaterThanOrEqual(2.5);

    // Kiểm tra cấu hình mặc định (không khai maxDurationMs)
    const defaultTiming = computeLeaseTiming({});
    expect(defaultTiming.leaseMs).toBe(60_000);
    expect(defaultTiming.leaseRenewIntervalMs).toBe(20_000);
    expect(defaultTiming.leaseRenewIntervalMs).toBeLessThan(defaultTiming.leaseMs);

    // Kiểm tra cấu hình thời lượng siêu ngắn (100ms)
    const shortTiming = computeLeaseTiming({ quick: { maxDurationMs: 100, prepare: async () => ({ success: true }) } }, 300);
    expect(shortTiming.leaseMs).toBe(300);
    expect(shortTiming.leaseRenewIntervalMs).toBe(100); // 300 / 3 = 100 >= 50
    expect(shortTiming.leaseRenewIntervalMs).toBeLessThan(shortTiming.leaseMs);
  });
});
