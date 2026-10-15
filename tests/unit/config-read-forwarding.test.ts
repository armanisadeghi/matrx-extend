import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class Channel {
  static instances: Channel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    Channel.instances.push(this);
  }
}

beforeEach(() => {
  vi.resetModules();
  Channel.instances = [];
  vi.stubGlobal('BroadcastChannel', Channel);
  vi.stubGlobal('ServiceWorkerGlobalScope', undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('configuration read forwarding', () => {
  it('forwards page reads and missing keys over the same extension channel', async () => {
    const { recordKnobRead } = await import('@/lib/config');
    recordKnobRead('vault.generator.max_password_length', 'db');
    recordKnobRead('unknown.feature.key', 'db');
    expect(Channel.instances).toHaveLength(1);
    expect(Channel.instances[0]!.name).toBe('matrx-config-reads');
    expect(Channel.instances[0]!.postMessage.mock.calls).toEqual([
      [
        {
          kind: 'matrx.config.read',
          read: {
            kind: 'knob',
            feature: 'vault.generator',
            key: 'max_password_length',
            source: 'db',
          },
        },
      ],
      [
        {
          kind: 'matrx.config.read',
          missing: { kind: 'knob', feature: 'unknown.feature', key: 'key' },
        },
      ],
    ]);
  });

  it('queues inbound reads until the worker recorder attaches and ignores other messages', async () => {
    class WorkerScope {}
    vi.stubGlobal('ServiceWorkerGlobalScope', WorkerScope);
    vi.stubGlobal('self', new WorkerScope());
    const { listenForForwardedReads, attachRecorder } = await import('@/lib/config');
    listenForForwardedReads();
    const read = {
      kind: 'knob' as const,
      feature: 'vault.generator',
      key: 'max_password_length',
      source: 'db' as const,
    };
    const missing = { kind: 'knob' as const, feature: 'unknown.feature', key: 'key' };
    const emit = (data: unknown) => Channel.instances[0]!.onmessage?.({ data } as MessageEvent);
    emit({ kind: 'unrelated', read });
    emit({ kind: 'matrx.config.read', read });
    emit({ kind: 'matrx.config.read', missing });
    const recorder = { read: vi.fn(), missing: vi.fn(), applied: vi.fn() };
    attachRecorder(recorder);
    expect(recorder.read).toHaveBeenCalledExactlyOnceWith(read);
    expect(recorder.missing).toHaveBeenCalledExactlyOnceWith(missing);
    expect(Channel.instances[0]!.postMessage).not.toHaveBeenCalled();
  });
});
