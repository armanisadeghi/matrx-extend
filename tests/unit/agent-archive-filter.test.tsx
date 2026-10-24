/**
 * THE ARCHIVED-ITEMS LAW, proven on the surfaces this extension actually mounts.
 *
 * > "everything should have an archive filter, and the default should always
 * >  hide archived, but seeing archived items should be one or two clicks
 * >  away." — Arman, 2026-09-09 (`common-docs/policies/archived-items.md`)
 *
 * The extension's every archivable list IS the agent picker: Chat, Pilot,
 * Settings › Default agent, and the AI Extract showcase all mount
 * `AgentListDropdown` from `@ai-matrx/agents/catalog/react` and nothing else
 * in this repo enumerates rows of an archivable entity (census row C1,
 * `common-docs/projects/archived-items-law/CENSUS-clients.md`). So the law is
 * satisfied here by the PACKAGE's chip — and what is this repo's to get wrong
 * is whether the chip actually reaches the panel through the props these four
 * call sites pass. That is what this file runs.
 *
 * 🚨 WHAT THIS FILE CANNOT PROVE — say it, never let green imply more. A
 * Chrome extension side panel cannot be driven from vitest: there is no
 * `chrome.sidePanel`, no service worker, no signed-in Supabase session here.
 * The live smoke — open the side panel, click the chip, watch archived agents
 * appear — is `docs/feature-tests.md` § THE ONE AGENT PICKER and it is a human
 * step. This is a component test over the REAL published package
 * (`@ai-matrx/agents@0.9.2`) and the LIVE fixture rows, mounted the way the
 * four surfaces mount it. It proves the control exists, defaults to hiding,
 * and reveals in one click. It does not prove the pixels.
 *
 * Rows come from `__fixtures__/agx-get-list-full.json` — captured from the
 * live platform DB, including the two genuinely-archived agents that
 * `agx_get_list_full()` really returns (it does not filter `is_archived`; the
 * package is what hides them). A hand-invented archived row would prove
 * nothing about the shape the server sends.
 */

import { createAgentCatalog } from '@ai-matrx/agents/catalog';
import type { AgentCatalogClient, AgentCatalogTransport } from '@ai-matrx/agents/catalog';
import {
  AgentCatalogProvider,
  AgentListDropdown,
  AgentListInlinePicker,
} from '@ai-matrx/agents/catalog/react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import fixture from './__fixtures__/agx-get-list-full.json';

type Row = Omit<(typeof fixture.rows)[number], 'tags'> & { tags: string[] };
const ROWS: Row[] = fixture.rows;
const pickerPageRequests: Record<string, unknown>[] = [];

/** The archived rows the live RPC returns. Named, so a re-capture that loses
 *  them fails loudly here instead of quietly making this file prove nothing. */
const ARCHIVED_SYSTEM = 'Foundry Planner';
const ARCHIVED_MINE = 'New Agent Template';

const TEST_USER = '87a6e699-3622-4869-8843-d0867456c0dd';

/** Same structural supabase-js stand-in as `agent-picker-wiring.test.tsx`: a
 *  TRANSPORT stub over live rows, never a logic stub. Every filter decision
 *  below is the package's. */
function fixtureClient(): AgentCatalogClient {
  const answer = (rows: unknown[]) => {
    const builder = {
      data: rows,
      error: null,
      count: rows.length,
      range: () => Promise.resolve({ data: rows, error: null, count: rows.length }),
      order: () => builder,
      // biome-ignore lint/suspicious/noThenProperty: the real builder is a thenable
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve),
    };
    return builder as never;
  };
  const rpc = (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'agx_get_list_full') return answer(ROWS);
    if (fn !== 'agx_picker_page') return answer([]);

    const request = args ?? {};
    pickerPageRequests.push(request);
    const tab = request.p_tab;
    const archive = request.p_archive;
    const includeQuick = request.p_include_quick;
    const inTab = (row: Row) => {
      if (tab === 'mine') return row.agent_type === 'user' && row.is_owner;
      if (tab === 'shared') return row.agent_type === 'user' && !row.is_owner;
      if (tab === 'all') return row.agent_type === 'user';
      if (tab === 'system') return row.agent_type === 'builtin';
      return true; // all_system includes both user and builtin rows.
    };
    const inArchive = (row: Row) =>
      archive === 'both' || (archive === 'archived' ? row.is_archived : !row.is_archived);
    const sortKey = (row: Row): [number, number, string, string] => {
      const lastUsedAt = (row as Row & { last_used_at?: string }).last_used_at;
      return [
        row.is_favorite ? 0 : 1,
        lastUsedAt ? -Date.parse(lastUsedAt) / 1000 : 1e12,
        row.name.toLowerCase(),
        row.id,
      ];
    };
    const compareKey = (left: ReturnType<typeof sortKey>, right: ReturnType<typeof sortKey>) => {
      for (let index = 0; index < left.length; index += 1) {
        const a = left[index];
        const b = right[index];
        if (a === b) continue;
        return index < 2 ? Number(a) - Number(b) : String(a).localeCompare(String(b));
      }
      return 0;
    };
    const visible = ROWS.filter(
      (row) =>
        inTab(row) &&
        inArchive(row) &&
        (includeQuick !== false || !row.tags.includes('kind:quick')),
    ).sort((left, right) => compareKey(sortKey(left), sortKey(right)));
    const limit = Number(request.p_limit ?? 50);
    const cursor = request.p_cursor as {
      k1?: number;
      k2?: number;
      k3?: string;
      k4?: string;
    } | null;
    const afterCursor = cursor
      ? visible.filter(
          (row) => compareKey(sortKey(row), [cursor.k1!, cursor.k2!, cursor.k3!, cursor.k4!]) > 0,
        )
      : visible;
    const pageRows = afterCursor.slice(0, limit);
    const next = afterCursor.length > limit ? sortKey(pageRows[pageRows.length - 1]!) : null;
    const countsFor = (row: Row) =>
      inArchive(row) && (includeQuick !== false || !row.tags.includes('kind:quick'));
    return {
      data: {
        rows: pageRows,
        next_cursor: next ? { k1: next[0], k2: next[1], k3: next[2], k4: next[3] } : null,
        counts: {
          mine: ROWS.filter((row) => countsFor(row) && row.agent_type === 'user' && row.is_owner)
            .length,
          shared: ROWS.filter((row) => countsFor(row) && row.agent_type === 'user' && !row.is_owner)
            .length,
          all: ROWS.filter((row) => countsFor(row) && row.agent_type === 'user').length,
          system: ROWS.filter((row) => countsFor(row) && row.agent_type === 'builtin').length,
          archived_hidden:
            archive === 'active'
              ? ROWS.filter(
                  (row) =>
                    inTab(row) &&
                    row.is_archived &&
                    (includeQuick !== false || !row.tags.includes('kind:quick')),
                ).length
              : 0,
        },
      },
      error: null,
    };
  };
  // Since @ai-matrx/associations 0.14.0 the catalog's associations store calls
  // through `schema(name).rpc(...)`, so the stand-in carries both doors.
  return { rpc, schema: () => ({ rpc }) } as unknown as AgentCatalogClient;
}

const noTransport: AgentCatalogTransport = {
  fetch: () => Promise.resolve(new Response('not found', { status: 404 })),
};

let seq = 0;

function makeCatalog(defaults?: { archiveFilter?: 'active' | 'archived' | 'both' }) {
  return createAgentCatalog({
    client: fixtureClient(),
    identity: { requireUserId: () => TEST_USER },
    transport: noTransport,
    catalogId: `arch-test-${++seq}`,
    errorSink: () => undefined,
    ...(defaults !== undefined && { defaults }),
  });
}

/** The inline picker with its tabs pinned, so an assertion about archived rows
 *  is never really an assertion about which tab the heuristic opened on. */
function mountInline(tab: 'mine' | 'system', archiveFilter?: 'active' | 'archived' | 'both') {
  const catalog = makeCatalog(archiveFilter ? { archiveFilter } : undefined);
  return render(
    <AgentCatalogProvider catalog={catalog}>
      <AgentListInlinePicker
        consumerId={`arch-consumer-${seq}`}
        onSelect={() => undefined}
        initialTab={tab}
      />
    </AgentCatalogProvider>,
  );
}

afterEach(cleanup);

describe('THE ARCHIVED-ITEMS LAW on the extension agent picker', () => {
  it('the fixture really carries archived rows — otherwise this file proves nothing', () => {
    const archived = ROWS.filter((row) => row.is_archived);
    expect(archived.map((row) => row.name).sort()).toEqual([ARCHIVED_MINE, ARCHIVED_SYSTEM].sort());
  });

  it('renders the archive control on the filter bar', async () => {
    mountInline('mine');
    const chip = await screen.findByTestId('agent-archive-filter');
    await waitFor(() =>
      expect(pickerPageRequests).toContainEqual(
        expect.objectContaining({ p_tab: 'mine', p_archive: 'active', p_include_quick: true }),
      ),
    );
    expect(chip).toBeTruthy();
    // The law's default, stated on the control itself.
    expect(chip.getAttribute('aria-label')).toMatch(/archive filter: hide archived/i);
  });

  it('hides archived agents by default and reveals them in ONE click', async () => {
    mountInline('mine');
    // A real, un-archived agent OF THIS USER — proves the list rendered at all.
    await waitFor(() => expect(screen.getByText('Quick Test Agent')).toBeTruthy());
    expect(screen.queryByText(ARCHIVED_MINE)).toBeNull();

    await userEvent.click(screen.getByTestId('agent-archive-filter'));

    await waitFor(() => expect(screen.getByText(ARCHIVED_MINE)).toBeTruthy());
    await waitFor(() =>
      expect(pickerPageRequests).toContainEqual(
        expect.objectContaining({ p_tab: 'mine', p_archive: 'both', p_include_quick: true }),
      ),
    );
    // "Show all" — the active row is still there beside it.
    expect(screen.getByText('Quick Test Agent')).toBeTruthy();
  });

  it('a second click narrows to archived only — three states, not a boolean', async () => {
    mountInline('mine');
    await waitFor(() => expect(screen.getByText('Quick Test Agent')).toBeTruthy());
    const chip = screen.getByTestId('agent-archive-filter');
    await userEvent.click(chip);
    await userEvent.click(chip);
    await waitFor(() => expect(screen.queryByText('Quick Test Agent')).toBeNull());
    expect(screen.getByText(ARCHIVED_MINE)).toBeTruthy();
  });

  /**
   * Census row A1: the System/public tab used to be exempt from the filter, so
   * an archived builtin rendered there whatever the control said. This is the
   * falsifiability leg — it fails if the tab ever goes back to showing
   * archived rows unasked.
   */
  it('the System tab obeys the filter too — no tab is exempt', async () => {
    mountInline('system');
    await waitFor(() => expect(screen.getByText('Matrx Browser Agent')).toBeTruthy());
    expect(screen.queryByText(ARCHIVED_SYSTEM)).toBeNull();

    await userEvent.click(screen.getByTestId('agent-archive-filter'));
    await waitFor(() => expect(screen.getByText(ARCHIVED_SYSTEM)).toBeTruthy());
  });

  /** Opinions become knobs: the default is org-configurable, not code taste. */
  it('honours the catalog-wide `defaults.archiveFilter` knob', async () => {
    mountInline('mine', 'both');
    await waitFor(() => expect(screen.getByText(ARCHIVED_MINE)).toBeTruthy());
    expect(screen.getByTestId('agent-archive-filter').getAttribute('aria-label')).toMatch(
      /archive filter: show all/i,
    );
  });
});

/**
 * The four real call sites all mount `AgentListDropdown` (Chat, Pilot,
 * Settings › Default agent, AI Extract), whose panel lives behind a trigger.
 * Mounted with exactly the props `SettingsView.tsx` passes.
 */
describe('the dropdown the Settings and Chat surfaces actually mount', () => {
  it('opens to a panel carrying the archive control', async () => {
    const catalog = makeCatalog();
    render(
      <AgentCatalogProvider catalog={catalog}>
        <AgentListDropdown
          consumerId="extend.settings.default-agent"
          activeAgentId={null}
          onSelect={() => undefined}
          compact
        />
      </AgentCatalogProvider>,
    );
    // The trigger, before anything is chosen.
    const trigger = await screen.findByRole('button');
    await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByTestId('agent-archive-filter')).toBeTruthy());
  });
});
