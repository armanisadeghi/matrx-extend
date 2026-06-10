import { Button } from '@/components/ui/button';
import { usePagePrep } from '@/hooks/use-page-prep';
import { CheckCircle2, Loader2, Wand2 } from 'lucide-react';
import { useState } from 'react';

export function PrepareTab() {
  const { report, running, error, run } = usePagePrep();
  const [dismissBanners, setDismissBanners] = useState(true);
  const [expandLoadMore, setExpandLoadMore] = useState(true);
  const [scrollToBottom, setScrollToBottom] = useState(true);

  const handleRun = () => {
    void run({ dismissBanners, expandLoadMore, scrollToBottom });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Prepare page
          </div>
          <div className="text-xs text-muted-foreground">
            Heuristic-only cleanup before extraction. Dismisses cookie banners, clicks "Load more"
            buttons, and scrolls to trigger lazy-loaded content. No AI.
          </div>
        </div>

        <div className="space-y-1.5 rounded-xl bg-secondary/40 p-3">
          <Toggle
            checked={dismissBanners}
            onChange={setDismissBanners}
            label="Dismiss cookie / GDPR banners"
            hint="Clicks affirmative buttons (Accept, OK, Agree) inside elements that look like banners."
          />
          <Toggle
            checked={expandLoadMore}
            onChange={setExpandLoadMore}
            label="Click Load more / Show more buttons"
            hint="Up to 8 times, until the button disappears or stops working."
          />
          <Toggle
            checked={scrollToBottom}
            onChange={setScrollToBottom}
            label="Scroll to bottom"
            hint="Triggers lazy-loaded images and IntersectionObserver-based content."
          />
        </div>

        <Button onClick={handleRun} disabled={running} className="w-full rounded-full">
          {running ? <Loader2 className="animate-spin" /> : <Wand2 />}
          {running ? 'Preparing…' : 'Prepare page'}
        </Button>

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {report && (
          <div className="space-y-2 rounded-xl bg-secondary/40 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              Prepared in {report.duration_ms}ms
            </div>

            <ReportRow
              label="Banners dismissed"
              count={report.banners_dismissed.length}
              items={report.banners_dismissed.map((b) => `"${b.text}"`)}
            />
            <ReportRow
              label="Load-more clicks"
              count={report.load_more_clicks.length}
              items={report.load_more_clicks.map((b) => `"${b.text}"`)}
            />
            <ReportRow label="Scroll steps" count={report.scroll_steps} items={[]} />
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1 hover:bg-background/40">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-3.5 cursor-pointer accent-primary"
      />
      <div className="flex-1">
        <div className="text-xs font-medium">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
    </label>
  );
}

function ReportRow({
  label,
  count,
  items,
}: {
  label: string;
  count: number;
  items: string[];
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{count}</span>
      </div>
      {items.length > 0 && (
        <div className="ml-2 mt-0.5 space-y-0.5">
          {items.map((it, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: report is render-only.
            <div key={i} className="truncate text-[10px] text-muted-foreground">
              {it}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
