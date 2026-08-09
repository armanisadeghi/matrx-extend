import { cn } from '@/lib/utils';
import { isOpenableUrl } from '@/lib/url/openable';
import { ExternalLink } from 'lucide-react';

/**
 * The door primitive for a URL.
 *
 * Per the No Dead Ends door law, a URL rendered as text is a dead end. Before
 * this existed, every surface in the side panel hand-rolled its own version —
 * some as a `<button>` + `chrome.tabs.create`, some as a bare `<span>`, most
 * of the SEO surfaces as nothing at all. Reach for this instead of writing
 * another one.
 *
 * It renders an anchor rather than a button on purpose: an anchor gets all
 * four doors from the browser for free — click to open, middle-click / ⌘-click
 * for a background tab, right-click → "Open in new tab" / "Copy link address",
 * and a real hover status. A `chrome.tabs.create` button gets exactly one of
 * those. `target="_blank"` keeps the side panel itself from navigating away,
 * which would blow away the user's whole session.
 *
 * **A non-openable value degrades to plain text, never to a broken link.** The
 * values here come from page-controlled metadata (`<meta content>`, `<link
 * href>`), so `javascript:`, `data:`, junk, and relative paths all arrive
 * routinely — see `isOpenableUrl` for why each is excluded.
 */
export function OpenUrl({
  url,
  label,
  className,
  mono = false,
  showIcon = true,
}: {
  /** The destination. Non-http(s) values render as plain text. */
  url: string | null | undefined;
  /** Visible text. Defaults to the URL itself. */
  label?: string | undefined;
  className?: string | undefined;
  /** Render in a monospace face — right for raw URLs, wrong for prose labels. */
  mono?: boolean | undefined;
  /** Show the trailing external-link glyph. Turn off in dense chip rows. */
  showIcon?: boolean | undefined;
}) {
  const text = label ?? url ?? '';
  const base = cn('min-w-0 break-all', mono && 'font-mono', className);

  if (!isOpenableUrl(url)) {
    return <span className={base}>{text || '—'}</span>;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={url}
      className={cn(
        base,
        'inline-flex items-baseline gap-1 text-sky-600 underline decoration-sky-600/30 underline-offset-2',
        'hover:decoration-sky-600 dark:text-sky-400 dark:decoration-sky-400/30 dark:hover:decoration-sky-400',
      )}
    >
      <span className="min-w-0 break-all">{text}</span>
      {showIcon && <ExternalLink className="size-3 shrink-0 self-center opacity-60" />}
    </a>
  );
}
