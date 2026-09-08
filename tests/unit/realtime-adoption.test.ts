/**
 * THE GUARD FOR THE CLASS: no hand-rolled Supabase realtime channels in this
 * repo, ever again.
 *
 * `@ai-matrx/realtime` exists because the hard parts of realtime are invisible
 * until they hurt — echo storms that freeze a tab, a reconnect with no re-read
 * that leaves a permanently wrong screen looking healthy, a private Database
 * Broadcast channel whose join was refused while it reports itself connected.
 * Every one of those was live in this repo's four hand-rolled `.channel(`
 * blocks (frontend bridge, scheduler client, and the two lists surfaces).
 *
 * A test that only checked the four files we happened to fix would let the
 * fifth one land. So this walks ALL tracked source and fails on any
 * `.channel(` call site — it would have failed before the 2026-09-07 adoption
 * and passes after it.
 *
 * It also pins the declaration side: the lists namespaces live in ONE module
 * (supabase-js dedupes channels by topic, so two features that both picked
 * `"lists"` would silently share one channel and lose each other's bindings),
 * and the scheduler topic keeps the FOREIGN root Postgres publishes on —
 * renaming that to `mx:` would put this client in a room of one with nothing
 * failing on either end.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { listsAllTasksChannel, listsConversationTasksChannel } from '@/lib/lists/realtime';
import { schedulerBroadcastTopic } from '@/lib/scheduler-client/realtime';

const SRC = join(__dirname, '..', '..', 'src');
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => full.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

describe('realtime adoption', () => {
  it('has zero hand-rolled supabase .channel( call sites in src/', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const contents = readFileSync(file, 'utf8');
      contents.split('\n').forEach((line, index) => {
        // Comments are allowed to NAME the old pattern — several module headers
        // explain what was deleted and why. Only real call sites are offenders.
        const code = line.trim();
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
        if (!code.includes('.channel(')) return;
        offenders.push(`${relative(SRC, file)}:${index + 1}: ${code}`);
      });
    }
    expect(
      offenders,
      'Hand-rolled Supabase realtime channels found. Open the channel through ' +
        '@ai-matrx/realtime instead: useChannel (React), or manager.open / ' +
        'subscribeToRealtimeManager (module-level owners). See the package README.',
    ).toEqual([]);
  });

  it('declares the two lists channels in one place with distinct topics', () => {
    const all = listsAllTasksChannel.topic();
    const one = listsConversationTasksChannel.topic({ conversationId: 'conv-1' });
    const other = listsConversationTasksChannel.topic({ conversationId: 'conv-2' });

    expect(all).not.toBe(one);
    expect(one).not.toBe(other);
    expect(one).toContain('conv-1');
    // Declared topics are `mx:`-rooted; only a peer-owned topic escapes that.
    expect(all.startsWith('mx:')).toBe(true);
    expect(one.startsWith('mx:')).toBe(true);
  });

  it('keeps the scheduler broadcast topic on the root Postgres publishes to', () => {
    // `realtime.broadcast_changes()` publishes on `scheduler:user:<id>`. This is
    // a foreign topic: the peer is a Postgres trigger, not us.
    expect(schedulerBroadcastTopic('user-9')).toBe('scheduler:user:user-9');
  });
});
