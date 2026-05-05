/**
 * Page-extraction helpers for the Notes tab.
 *
 * Each helper reads from the active tab and returns a markdown block ready to
 * pass to `appendToContent(...)`. The helpers never write — they're pure data
 * producers; the editor UI calls `updateNote(id, { content: appendToContent(
 * existing, block) })` to actually persist.
 *
 * Page reads run via `chrome.scripting.executeScript` from the sidepanel —
 * same path the tool handlers use internally. Helpers return null when the
 * read fails (no active tab, blocked URL, no selection, etc.) so the UI can
 * show a "nothing captured" toast without crashing.
 */

interface ActiveTabSnapshot {
  id: number;
  url: string;
  title: string;
}

async function getActiveTab(): Promise<ActiveTabSnapshot | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !tab.url) return null;
    return { id: tab.id, url: tab.url, title: tab.title ?? tab.url };
  } catch {
    return null;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `> [Title](URL) — captured 2026-05-05` */
export async function extractUrlAndTitle(): Promise<string | null> {
  const tab = await getActiveTab();
  if (!tab) return null;
  return `> [${tab.title}](${tab.url}) — captured ${todayIso()}`;
}

/** `## From <title>\n\n<selection as quote block>\n\n— [Title](URL)` */
export async function extractSelection(): Promise<string | null> {
  const tab = await getActiveTab();
  if (!tab) return null;
  let text = '';
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection?.()?.toString() ?? '',
    });
    text = (first?.result as string | undefined)?.trim() ?? '';
  } catch {
    return null;
  }
  if (!text) return null;
  const quoted = text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `## Selection from ${tab.title}\n\n${quoted}\n\n— [${tab.title}](${tab.url}) — ${todayIso()}`;
}

/**
 * `## From <title>\n\n<readable body>\n\n— [Title](URL)`
 * Same Readability-lite extraction the `get_page_text` handler uses.
 */
export async function extractPageText(maxChars = 6000): Promise<string | null> {
  const tab = await getActiveTab();
  if (!tab) return null;
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (limit: number) => {
        function gather(root: Element): string {
          const clone = root.cloneNode(true) as Element;
          const drop = clone.querySelectorAll(
            'nav, aside, header, footer, script, style, noscript, [aria-hidden="true"], [hidden]',
          );
          for (const el of Array.from(drop)) el.remove();
          return ((clone as HTMLElement).innerText ?? '').replace(/\s+\n/g, '\n').trim();
        }
        let target: Element | null = document.querySelector('main, article, [role="main"]');
        if (!target) {
          const candidates = Array.from(
            document.querySelectorAll('article, section, div'),
          ) as HTMLElement[];
          let best: { el: HTMLElement; len: number } | null = null;
          for (const el of candidates) {
            const len = (el.innerText ?? '').length;
            if (len > 500 && (!best || len > best.len)) best = { el, len };
          }
          target = best?.el ?? document.body;
        }
        let text = gather(target);
        if (text.length > limit) text = `${text.slice(0, limit)}…`;
        return text;
      },
      args: [maxChars],
    });
    const text = ((first?.result as string | undefined) ?? '').trim();
    if (!text) return null;
    return `## From ${tab.title}\n\n${text}\n\n— [${tab.title}](${tab.url}) — ${todayIso()}`;
  } catch {
    return null;
  }
}

/** `## Links from <title>\n\n- [text](url)\n…` (capped to 50 entries) */
export async function extractPageLinks(): Promise<string | null> {
  const tab = await getActiveTab();
  if (!tab) return null;
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const out: Array<{ href: string; text: string }> = [];
        const seen = new Set<string>();
        const anchors = document.querySelectorAll('a[href]');
        for (const a of Array.from(anchors)) {
          const el = a as HTMLAnchorElement;
          const href = el.href;
          if (!href || href.startsWith('javascript:')) continue;
          if (seen.has(href)) continue;
          seen.add(href);
          const text = (el.innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');
          if (!text) continue;
          out.push({ href, text: text.slice(0, 120) });
          if (out.length >= 50) break;
        }
        return out;
      },
    });
    const links = (first?.result as Array<{ href: string; text: string }> | undefined) ?? [];
    if (links.length === 0) return null;
    const lines = links.map((l) => `- [${l.text}](${l.href})`).join('\n');
    return `## Links from ${tab.title}\n\n${lines}\n\n— ${tab.url} — ${todayIso()}`;
  } catch {
    return null;
  }
}

/**
 * Page metadata block — title, description, byline, and keywords if present.
 * Useful when the user just wants a reference card, not the full body text.
 */
export async function extractPageMetadata(): Promise<string | null> {
  const tab = await getActiveTab();
  if (!tab) return null;
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const meta = (s: string) =>
          document
            .querySelector(`meta[name="${s}"], meta[property="${s}"]`)
            ?.getAttribute('content') ?? null;
        return {
          title: document.title,
          description: meta('description') ?? meta('og:description'),
          author:
            meta('author') ??
            meta('article:author') ??
            document.querySelector('[rel="author"]')?.textContent?.trim() ??
            null,
          published: meta('article:published_time') ?? meta('date'),
          keywords: meta('keywords'),
        };
      },
    });
    const m = first?.result as
      | {
          title: string;
          description: string | null;
          author: string | null;
          published: string | null;
          keywords: string | null;
        }
      | undefined;
    if (!m) return null;
    const lines: string[] = [`### ${m.title}`, `<${tab.url}>`];
    if (m.author) lines.push(`**Author:** ${m.author}`);
    if (m.published) lines.push(`**Published:** ${m.published}`);
    if (m.description) lines.push('', m.description);
    if (m.keywords) lines.push('', `*Keywords:* ${m.keywords}`);
    lines.push('', `*Captured ${todayIso()}*`);
    return lines.join('\n');
  } catch {
    return null;
  }
}
