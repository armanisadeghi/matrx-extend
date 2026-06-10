import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useActiveTab } from '@/hooks/use-active-tab';
import { cn } from '@/lib/utils';
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

      <Tabs defaultValue="doctor" className="flex flex-1 flex-col min-h-0">
        <TabsList className="mx-3 mt-1 self-start gap-1 bg-transparent p-0">
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

        <TabsContent value="doctor" className="flex-1 min-h-0">
          <DoctorTab />
        </TabsContent>
        <TabsContent value="recipes" className="flex-1 min-h-0">
          <RecipesTab />
        </TabsContent>
        <TabsContent value="prepare" className="flex-1 min-h-0">
          <PrepareTab />
        </TabsContent>
        <TabsContent value="snapshot" className="flex-1 min-h-0">
          <SnapshotTab />
        </TabsContent>
        <TabsContent value="json_ld" className="flex-1 min-h-0">
          <JsonLdTab />
        </TabsContent>
        <TabsContent value="microdata" className="flex-1 min-h-0">
          <MicrodataTab />
        </TabsContent>
        <TabsContent value="tables" className="flex-1 min-h-0">
          <TablesTab />
        </TabsContent>
        <TabsContent value="framework" className="flex-1 min-h-0">
          <FrameworkTab />
        </TabsContent>
        <TabsContent value="ai_extract" className="flex-1 min-h-0">
          <AiExtractTab />
        </TabsContent>
        <TabsContent value="list_pattern" className="flex-1 min-h-0">
          <ListPatternTab />
        </TabsContent>
        <TabsContent value="network" className="flex-1 min-h-0">
          <NetworkTab />
        </TabsContent>
        <TabsContent value="patterns" className="flex-1 min-h-0">
          <PatternsTab />
        </TabsContent>
      </Tabs>
    </div>
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
