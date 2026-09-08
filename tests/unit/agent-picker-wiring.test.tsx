/**
 * THE HOST-WIRING PROOF for THE ONE AGENT PICKER.
 *
 * 🚨 What this file does and does NOT prove. The picker's own behaviour — the
 * membership rule, the ordering, the tabs, the sort comparators, the scorer —
 * is tested in `@ai-matrx/agents/catalog`'s 295-case parity matrix, against the
 * matrx-frontend originals. Re-testing it here would prove nothing new.
 *
 * What is genuinely THIS repo's to get wrong is the WIRING: the ports in
 * `src/lib/agents/catalog.ts` (client, identity, transport), the provider
 * mounts, and the ids the picker hands back to the send path. That is what runs
 * here, and it runs against `__fixtures__/agx-get-list-full.json` — rows and
 * mandate resolutions CAPTURED FROM THE LIVE PLATFORM DB on 2026-09-08, not
 * invented. A hand-built row would only prove the picker parses a shape the
 * server does not send.
 *
 * This is not a substitute for looking at the panel. The live smoke for these
 * surfaces is `docs/feature-tests.md` § THE ONE AGENT PICKER.
 */

import { createAgentCatalog, mandateAgentId } from '@ai-matrx/agents/catalog';
import type { AgentCatalogClient, AgentCatalogTransport } from '@ai-matrx/agents/catalog';
import { AgentCatalogProvider, AgentListInlinePicker } from '@ai-matrx/agents/catalog/react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/agx-get-list-full.json';

import { DEFAULT_CHAT_MANDATE_KEY, DEFAULT_CHAT_MANDATE_REF } from '@/lib/mandates';

type Row = (typeof fixture.rows)[number];
const ROWS: Row[] = fixture.rows;
const RESOLUTIONS: Record<string, unknown> = fixture.resolutions;

/**
 * A structural stand-in for supabase-js that answers exactly what the package
 * asks for. It is a TRANSPORT stub, not a logic stub — the rows it returns are
 * the live ones, and every filter/sort decision is still the package's.
 */
function fixtureClient(): AgentCatalogClient {
  const answer = (rows: unknown[]) => {
    const builder = {
      data: rows,
      error: null,
      count: rows.length,
      range: () => Promise.resolve({ data: rows, error: null, count: rows.length }),
      order: () => builder,
      // supabase-js's rpc() builder IS a thenable — that is the shape the
      // package awaits, and a stand-in that is not thenable would not exercise
      // the real call path.
      // biome-ignore lint/suspicious/noThenProperty: the real builder is a thenable
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve),
    };
    return builder as never;
  };
  return {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      if (fn === 'agx_get_list_full') return answer(ROWS);
      if (fn === 'agx_resolve_agent_address') {
        // The address resolver's own shape (`p_ids` in, `agent_id`/`agent_name`
        // out) — the door the package uses to name a Mandate Holder that is not
        // in the loaded list yet.
        const ids = (args?.p_ids as string[] | undefined) ?? [];
        return answer(
          ROWS.filter((r) => ids.includes(r.id)).map((r) => ({
            agent_id: r.id,
            agent_name: r.name,
            description: r.description,
          })),
        );
      }
      if (fn === 'agx_search') return answer([]);
      return answer([]);
    },
    schema: () => ({
      from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }),
  };
}

/** Stands in for `src/lib/agents/catalog.ts`'s transport over `buildHeaders`. */
function fixtureTransport(): AgentCatalogTransport {
  return {
    fetch: (path: string) => {
      const match = /^\/mandates\/([^/]+)\/resolution$/.exec(path);
      const key = match?.[1] ? decodeURIComponent(match[1]) : '';
      const body = RESOLUTIONS[key];
      if (!body) return Promise.resolve(new Response('not found', { status: 404 }));
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    },
  };
}

let seq = 0;
function mountPicker(props: { onSelect: (id: string) => void; defaultMandateKey?: string }) {
  const catalog = createAgentCatalog({
    client: fixtureClient(),
    identity: { requireUserId: () => '87a6e699-3622-4869-8843-d0867456c0dd' },
    transport: fixtureTransport(),
    // A unique id per test: the catalog registry lives on globalThis and a
    // reused id is the same catalog (the package screams about it, correctly).
    catalogId: `test-${++seq}`,
    errorSink: () => undefined,
  });
  return render(
    <AgentCatalogProvider catalog={catalog}>
      <AgentListInlinePicker
        consumerId={`test-consumer-${seq}`}
        onSelect={props.onSelect}
        {...(props.defaultMandateKey !== undefined && {
          defaultMandateKey: props.defaultMandateKey,
        })}
      />
    </AgentCatalogProvider>,
  );
}

afterEach(cleanup);

describe('the package picker, wired the way this extension wires it', () => {
  it('renders the live agent roster through the injected client', async () => {
    mountPicker({ onSelect: () => undefined });
    await waitFor(() => expect(screen.getByText('Workflow Conductor')).toBeTruthy());
    expect(screen.getByText('Agent Goal Writer')).toBeTruthy();
    expect(screen.getByText('Meet In-Meeting Analyst')).toBeTruthy();
  });

  /**
   * The default row renders in its own "Default" section at the top. The
   * Holder ALSO appears in the ordinary roster (it is a real builtin), so
   * every assertion below is anchored to that section — matching the name
   * anywhere on screen would pass on the ordinary row and prove nothing.
   */
  async function defaultSection(): Promise<HTMLElement> {
    const heading = await screen.findByText('Default');
    const section = heading.parentElement?.nextElementSibling;
    expect(section).toBeTruthy();
    return section as HTMLElement;
  }

  it('names the default row from the LIVE mandate Holder, not a constant', async () => {
    // The extension used to prepend a row hardcoded as "Matrx Browser Agent".
    // That name is not written by this repo any more: it arrives from
    // GET /mandates/extend.browser_chat/resolution through the injected
    // transport, then from the agent row the catalog reads. Rebind the mandate
    // and the picker renames itself with no deploy.
    mountPicker({ onSelect: () => undefined, defaultMandateKey: DEFAULT_CHAT_MANDATE_KEY });
    const section = await defaultSection();
    expect(within(section).getByText('Matrx Browser Agent')).toBeTruthy();
  });

  it('hands back `mandate:<key>` for the default row — the id the send path routes', async () => {
    const onSelect = vi.fn();
    mountPicker({ onSelect, defaultMandateKey: DEFAULT_CHAT_MANDATE_KEY });
    const section = await defaultSection();
    await userEvent.click(within(section).getByText('Matrx Browser Agent'));
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0]?.[0]).toBe(DEFAULT_CHAT_MANDATE_REF);
    expect(onSelect.mock.calls[0]?.[0]).toBe(mandateAgentId(DEFAULT_CHAT_MANDATE_KEY));
  });

  it('a picker on the OTHER mandate key gets the OTHER Holder', async () => {
    // Proof of the per-surface ruling: the package carries one default row per
    // picker instance, so AI Extract's picker is not Chat's picker with a
    // different label.
    mountPicker({
      onSelect: () => undefined,
      defaultMandateKey: 'extend.structured_extractor',
    });
    const section = await defaultSection();
    expect(within(section).getByText('Structured Extractor')).toBeTruthy();
    expect(within(section).queryByText('Matrx Browser Agent')).toBeNull();
  });

  it('hands back a bare agent UUID for an ordinary row', async () => {
    const onSelect = vi.fn();
    mountPicker({ onSelect });
    await waitFor(() => expect(screen.getByText('Workflow Conductor')).toBeTruthy());
    await userEvent.click(screen.getByText('Workflow Conductor'));
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0]?.[0]).toBe('8814e16d-ba96-45a6-a8b2-785d37037306');
  });

  it('filters the roster by search, through the package', async () => {
    mountPicker({ onSelect: () => undefined });
    await waitFor(() => expect(screen.getByText('Workflow Conductor')).toBeTruthy());
    const search = screen.getByPlaceholderText(/search agents/i);
    await userEvent.type(search, 'Workflow');
    await waitFor(() => expect(screen.queryByText('Agent Goal Writer')).toBeNull());
    expect(screen.getByText('Workflow Conductor')).toBeTruthy();
  });
});
