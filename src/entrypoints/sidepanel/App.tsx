import { AuthGate } from '@/components/AuthGate';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UserMenu } from '@/components/UserMenu';
import { ChatView } from '@/features/chat/ChatView';
import { DataView } from '@/features/data/DataView';
import { DebugView } from '@/features/debug/DebugView';
import { ScrapeView } from '@/features/scrape/ScrapeView';
import { SeoView } from '@/features/seo/SeoView';
import { SettingsView } from '@/features/settings/SettingsView';
import { TasksView } from '@/features/tasks/TasksView';
import { useAuth } from '@/hooks/use-auth';
import { useDebugStore } from '@/lib/debug/log';
import { useSettingsStore } from '@/state/settings';
import {
  Bug,
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
  const { isAdmin } = useAuth();
  const errorCount = useDebugStore((s) => s.events.filter((e) => e.level === 'error').length);

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
            <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
              <TabsList className="flex flex-1 justify-start gap-0.5 bg-transparent p-0">
                <TabsTrigger value="chat" className="size-7 p-0" title="Chat">
                  <MessageSquare className="size-3.5" />
                </TabsTrigger>
                <TabsTrigger value="tasks" className="size-7 p-0" title="Tasks">
                  <ListTodo className="size-3.5" />
                </TabsTrigger>
                <TabsTrigger value="scrape" className="size-7 p-0" title="Scrape">
                  <ScanLine className="size-3.5" />
                </TabsTrigger>
                <TabsTrigger value="data" className="size-7 p-0" title="Data">
                  <Database className="size-3.5" />
                </TabsTrigger>
                <TabsTrigger value="seo" className="size-7 p-0" title="SEO">
                  <Search className="size-3.5" />
                </TabsTrigger>
                <TabsTrigger value="settings" className="size-7 p-0" title="Settings">
                  <SettingsIcon className="size-3.5" />
                </TabsTrigger>
                {isAdmin && (
                  <TabsTrigger
                    value="debug"
                    className="relative size-7 p-0 data-[state=active]:text-amber-600 dark:data-[state=active]:text-amber-400"
                    title="Debug (admin only)"
                  >
                    <Bug className="size-3.5" />
                    {errorCount > 0 && (
                      <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-red-500" />
                    )}
                  </TabsTrigger>
                )}
              </TabsList>
              <UserMenu />
            </div>
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
            <TabsContent value="settings" className="flex-1 min-h-0">
              <SettingsView />
            </TabsContent>
            {isAdmin && (
              <TabsContent value="debug" className="flex-1 min-h-0">
                <DebugView />
              </TabsContent>
            )}
          </Tabs>
        </AuthGate>
      </div>
    </TooltipProvider>
  );
}
