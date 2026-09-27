import { mountListPicker, unmountListPicker } from '@/lib/data-pattern/list-picker';
import { listPatternMode } from '@/lib/data-pattern/modes/list-pattern';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PickerMessage = {
  kind: string;
  payload: {
    list_root?: string;
    item_selector?: string;
    field_paths?: Array<{ name: string; rel_selector: string }>;
    session_id?: string;
  } | null;
};
const sendMessage = vi.fn(async (_message: PickerMessage) => ({ ack: true }));
const events = [
  ['Neon Nights at Area15', '/events/neon-nights'],
  ['Desert Pulse at Downtown Events', '/events/desert-pulse'],
  ['Skyline Sessions at The Roof', '/events/skyline-sessions'],
  ['Afterhours at The Warehouse', '/events/afterhours'],
  ['Sunrise Set at Eastside Hall', '/events/sunrise-set'],
] as const;

function click(selector: string, root: ParentNode = document) {
  const target = root.querySelector(selector);
  expect(target, `missing ${selector}`).not.toBeNull();
  target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}
function shadow(): ShadowRoot {
  const root = document.getElementById('matrx-list-picker-host')?.shadowRoot;
  if (!root) throw new Error('picker not mounted');
  return root;
}
function result(): PickerMessage['payload'] {
  return (
    sendMessage.mock.calls
      .map(([message]) => message)
      .find((m) => m.kind === 'data:list-picker-result')?.payload ?? null
  );
}
function requireResult(): NonNullable<PickerMessage['payload']> {
  const payload = result();
  if (!payload) throw new Error('picker produced no result');
  return payload;
}
function runPickedPattern(payload: NonNullable<PickerMessage['payload']>) {
  const titleSelector = payload.field_paths?.[0]?.rel_selector ?? '';
  const urlSelector = payload.field_paths?.[1]?.rel_selector ?? '';
  if (!titleSelector || !urlSelector || titleSelector === urlSelector) {
    throw new Error('picker did not select two distinct title and URL fields');
  }
  return listPatternMode.runInPage({
    list_root: payload.list_root ?? '',
    item_selector: payload.item_selector ?? '',
    field_paths: [
      { name: 'title', rel_selector: titleSelector },
      { name: 'url', rel_selector: urlSelector, attr: 'href' },
    ],
  });
}

beforeEach(() => {
  document.body.innerHTML = `<section id="wideeventsList">${events
    .map(
      ([
        title,
        url,
      ]) => `<div class="wideeventwrapper"><li itemtype="Event"><ul class="briefDetails">
      <li><span class="eventTitle">${title}</span><a class="eventUrl" href="${url}">Details</a></li>
      <li>Las Vegas</li><li>Saturday</li>
    </ul></li></div>`,
    )
    .join('')}</section>`;
  Object.assign(chrome, { runtime: { sendMessage } });
  sendMessage.mockClear();
});
afterEach(() => {
  unmountListPicker();
  document.body.innerHTML = '';
});

describe('D43 nested-list picking', () => {
  it('adds a clicked title to a seeded event-card pattern without changing its scope', () => {
    // The second argument is intentionally ignored by the current picker: red before repair.
    (mountListPicker as (id: string, seed?: { list_root: string; item_selector: string }) => void)(
      'seeded-events',
      { list_root: '#wideeventsList', item_selector: 'div.wideeventwrapper' },
    );
    click('.wideeventwrapper:first-child .eventTitle');
    click('.wideeventwrapper:first-child .eventUrl');
    click('#done', shadow());
    const pattern = result();
    expect(pattern?.list_root).toBe('#wideeventsList');
    expect(pattern?.item_selector).toBe('div.wideeventwrapper');
    expect(pattern?.field_paths).toHaveLength(2);
    const rows = runPickedPattern(requireResult());
    expect(rows.map((row) => row.title)).toEqual(events.map(([title]) => title));
    expect(rows.map((row) => row.url)).toEqual(events.map(([, url]) => url));
  });

  it('offers an explicit outer-card scope when a fresh title click also matches nested details', () => {
    mountListPicker('fresh-events');
    click('.wideeventwrapper:first-child .eventTitle');
    expect(
      sendMessage.mock.calls.some(([message]) => message.kind === 'data:list-picker-item-detected'),
    ).toBe(false);
    const choices = Array.from(shadow().querySelectorAll<HTMLButtonElement>('[data-scope-choice]'));
    expect(choices.map((button) => button.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/3.*li/i),
        expect.stringMatching(/5.*wideeventwrapper/i),
      ]),
    );
    const outer = choices.find((button) => /5.*wideeventwrapper/i.test(button.textContent ?? ''));
    expect(outer).toBeDefined();
    outer?.click();
    click('.wideeventwrapper:first-child .eventTitle');
    click('.wideeventwrapper:first-child .eventUrl');
    click('#done', shadow());
    const pattern = result();
    expect(pattern?.list_root).toBe('#wideeventsList');
    expect(pattern?.item_selector).toBe('div.wideeventwrapper');
    expect(runPickedPattern(requireResult()).map((row) => row.title)).toEqual(
      events.map(([title]) => title),
    );
  });

  it('lets an unseeded user choose the nested detail list deliberately', () => {
    mountListPicker('fresh-details');
    click('.wideeventwrapper:first-child .eventTitle');
    const detailChoice = Array.from(
      shadow().querySelectorAll<HTMLButtonElement>('[data-scope-choice]'),
    ).find((button) => /3.*li/i.test(button.textContent ?? ''));
    expect(detailChoice).toBeDefined();
    detailChoice?.click();
    click('.wideeventwrapper:first-child .eventTitle');
    click('.wideeventwrapper:first-child .eventUrl');
    click('#done', shadow());
    const pattern = result();
    expect(pattern?.list_root).toMatch(/briefDetails/);
    expect(pattern?.item_selector).toBe('li');
    const rows = runPickedPattern(requireResult());
    // D44 excludes detail items where neither selected field exists.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Neon Nights at Area15');
    expect(rows[0]?.url).toBe('/events/neon-nights');
  });

  it('warns on a missing seed and lets the new page choose and extract its own scope', () => {
    const talks = [
      ['Graph Systems Summit', '/talks/graphs'],
      ['Realtime Data Workshop', '/talks/realtime'],
      ['Reliable Browser Agents', '/talks/agents'],
    ] as const;
    document.body.innerHTML = `<section id="otherCalendar">${talks
      .map(
        ([title, url]) => `<article class="talk"><ul class="details">
        <li><span class="talkTitle">${title}</span><a class="talkUrl" href="${url}">Details</a></li>
        <li>Room A</li>
      </ul></article>`,
      )
      .join('')}</section>`;
    (mountListPicker as (id: string, seed?: { list_root: string; item_selector: string }) => void)(
      'new-page',
      { list_root: '#wideeventsList', item_selector: 'div.wideeventwrapper' },
    );
    expect(shadow().textContent).toMatch(/earlier list is no longer on this page/i);
    click('#otherCalendar article:first-child .talkTitle');
    const choices = Array.from(shadow().querySelectorAll<HTMLButtonElement>('[data-scope-choice]'));
    expect(choices.map((button) => button.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/2.*li/i),
        expect.stringMatching(/3.*article/i),
      ]),
    );
    choices.find((button) => /3.*article/i.test(button.textContent ?? ''))?.click();
    click('#otherCalendar article:first-child .talkTitle');
    click('#otherCalendar article:first-child .talkUrl');
    click('#done', shadow());
    expect(result()?.list_root).toBe('#otherCalendar');
    expect(result()?.item_selector).toBe('article.talk');
    const rows = runPickedPattern(requireResult());
    expect(rows.map((row) => row.title)).toEqual(talks.map(([title]) => title));
    expect(rows.map((row) => row.url)).toEqual(talks.map(([, url]) => url));
  });

  it('cancels a seeded pick without publishing a result or leaving an overlay', () => {
    (mountListPicker as (id: string, seed?: { list_root: string; item_selector: string }) => void)(
      'seeded-to-cancel',
      { list_root: '#wideeventsList', item_selector: 'div.wideeventwrapper' },
    );
    click('#cancel', shadow());
    expect(result()).toBeNull();
    expect(document.getElementById('matrx-list-picker-host')).toBeNull();
  });
});
