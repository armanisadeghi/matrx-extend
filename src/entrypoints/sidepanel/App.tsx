import { AuthGate } from '@/components/AuthGate';
import { StatusBar } from '@/components/StatusBar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatView } from '@/features/chat/ChatView';
import { DataView } from '@/features/data/DataView';
import { ScrapeView } from '@/features/scrape/ScrapeView';
import { SeoView } from '@/features/seo/SeoView';
import { SettingsView } from '@/features/settings/SettingsView';
import { TasksView } from '@/features/tasks/TasksView';
import { useSettingsStore } from '@/state/settings';
import {
  Database,
  ListTodo,
  MessageSquare,
  ScanLine,
  Search,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useEffect } from 'react';

export function App() {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const apply = () => {
      const root = document.documentElement;
      const isDark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('dark', isDark);
    };
    apply();
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [theme]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full flex-col bg-background text-foreground">
        <AuthGate>
          <Tabs defaultValue="chat" className="flex flex-1 flex-col min-h-0">
            <TabsList className="grid grid-cols-6 rounded-none border-b bg-card p-1 [&>*]:gap-1 [&>*]:px-2">
              <TabsTrigger value="chat" className="text-xs">
                <MessageSquare className="size-3.5" />
              </TabsTrigger>
              <TabsTrigger value="tasks" className="text-xs">
                <ListTodo className="size-3.5" />
              </TabsTrigger>
              <TabsTrigger value="scrape" className="text-xs">
                <ScanLine className="size-3.5" />
              </TabsTrigger>
              <TabsTrigger value="data" className="text-xs">
                <Database className="size-3.5" />
              </TabsTrigger>
              <TabsTrigger value="seo" className="text-xs">
                <Search className="size-3.5" />
              </TabsTrigger>
              <TabsTrigger value="settings" className="text-xs">
                <SettingsIcon className="size-3.5" />
              </TabsTrigger>
            </TabsList>
            <TabsContent value="chat" className="flex-1 min-h-0">
              <ChatView />
            </TabsContent>
            <TabsContent value="tasks" className="flex-1 min-h-0">
              <TasksView />
            </TabsContent>
            <TabsContent value="scrape" className="flex-1 min-h-0">
              <ScrapeView />
            </TabsContent>
            <TabsContent value="data" className="flex-1 min-h-0">
              <DataView />
            </TabsContent>
            <TabsContent value="seo" className="flex-1 min-h-0">
              <SeoView />
            </TabsContent>
            <TabsContent value="settings" className="flex-1 min-h-0 overflow-y-auto">
              <SettingsView />
            </TabsContent>
          </Tabs>
        </AuthGate>
        <StatusBar />
      </div>
    </TooltipProvider>
  );
}
