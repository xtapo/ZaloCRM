import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installSocketPrivacyGuard, invalidateSocketPrivacyCache } from '../src/shared/realtime/socket-privacy.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import jwt from 'jsonwebtoken';

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    zaloAccount: { findUnique: vi.fn() },
    zaloAccountAccess: { findMany: vi.fn() }
  }
}));

vi.mock('../src/config/index.js', () => ({
  config: { jwtSecret: 'test-secret', isProduction: false }
}));

describe('socket-privacy isActive check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateSocketPrivacyCache();
    (installSocketPrivacyGuard as any).__privacyGuardInstalled = false;
  });

  function setupIO() {
    const io: any = { 
      use: vi.fn(), 
      emit: vi.fn(), 
      to: vi.fn(() => io), 
      in: vi.fn(() => io),
      sockets: { sockets: new Map() }
    };
    return io;
  }

  it('blocks deactivated users', async () => {
    const io = setupIO();
    installSocketPrivacyGuard(io);
    const useFn = io.use.mock.calls[0][0];

    const token = jwt.sign({ id: 'u1', orgId: 'o1', role: 'member' }, config.jwtSecret);
    const socket: any = { handshake: { auth: { token } }, data: {} };

    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: false, orgId: 'o1' } as any);

    let nextCalled = false;
    await useFn(socket, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(socket.data.user).toBeNull();
  });

  it('blocks users on db error', async () => {
    const io = setupIO();
    installSocketPrivacyGuard(io);
    const useFn = io.use.mock.calls[0][0];
    
    const token = jwt.sign({ id: 'u2', orgId: 'o1', role: 'member' }, config.jwtSecret);
    const socket: any = { handshake: { auth: { token } }, data: {} };
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('db error'));

    await useFn(socket, () => {});
    expect(socket.data.user).toBeNull();
  });

  it('allows active users', async () => {
    const io = setupIO();
    installSocketPrivacyGuard(io);
    const useFn = io.use.mock.calls[0][0];
    
    const token = jwt.sign({ id: 'u3', orgId: 'o1', role: 'member' }, config.jwtSecret);
    const socket: any = { handshake: { auth: { token } }, data: {} };
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: true, orgId: 'o1' } as any);

    await useFn(socket, () => {});
    expect(socket.data.user).not.toBeNull();
    expect(socket.data.user.id).toBe('u3');
  });
});
