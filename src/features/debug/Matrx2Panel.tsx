/**
 * Debug › Bridges: Matrx 2 (the new desktop app). The service worker owns the connection
 * (src/lib/desktop/matrx2/); this panel shows it and offers Reconnect. Matrx Local keeps its own
 * panel (Channel B) — the two apps can run side by side.
 */
import { matrx2StatusText, useMatrx2 } from '@/hooks/use-matrx2';
import { cn } from '@/lib/utils';
import { Button } from '@ai-matrx/design-system';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

export function Matrx2Section({
  Section,
  KV,
}: {
  Section: (p: { label: string; children: React.ReactNode }) => React.ReactNode;
  KV: (p: { k: string; v: React.ReactNode }) => React.ReactNode;
}) {
  const { state, reconnect } = useMatrx2();
  const [busy, setBusy] = useState(false);
  const routable = state?.status === 'connected' && state.session?.routable === true;
  return (
    <Section label="Connection">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            routable
              ? 'bg-emerald-500'
              : state?.status === 'connected'
                ? 'bg-amber-500'
                : 'bg-muted-foreground/40',
          )}
        />
        <span className="text-[11px] text-foreground">{matrx2StatusText(state)}</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await reconnect();
            setBusy(false);
          }}
        >
          <RefreshCw className="mr-1 size-3.5" /> Reconnect
        </Button>
      </div>
      {state && (
        <>
          <KV k="port" v={state.port ?? '—'} />
          <KV k="app version" v={state.appVersion ?? '—'} />
          <KV k="shown in Matrx 2 as" v={state.session?.client_label ?? '—'} />
          <KV k="account" v={state.session?.account_email ?? '—'} />
          <KV k="calls answered" v={String(state.calls)} />
        </>
      )}
    </Section>
  );
}
