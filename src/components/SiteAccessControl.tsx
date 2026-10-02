import type { ActiveTabInfo } from '@/hooks/use-active-tab';
import {
  type SiteAccessTarget,
  isSameSiteAccessTarget,
  reloadSiteAccessTarget,
  requestPersistentSiteAccess,
  siteAccessTarget,
} from '@/lib/permissions/site-access';
import { Popover, PopoverContent, PopoverTrigger } from '@ai-matrx/design-system';
import { Globe2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type AccessStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'failed'
  | 'reloaded'
  | 'reload-failed'
  | 'stale';

const statusText: Record<Exclude<AccessStatus, 'idle' | 'requesting'>, string> = {
  granted: 'Access allowed on this site.',
  denied: 'Access not granted.',
  unavailable: 'Site access is unavailable in this browser.',
  failed: 'Access could not be changed.',
  reloaded: 'Page reloaded. Retry your action.',
  'reload-failed': 'Page could not reload.',
  stale: 'Page changed. Reopen Site access.',
};

/** One neutral recovery control shared by every sidepanel page action. */
export function SiteAccessControl({ tab }: { tab: ActiveTabInfo }) {
  const [open, setOpen] = useState(false);
  const [captured, setCaptured] = useState<SiteAccessTarget | null>(null);
  const [status, setStatus] = useState<AccessStatus>('idle');
  const current = siteAccessTarget(tab);
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    if (open && captured && !isSameSiteAccessTarget(captured, current)) setStatus('stale');
  }, [open, captured, current]);

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setCaptured(currentRef.current);
      setStatus('idle');
    }
  };

  const request = async () => {
    if (!captured) {
      setStatus('unavailable');
      return;
    }
    if (!isSameSiteAccessTarget(captured, currentRef.current)) {
      setStatus('stale');
      return;
    }
    setStatus('requesting');
    const result = await requestPersistentSiteAccess(captured);
    setStatus(isSameSiteAccessTarget(captured, currentRef.current) ? result : 'stale');
  };

  const reload = async () => {
    if (!captured) {
      setStatus('unavailable');
      return;
    }
    if (!isSameSiteAccessTarget(captured, currentRef.current)) {
      setStatus('stale');
      return;
    }
    const result = await reloadSiteAccessTarget(captured);
    setStatus(
      isSameSiteAccessTarget(captured, currentRef.current)
        ? result === 'failed'
          ? 'reload-failed'
          : result
        : 'stale',
    );
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Site access"
          aria-label="Site access"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Globe2 className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 space-y-2 rounded-xl p-3 text-xs">
        <div className="font-medium">Site access</div>
        {captured ? (
          <>
            <div className="truncate text-muted-foreground" title={captured.url}>
              {new URL(captured.url).host}
            </div>
            <p>For temporary access, click Matrx in Chrome’s toolbar.</p>
            <button
              type="button"
              className="block font-medium text-primary underline"
              onClick={() => void request()}
            >
              Always allow on this site
            </button>
            <button
              type="button"
              className="block font-medium text-primary underline"
              onClick={() => void reload()}
            >
              Reload page
            </button>
            <p className="text-muted-foreground">After access changes, reload, then retry.</p>
          </>
        ) : (
          <p>Select a web page to manage site access.</p>
        )}
        {status === 'requesting' && <output>Waiting for Chrome…</output>}
        {status !== 'idle' && status !== 'requesting' && (
          <output className="block text-muted-foreground">{statusText[status]}</output>
        )}
      </PopoverContent>
    </Popover>
  );
}
