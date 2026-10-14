/**
 * Outlook on the web, driven through its own UI in the person's signed-in Chrome.
 *
 * The compose window is opened through Outlook's public compose deeplink
 * (`/mail/deeplink/compose?to=…&subject=…&body=…`), the same link "mailto"
 * handlers and Microsoft's own docs use. It is a page route the person could
 * type, not one of OWA's internal endpoints, and nothing here ever calls those.
 * Opening a compose window never sends: Send stays the person's own click.
 *
 * Plan: common-docs systems/integrations/microsoft/projects/outlook-channels/PLAN.md
 * (channel 8, and the reviewed send's "the person's own click in Outlook").
 */

export type OwaHost = 'outlook.office.com' | 'outlook.live.com';

export interface OwaCompose {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  /** Work and school accounts use outlook.office.com; personal ones outlook.live.com. */
  host?: OwaHost | undefined;
}

export type OwaOpenResult =
  | { ok: true; tab_id: number; url: string; host: OwaHost }
  | { ok: false; reason: string; tab_id?: number };

/** Sign-in pages Outlook on the web sends a signed-out person to. */
const SIGN_IN_HOSTS = ['login.microsoftonline.com', 'login.live.com', 'login.microsoft.com'];

export function owaComposeUrl(c: OwaCompose): string {
  const host = c.host ?? 'outlook.office.com';
  const q = new URLSearchParams();
  q.set('to', c.to.join(';'));
  if (c.cc && c.cc.length > 0) q.set('cc', c.cc.join(';'));
  q.set('subject', c.subject);
  q.set('body', c.body);
  // URLSearchParams writes spaces as '+', which the deeplink shows literally.
  return `https://${host}/mail/deeplink/compose?${q.toString().replace(/\+/g, '%20')}`;
}

/** Where a loaded tab really is: the compose page, or a sign-in wall. */
export function classifyOwaUrl(url: string | undefined): 'compose' | 'sign_in' | 'other' {
  if (!url) return 'other';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'other';
  }
  if (SIGN_IN_HOSTS.includes(parsed.hostname)) return 'sign_in';
  if (
    (parsed.hostname === 'outlook.office.com' || parsed.hostname === 'outlook.live.com') &&
    parsed.pathname.startsWith('/mail')
  ) {
    return 'compose';
  }
  return 'other';
}

async function settled(tabId: number, timeoutMs: number): Promise<chrome.tabs.Tab | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return null;
    if (tab.status === 'complete') return tab;
    await new Promise((r) => setTimeout(r, 400));
  }
  return chrome.tabs.get(tabId).catch(() => null);
}

/** Open a filled compose window in a new tab. Never sends. */
export async function openOwaCompose(c: OwaCompose, timeoutMs = 30_000): Promise<OwaOpenResult> {
  const host = c.host ?? 'outlook.office.com';
  // outbound-ok: the user's own mail compose window, not a referral to a third-party site
  const tab = await chrome.tabs.create({ url: owaComposeUrl({ ...c, host }), active: true });
  if (tab.id === undefined) return { ok: false, reason: 'Chrome did not open a tab' };
  const loaded = await settled(tab.id, timeoutMs);
  const where = classifyOwaUrl(loaded?.url ?? loaded?.pendingUrl);
  if (where === 'sign_in') {
    return {
      ok: false,
      tab_id: tab.id,
      reason: `not signed in to Outlook on the web (${host}) in this Chrome; sign in there and ask again`,
    };
  }
  if (where !== 'compose') {
    return {
      ok: false,
      tab_id: tab.id,
      reason: `Outlook on the web did not open (${loaded?.url ?? 'no page'})`,
    };
  }
  return { ok: true, tab_id: tab.id, url: loaded?.url ?? '', host };
}
