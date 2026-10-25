import { describe, expect, it, vi } from 'vitest';
import {
  type ConfirmationCache,
  type ConfirmationDeps,
  type ConfirmationParent,
  type IsolatedConfirmationAuth,
  createVaultConfirmation,
} from './vault-confirmation';

const parent: ConfirmationParent = {
  userId: 'person',
  sessionId: 'oauth-session',
  organizationId: 'org',
  email: 'admin@admin.com',
  hasPassword: true,
};
const result = () => ({
  data: { user: { id: parent.userId }, session: { access_token: 'isolated-proof' } },
  error: null,
});
function setup() {
  let current: ConfirmationParent | null = { ...parent };
  let cache: unknown = null;
  let clock = 1000;
  let queue = Promise.resolve();
  const clients: IsolatedConfirmationAuth[] = [];
  const factory = vi.fn(() => {
    const auth = {
      signInWithPassword: vi.fn(async () => result()),
      signInWithOtp: vi.fn(async () => ({ error: null })),
      verifyOtp: vi.fn(async () => result()),
      signOut: vi.fn(async (_input: { scope: 'local' }) => ({ error: null })),
    };
    clients.push(auth);
    return auth;
  });
  const cleanupFailed = vi.fn();
  const deps: ConfirmationDeps = {
    actor: { userId: parent.userId, organizationId: parent.organizationId },
    parent: async () => current,
    auth: factory,
    issueGrant: vi.fn(async (token, binding) => {
      expect(token).toBe('isolated-proof');
      expect(binding).toEqual(parent);
      return { grant: 'server-confirmation', expires_in: 1800 };
    }),
    cache: {
      read: async () => cache,
      write: async (value) => {
        cache = value;
      },
      remove: async () => {
        cache = null;
      },
    },
    async lock<T>(work: () => Promise<T>): Promise<T> {
      const prior = queue;
      let release!: () => void;
      queue = new Promise<void>((r) => {
        release = r;
      });
      await prior;
      try {
        return await work();
      } finally {
        release();
      }
    },
    now: () => clock,
    cleanupFailed,
  };
  return {
    deps,
    clients,
    factory,
    cleanupFailed,
    current: (value: ConfirmationParent | null) => {
      current = value;
    },
    cache: () => cache,
    time: (value: number) => {
      clock = value;
    },
  };
}

describe('in-place Vault confirmation controller', () => {
  it('uses the shared password flow and one grant across actions and panel recreation', async () => {
    const f = setup();
    const first = createVaultConfirmation(f.deps);
    expect(await first.account()).toEqual({
      email: parent.email,
      providers: [],
      hasPassword: true,
    });
    expect(await first.headers()).toEqual({});
    await first.withPassword('private-input');
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(f.clients.at(0)?.signInWithPassword).toHaveBeenCalledWith({
      email: parent.email,
      password: 'private-input',
    });
    expect(f.clients.at(0)?.signOut).toHaveBeenCalledWith({ scope: 'local' });
    first.cancel(); // tab unmount invalidates unfinished work, never the completed grant
    const second = createVaultConfirmation(f.deps);
    expect(await second.headers()).toEqual({ 'X-Matrx-Step-Up': 'server-confirmation' });
    expect(await first.headers()).toEqual(await second.headers());
    expect(f.deps.issueGrant).toHaveBeenCalledOnce();
    expect(f.cleanupFailed).not.toHaveBeenCalled();
    expect(JSON.stringify(f.cache())).not.toContain('isolated-proof');
    expect(JSON.stringify(f.cache())).not.toContain('private-input');
    await expect(first.withProvider('browser')).rejects.toThrow('Confirm here');
  });

  it.each(['expiry', 'session', 'organization', 'logout'])(
    'invalidates a completed grant after %s',
    async (reason) => {
      const f = setup();
      const c = createVaultConfirmation(f.deps);
      await c.withPassword('input');
      if (reason === 'expiry') f.time(1801000);
      if (reason === 'session') f.current({ ...parent, sessionId: 'new-session' });
      if (reason === 'organization') f.current({ ...parent, organizationId: 'new-org' });
      if (reason === 'logout') f.current(null);
      if (reason === 'organization' || reason === 'logout')
        await expect(c.headers()).rejects.toThrow();
      else expect(await c.headers()).toEqual({});
      expect(f.cache()).toBeNull();
    },
  );

  it('an old workspace cannot delete the newer identity grant', async () => {
    const f = setup();
    const old = createVaultConfirmation(f.deps);
    await old.withPassword('input');
    const next = { ...parent, userId: 'new-person' };
    f.current(next);
    const newer = { ...(f.cache() as ConfirmationCache), userId: next.userId, grant: 'new-grant' };
    await f.deps.cache.write(newer);
    await expect(old.headers()).rejects.toThrow('account changed');
    expect(f.cache()).toEqual(newer);
  });

  it.each(['cancel', 'session', 'person'])(
    'ends only its isolated proof and refuses delayed success after %s',
    async (change) => {
      const f = setup();
      let finish!: (value: ReturnType<typeof result>) => void;
      const pending = new Promise<ReturnType<typeof result>>((resolve) => {
        finish = resolve;
      });
      const factory = f.deps.auth;
      f.deps.auth = () => {
        const a = factory();
        a.signInWithPassword = () => pending;
        return a;
      };
      const c = createVaultConfirmation(f.deps);
      const done = c.withPassword('input');
      const rejected = expect(done).rejects.toThrow();
      await vi.waitFor(() => expect(f.factory).toHaveBeenCalledOnce());
      if (change === 'cancel') c.cancel();
      if (change === 'session') f.current({ ...parent, sessionId: 'new-session' });
      if (change === 'person') f.current({ ...parent, userId: 'another-person' });
      finish(result());
      await rejected;
      expect(f.clients.at(0)?.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(f.deps.issueGrant).not.toHaveBeenCalled();
      expect(f.cache()).toBeNull();
    },
  );

  it('cleans a mismatched isolated identity and never publishes a grant', async () => {
    const f = setup();
    const factory = f.deps.auth;
    f.deps.auth = () => {
      const a = factory();
      a.signInWithPassword = async () => ({
        ...result(),
        data: { user: { id: 'other' }, session: { access_token: 'wrong-proof' } },
      });
      return a;
    };
    await expect(createVaultConfirmation(f.deps).withPassword('input')).rejects.toThrow(
      'not accepted',
    );
    expect(f.clients.at(0)?.signOut).toHaveBeenCalledOnce();
    expect(f.deps.issueGrant).not.toHaveBeenCalled();
  });

  it('retains the in-place email flow for provider-only accounts and retries a mistyped code', async () => {
    const f = setup();
    f.current({ ...parent, hasPassword: false });
    const factory = f.deps.auth;
    f.deps.auth = () => {
      const a = factory();
      let attempts = 0;
      a.verifyOtp = async () =>
        ++attempts === 1
          ? { data: { user: null, session: null }, error: { message: 'bad code' } }
          : result();
      return a;
    };
    f.deps.issueGrant = vi.fn(async () => ({ grant: 'email-grant', expires_in: 300 }));
    const c = createVaultConfirmation(f.deps);
    expect(await c.account()).toEqual({ email: parent.email, hasPassword: false, providers: [] });
    await c.sendEmailCode();
    expect(f.clients.at(0)?.signInWithOtp).toHaveBeenCalledWith({
      email: parent.email,
      options: { shouldCreateUser: false },
    });
    await expect(c.withEmailCode('wrong')).rejects.toThrow('not accepted');
    await c.withEmailCode(' 123456 ');
    expect(f.factory).toHaveBeenCalledOnce();
    expect(f.clients.at(0)?.signOut).toHaveBeenCalledOnce();
    expect(await c.headers()).toEqual({ 'X-Matrx-Step-Up': 'email-grant' });
  });

  it('a failed proof logout reports failure and cannot publish confirmation', async () => {
    const f = setup();
    const factory = f.deps.auth;
    f.deps.auth = () => {
      const a = factory();
      a.signOut = async () => ({ error: new Error('private detail') });
      return a;
    };
    await expect(createVaultConfirmation(f.deps).withPassword('input')).rejects.toThrow(
      'Confirmation did not finish',
    );
    expect(f.cleanupFailed).toHaveBeenCalledOnce();
    expect(f.cache()).toBeNull();
  });

  it('cancellation while persisting rolls back only that attempt before readers proceed', async () => {
    const f = setup();
    let writing!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((r) => {
      writing = r;
    });
    const wait = new Promise<void>((r) => {
      finish = r;
    });
    const write = f.deps.cache.write;
    f.deps.cache.write = async (v) => {
      await write(v);
      writing();
      await wait;
    };
    const c = createVaultConfirmation(f.deps);
    const done = c.withPassword('input');
    const rejected = expect(done).rejects.toThrow('Not confirmed');
    await started;
    c.cancel();
    const headers = c.headers();
    finish();
    await rejected;
    expect(await headers).toEqual({});
    expect(f.cache()).toBeNull();
  });
});

it('a temporary identity read failure preserves confirmation for the recovered retry', async () => {
  const f = setup();
  const c = createVaultConfirmation(f.deps);
  await c.withPassword('input');
  const original = f.cache();
  const read = f.deps.parent;
  let failed = false;
  f.deps.parent = async () => {
    if (!failed) {
      failed = true;
      throw new Error('Identity temporarily unavailable');
    }
    return read();
  };
  await expect(c.headers()).rejects.toThrow('temporarily unavailable');
  expect(f.cache()).toEqual(original);
  expect(await c.headers()).toEqual({ 'X-Matrx-Step-Up': 'server-confirmation' });
  expect(f.deps.issueGrant).toHaveBeenCalledOnce();
});

it('a temporary read after storage write does not destroy an already verified grant', async () => {
  const f = setup();
  const write = f.deps.cache.write;
  const read = f.deps.parent;
  f.deps.cache.write = async (value) => {
    await write(value);
    f.deps.parent = async () => {
      throw new Error('Identity temporarily unavailable');
    };
  };
  const c = createVaultConfirmation(f.deps);
  await expect(c.withPassword('input')).rejects.toThrow('temporarily unavailable');
  expect(f.cache()).not.toBeNull();
  f.deps.parent = read;
  expect(await c.headers()).toEqual({ 'X-Matrx-Step-Up': 'server-confirmation' });
  expect(f.deps.issueGrant).toHaveBeenCalledOnce();
});

it.each([false, true])(
  'cancellation undoes the locked write without a rollback read (write rejects=%s)',
  async (rejectWrite) => {
    const f = setup();
    const write = f.deps.cache.write;
    const read = f.deps.cache.read;
    let started!: () => void;
    let finish!: () => void;
    const writing = new Promise<void>((r) => {
      started = r;
    });
    const wait = new Promise<void>((r) => {
      finish = r;
    });
    f.deps.cache.write = async (value) => {
      await write(value);
      f.deps.cache.read = async () => {
        throw new Error('temporary cache read');
      };
      started();
      await wait;
      if (rejectWrite) throw new Error('write response lost');
    };
    const c = createVaultConfirmation(f.deps);
    const done = c.withPassword('input');
    const rejected = expect(done).rejects.toThrow();
    await writing;
    c.cancel();
    finish();
    await rejected;
    f.deps.cache.read = read;
    expect(await c.headers()).toEqual({});
    expect(f.cache()).toBeNull();
  },
);

it('cancelling a second confirmation restores the previously completed grant', async () => {
  const f = setup();
  const c = createVaultConfirmation(f.deps);
  await c.withPassword('input');
  const original = f.cache();
  const write = f.deps.cache.write;
  let started!: () => void;
  let finish!: () => void;
  const writing = new Promise<void>((r) => {
    started = r;
  });
  const wait = new Promise<void>((r) => {
    finish = r;
  });
  let writes = 0;
  f.deps.cache.write = async (value) => {
    await write(value);
    if (++writes === 1) {
      started();
      await wait;
    }
  };
  const done = c.withPassword('input');
  const rejected = expect(done).rejects.toThrow('Not confirmed');
  await writing;
  c.cancel();
  finish();
  await rejected;
  expect(f.cache()).toEqual(original);
  expect(await c.headers()).toEqual({ 'X-Matrx-Step-Up': 'server-confirmation' });
});
