/**
 * Email-client detector. Provider-aware — different DOM per app.
 *
 * Returns one of:
 *   - `inbox` bundle: list of conversation rows (sender, subject, time, unread)
 *   - `email_thread` bundle: ordered messages in the open conversation
 *   - null when not on a recognized email client
 *
 * Comet's signature workflow. Raw Gmail DOM is unusable; this is the win.
 *
 * Caveat: provider DOMs (especially Gmail) drift frequently. Selectors here
 * lean on roles + aria-labels which tend to be more stable than class names,
 * but expect to revisit. Fallbacks degrade to null rather than wrong data.
 *
 * Initial implementation: Gmail (mail.google.com). Outlook / Hey / Superhuman
 * are stubbed for future expansion — the routing layer is provider-agnostic.
 */

import { log } from '@/lib/debug/log';

export type EmailProvider = 'gmail' | 'outlook' | 'hey' | 'superhuman' | 'unknown';

export interface InboxBundle {
  shape: 'inbox';
  provider: EmailProvider;
  view: string; // "Inbox", "Sent", "Drafts", "Search:foo", etc.
  unread_count: number | null;
  threads: Array<{
    sender: string | null;
    subject: string | null;
    excerpt: string | null;
    time: string | null;
    unread: boolean;
    has_attachment: boolean;
    /** stable-ish identifier — typically a thread URL fragment */
    thread_id: string | null;
  }>;
}

export interface EmailThreadBundle {
  shape: 'thread';
  provider: EmailProvider;
  subject: string | null;
  participants: string[];
  messages: Array<{
    from: string | null;
    time: string | null;
    body_excerpt: string | null;
  }>;
}

export type EmailBundle = InboxBundle | EmailThreadBundle;

const GMAIL_RE = /^https?:\/\/mail\.google\.com\b/i;
const OUTLOOK_RE = /^https?:\/\/outlook\.(?:live|office|office365)\.com\b/i;
const HEY_RE = /^https?:\/\/app\.hey\.com\b/i;
const SUPERHUMAN_RE = /^https?:\/\/mail\.superhuman\.com\b/i;

export function detectEmailProvider(url: string): EmailProvider {
  if (GMAIL_RE.test(url)) return 'gmail';
  if (OUTLOOK_RE.test(url)) return 'outlook';
  if (HEY_RE.test(url)) return 'hey';
  if (SUPERHUMAN_RE.test(url)) return 'superhuman';
  return 'unknown';
}

export function isEmailUrl(url: string): boolean {
  return detectEmailProvider(url) !== 'unknown';
}

export async function detectEmail(tabId: number, url: string): Promise<EmailBundle | null> {
  const provider = detectEmailProvider(url);
  if (provider === 'gmail') return scrapeGmail(tabId);
  // Other providers are stubbed; surface presence with a minimal bundle so
  // the agent at least knows what app it's in.
  if (provider !== 'unknown') {
    log.info('scrape', `email provider ${provider} detected; rich extraction TODO`);
    return null;
  }
  return null;
}

async function scrapeGmail(tabId: number): Promise<EmailBundle | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (): EmailBundle | null => {
        // Gmail uses a hash route — different views map to different
        // hash prefixes. The thread view has a hash like #inbox/<msgid>.
        const hash = location.hash;
        const isThreadView = /#[^/]+\/[A-Za-z0-9]/.test(hash);

        // ── Thread view ────────────────────────────────────────────────────
        if (isThreadView) {
          // Subject — first <h2> in the thread container.
          const subject =
            document.querySelector<HTMLElement>('h2.hP, [role="main"] h2')?.innerText?.trim() ??
            null;

          // Each message in the thread is in a `[role="listitem"]` element
          // within the open thread; expand-collapsed messages count too.
          const messageEls = Array.from(
            document.querySelectorAll<HTMLElement>('[role="main"] [role="listitem"]'),
          ).filter((el) => {
            // Filter to message blocks (not other listitems like attachments).
            return el.querySelector('[email]') !== null;
          });

          const participants = new Set<string>();
          const messages = messageEls.slice(0, 30).map((el) => {
            const fromEl = el.querySelector<HTMLElement>('[email]');
            const fromName = fromEl?.getAttribute('name') ?? null;
            const fromEmail = fromEl?.getAttribute('email') ?? null;
            const from = fromName ?? fromEmail;
            if (from) participants.add(from);

            // Time — Gmail uses [data-tooltip] for the full timestamp.
            const timeEl = el.querySelector<HTMLElement>('[data-tooltip], span.g3');
            const time = timeEl?.getAttribute('data-tooltip') ?? timeEl?.innerText ?? null;

            // Body excerpt — the message content. Gmail wraps in `.a3s`.
            const bodyEl = el.querySelector<HTMLElement>('.a3s, [data-message-id] [dir]');
            const bodyText = (bodyEl?.innerText ?? '').trim();
            const bodyExcerpt = bodyText ? bodyText.slice(0, 400) : null;

            return { from, time, body_excerpt: bodyExcerpt };
          });

          return {
            shape: 'thread',
            provider: 'gmail',
            subject,
            participants: Array.from(participants),
            messages,
          };
        }

        // ── Inbox / list view ──────────────────────────────────────────────
        // Conversation rows are `tr.zA` (still stable in 2026 — used by
        // every mail-extension on the market). Each row has data attrs.
        const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('tr.zA'));
        if (rows.length === 0) return null; // not on an inbox-like view

        // View label — try the heading at top of the list, fall back to URL hash.
        let view = '';
        const headingEl = document.querySelector<HTMLElement>(
          '.aim.ain.aio span, [role="banner"] h2',
        );
        if (headingEl?.innerText) view = headingEl.innerText.trim();
        if (!view) {
          const m = hash.match(/^#([^/?]+)/);
          view = m ? decodeURIComponent(m[1]!) : 'Inbox';
        }

        const threads: InboxBundle['threads'] = rows.slice(0, 30).map((row) => {
          const unread = row.classList.contains('zE');
          const senderEl = row.querySelector<HTMLElement>('.yW span[email], .yW .zF');
          const sender = senderEl?.getAttribute('name') ?? senderEl?.innerText?.trim() ?? null;
          const subjectEl = row.querySelector<HTMLElement>('.bog, .y6 span:first-child');
          const subject = subjectEl?.innerText?.trim() ?? null;
          // Excerpt sits between subject and ' - '.
          const excerptEl = row.querySelector<HTMLElement>('.y2');
          const excerpt = excerptEl?.innerText?.trim().replace(/^- /, '') ?? null;
          const timeEl = row.querySelector<HTMLElement>('.xW span, .xY span');
          const time = timeEl?.getAttribute('title') ?? timeEl?.innerText?.trim() ?? null;
          // Attachment paperclip icon.
          const hasAttachment = row.querySelector('.brd, .yi') !== null;
          // Thread ID — Gmail puts it in data-legacy-thread-id or in a child link.
          const link = row.querySelector<HTMLAnchorElement>('a[href*="#"]');
          const threadId =
            row.getAttribute('data-legacy-thread-id') ??
            link?.href.match(/#[^/]+\/([A-Za-z0-9]+)/)?.[1] ??
            null;

          return {
            sender,
            subject,
            excerpt,
            time,
            unread,
            has_attachment: hasAttachment,
            thread_id: threadId,
          };
        });

        const unreadCount = threads.filter((t) => t.unread).length;

        return {
          shape: 'inbox',
          provider: 'gmail',
          view: view || 'Inbox',
          unread_count: unreadCount,
          threads,
        };
      },
    });
    return (first?.result as EmailBundle | null) ?? null;
  } catch (err) {
    log.warn('scrape', 'detectEmail (gmail) failed', err);
    return null;
  }
}
