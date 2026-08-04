import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useActiveTab } from '@/hooks/use-active-tab';
import { cn } from '@/lib/utils';
import { type ShowcaseSubTab, useShowcaseTabStore } from '@/state/showcase-tab';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { useEffect, useRef } from 'react';
import { AiExtractTab } from './tabs/AiExtractTab';
import { DoctorTab } from './tabs/DoctorTab';
import { FrameworkTab } from './tabs/FrameworkTab';
import { JsonLdTab } from './tabs/JsonLdTab';
import { ListPatternTab } from './tabs/ListPatternTab';
import { MicrodataTab } from './tabs/MicrodataTab';
import { NetworkTab } from './tabs/NetworkTab';
import { PatternsTab } from './tabs/PatternsTab';
import { PrepareTab } from './tabs/PrepareTab';
import { RecipesTab } from './tabs/RecipesTab';
import { SnapshotTab } from './tabs/SnapshotTab';
import { TablesTab } from './tabs/TablesTab';

export function ShowcaseView() {
  const tab = useActiveTab();
  const subTab = useShowcaseTabStore((s) => s.subTab);
  const setSubTab = useShowcaseTabStore((s) => s.setSubTab);
  const sidepanelTab = useSidepanelTabStore((s) => s.tab);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Every sub-tab is forceMounted so work survives switching (audit P1-1).
  // `visible` gates auto-running effects (detection probes, diagnostic scans)
  // so 12 mounted tabs don't all probe the page on every navigation — only
  // the one the user is actually looking at does.
  const visible = sidepanelTab === 'showcase';
  const isActive = (t: ShowcaseSubTab) => visible && subTab === t;

  // Keep the active trigger in view inside the horizontal strip.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>('[data-state="active"]');
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [subTab]);

  const host = (() => {
    try {
      return tab.url ? new URL(tab.url).host : '';
    } catch {
      return '';
    }
  })();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center px-3">
        <span className="text-sm font-medium">Showcase</span>
        <span className="ml-2 truncate text-xs text-muted-foreground">{host || 'no host'}</span>
      </div>

      <Tabs
        value={subTab}
        onValueChange={(v) => setSubTab(v as ShowcaseSubTab)}
        className="flex flex-1 flex-col min-h-0"
      >
        {/* 12 triggers don't fit a ~360px panel: the strip is its own
            horizontal scroller (scrollbar hidden, fade edges) so the rest of
            the panel never scrolls sideways. */}
        <div className="relative mx-3 mt-1 min-w-0 shrink-0">
          <div ref={stripRef} className="scrollbar-none overflow-x-auto">
            <TabsList className="w-max gap-1 bg-transparent p-0">
              <ShowcaseTab value="doctor">Doctor</ShowcaseTab>
              <ShowcaseTab value="recipes">Recipes</ShowcaseTab>
              <ShowcaseTab value="prepare">Prepare</ShowcaseTab>
              <ShowcaseTab value="snapshot">Snapshot</ShowcaseTab>
              <ShowcaseTab value="json_ld">JSON-LD</ShowcaseTab>
              <ShowcaseTab value="microdata">Microdata</ShowcaseTab>
              <ShowcaseTab value="tables">Tables</ShowcaseTab>
              <ShowcaseTab value="framework">Framework</ShowcaseTab>
              <ShowcaseTab value="ai_extract">AI Extract</ShowcaseTab>
              <ShowcaseTab value="list_pattern">List Pattern</ShowcaseTab>
              <ShowcaseTab value="network">Network</ShowcaseTab>
              <ShowcaseTab value="patterns">Patterns</ShowcaseTab>
            </TabsList>
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-background to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-4 bg-gradient-to-l from-background to-transparent" />
        </div>

        <ShowcaseContent value="doctor">
          <DoctorTab active={isActive('doctor')} />
        </ShowcaseContent>
        <ShowcaseContent value="recipes">
          <RecipesTab />
        </ShowcaseContent>
        <ShowcaseContent value="prepare">
          <PrepareTab />
        </ShowcaseContent>
        <ShowcaseContent value="snapshot">
          <SnapshotTab active={isActive('snapshot')} />
        </ShowcaseContent>
        <ShowcaseContent value="json_ld">
          <JsonLdTab active={isActive('json_ld')} />
        </ShowcaseContent>
        <ShowcaseContent value="microdata">
          <MicrodataTab active={isActive('microdata')} />
        </ShowcaseContent>
        <ShowcaseContent value="tables">
          <TablesTab active={isActive('tables')} />
        </ShowcaseContent>
        <ShowcaseContent value="framework">
          <FrameworkTab active={isActive('framework')} />
        </ShowcaseContent>
        <ShowcaseContent value="ai_extract">
          <AiExtractTab />
        </ShowcaseContent>
        <ShowcaseContent value="list_pattern">
          <ListPatternTab />
        </ShowcaseContent>
        <ShowcaseContent value="network">
          <NetworkTab />
        </ShowcaseContent>
        <ShowcaseContent value="patterns">
          <PatternsTab active={isActive('patterns')} />
        </ShowcaseContent>
      </Tabs>
    </div>
  );
}

/**
 * forceMount keeps every sub-tab's state alive across switches (audit P1-1):
 * network capture buffers, half-built list-pattern configs, AI extract
 * results. Visibility is purely CSS via data-state.
 */
function ShowcaseContent({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsContent value={value} forceMount className="flex-1 min-h-0 data-[state=inactive]:hidden">
      {children}
    </TabsContent>
  );
}

function ShowcaseTab({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'h-6 rounded-md bg-transparent px-2.5 py-0 text-xs text-muted-foreground shadow-none',
        'data-[state=active]:bg-secondary data-[state=active]:text-foreground data-[state=active]:shadow-none',
      )}
    >
      {children}
    </TabsTrigger>
  );
}
