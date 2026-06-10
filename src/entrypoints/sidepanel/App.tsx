import { AuthGate } from '@/components/AuthGate';
import { PermissionPromptModal } from '@/components/PermissionPromptModal';
import { UserMenu } from '@/components/UserMenu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAgendaListener } from '@/hooks/use-agenda-listener';
import { useAuth } from '@/hooks/use-auth';
import { useAutoExtract } from '@/hooks/use-auto-extract';
import { useAutoScrape } from '@/hooks/use-auto-scrape';
import { useContextMenuListener } from '@/hooks/use-context-menu-listener';
import { useGuidanceSync } from '@/hooks/use-guidance-sync';
import { useHighlightBridge } from '@/hooks/use-highlight-bridge';
import { useParallelEventBridge } from '@/hooks/use-parallel-event-bridge';
import { useDebugStore } from '@/lib/debug/log';
import { useSettingsStore } from '@/state/settings';
import { type SidepanelTab, useSidepanelTabStore } from '@/state/sidepanel-tab';
import {
  BookOpen,
  Bug,
  Calendar,
  Camera,
  Crosshair,
  Database,
  Highlighter,
  ListChecks,
  ListTodo,
  Loader2,
  MessageSquare,
  NotebookPen,
  ScanLine,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { type ComponentType, Suspense, lazy, useEffect } from 'react';

// Per-tab dynamic imports. Single source of truth for module paths so each
// view ships in its own chunk and the eager sidepanel bundle stays small.
// Used both as the loader for `lazy()` and to pre-warm the chunk on tab
// change (browsers + Vite dedupe identical `import()` calls, so calling the
// loader twice doesn't double-fetch).
const VIEW_LOADERS = {
  chat: () => import('@/features/chat/ChatView').then((m) => ({ default: m.ChatView })),
  pilot: () => import('@/features/chat/PilotView').then((m) => ({ default: m.PilotView })),
  tasks: () => import('@/features/tasks/TasksView').then((m) => ({ default: m.TasksView })),
  lists: () => import('@/features/lists/ListsHubView').then((m) => ({ default: m.ListsHubView })),
  agenda: () => import('@/features/agenda/AgendaView').then((m) => ({ default: m.AgendaView })),
  scrape: () => import('@/features/scrape/ScrapeView').then((m) => ({ default: m.ScrapeView })),
  data: () => import('@/features/data/DataView').then((m) => ({ default: m.DataView })),
  highlight: () =>
    import('@/features/highlights/HighlightView').then((m) => ({ default: m.HighlightView })),
  guidance: () =>
    import('@/features/guidance/GuidanceView').then((m) => ({ default: m.GuidanceView })),
  seo: () => import('@/features/seo/SeoView').then((m) => ({ default: m.SeoView })),
  notes: () => import('@/features/notes/NotesView').then((m) => ({ default: m.NotesView })),
  screenshots: () =>
    import('@/features/screenshots/ScreenshotsView').then((m) => ({
      default: m.ScreenshotsView,
    })),
  tools: () => import('@/features/tools/ToolsView').then((m) => ({ default: m.ToolsView })),
  settings: () =>
    import('@/features/settings/SettingsView').then((m) => ({ default: m.SettingsView })),
  profile: () => import('@/features/profile/ProfileView').then((m) => ({ default: m.ProfileView })),
  showcase: () =>
    import('@/features/showcase/ShowcaseView').then((m) => ({ default: m.ShowcaseView })),
  debug: () => import('@/features/debug/DebugView').then((m) => ({ default: m.DebugView })),
} satisfies Record<SidepanelTab, () => Promise<{ default: ComponentType }>>;

const ChatView = lazy(VIEW_LOADERS.chat);
const PilotView = lazy(VIEW_LOADERS.pilot);
const TasksView = lazy(VIEW_LOADERS.tasks);
const ListsHubView = lazy(VIEW_LOADERS.lists);
const AgendaView = lazy(VIEW_LOADERS.agenda);
const ScrapeView = lazy(VIEW_LOADERS.scrape);
const DataView = lazy(VIEW_LOADERS.data);
const HighlightView = lazy(VIEW_LOADERS.highlight);
const GuidanceView = lazy(VIEW_LOADERS.guidance);
const SeoView = lazy(VIEW_LOADERS.seo);
const NotesView = lazy(VIEW_LOADERS.notes);
const ScreenshotsView = lazy(VIEW_LOADERS.screenshots);
const ToolsView = lazy(VIEW_LOADERS.tools);
const SettingsView = lazy(VIEW_LOADERS.settings);
const ProfileView = lazy(VIEW_LOADERS.profile);
const ShowcaseView = lazy(VIEW_LOADERS.showcase);
const DebugView = lazy(VIEW_LOADERS.debug);

const TabFallback = (
  <div className="flex h-full items-center justify-center text-muted-foreground">
    <Loader2 className="size-4 animate-spin" />
  </div>
);

export function App() {
  const theme = useSettingsStore((s) => s.theme);
  const { user, isAdmin } = useAuth();
  const errorCount = useDebugStore((s) => s.events.filter((e) => e.level === 'error').length);
  const tab = useSidepanelTabStore((s) => s.tab);
  const setTab = useSidepanelTabStore((s) => s.setTab);

  // Guest tab visibility — for unauthenticated users we show the features
  // advertised in the Web Store listing: Chat, Capture (scrape), Patterns
  // (data), SEO, Settings. Tabs that need persistence or run expensive
  // server agents (Tasks, Agenda, Guidance, Notes, Screenshots, Tools,
  // Profile) stay signed-in-only. Pilot/Showcase/Debug are admin-only and
  // unaffected. If the user lands on a hidden tab as a guest (restored
  // from a prior signed-in session), bounce them to Chat.
  const isGuest = user === null;
  const GUEST_TABS: SidepanelTab[] = ['chat', 'scrape', 'data', 'seo', 'settings'];
  const showFullTabs = !isGuest;
  useEffect(() => {
    if (isGuest && !GUEST_TABS.includes(tab)) setTab('chat');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, tab, setTab]);

  // Mount ONCE: watches active-tab url and auto-runs every saved pattern that
  // matches. Results land in useAutoExtractStore; DataView reads from there.
  useAutoExtract();

  // Mount ONCE: when the active tab finishes loading and the
  // `scrapeAutoOnLoad` setting is enabled, fast-scrape it in the background
  // and stash in useAutoScrapeStore. The chat hook reads from there on send.
  useAutoScrape();

  // Mount ONCE: listens for SW AGENDA_RUN_NOW broadcasts so auto-mode
  // tasks fire immediately when the sidepanel is open, no click needed.
  useAgendaListener();

  // Mount ONCE: listens for SW PARALLEL_RUN_EVENT broadcasts emitted by
  // the `parallel_for_each_tab` tool. Mirrors lifecycle into the
  // sidepanel-side parallel-runs store so the Tasks tab's panel always
  // has fresh state — even before the user opens that tab.
  useParallelEventBridge();

  // Mount ONCE: listens for the right-click "Ask Matrx about selection"
  // context menu (SW-side) and drains any cold-open pending draft from
  // chrome.storage.session.
  useContextMenuListener();

  // Mount ONCE: owns the Supabase write for highlights captured by the
  // on-page overlay (the page can't reach Supabase) and keeps the highlight
  // store in sync regardless of which tab is active.
  useHighlightBridge();

  // Mount ONCE: on sign-in, hydrate guidance metadata from the cloud
  // (wbx_guidance) into the local cache so guidance follows the user across
  // machines (TASK-004). Writes mirror to the cloud automatically.
  useGuidanceSync();

  // Pre-warm the active tab's chunk. Fires on mount (so the default Chat
  // view is already fetched by the time Suspense reaches it — no flash on
  // sidepanel open) and on every tab change (so the second visit to a tab
  // is instant). Repeat calls hit the browser/Vite import cache; no extra
  // fetch cost.
  useEffect(() => {
    void VIEW_LOADERS[tab]();
  }, [tab]);

  // Once-per-mount identity log. Surfaces the runtime extension id +
  // redirect URI in the debug log so any ID drift is visible BEFORE the
  // user clicks Sign in. See .research/v0.1.4-auth-incident.md for why.
  useEffect(() => {
    void import('@/lib/auth/identity').then(({ logExtensionIdentityOnce }) => {
      logExtensionIdentityOnce();
    });
  }, []);

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
      {/* Mounted at App root (outside AuthGate) so it overlays every
          surface and works even on auth screens. Renders nothing when
          there's no active prompt; see lib/permissions/gate.ts. */}
      <PermissionPromptModal />
      <div className="flex h-full flex-col bg-background text-foreground">
        <AuthGate>
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as typeof tab)}
            className="flex flex-1 flex-col min-h-0"
          >
            <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
              <TabsList className="flex flex-1 justify-start gap-0.5 bg-transparent p-0">
                <TabsTrigger value="chat" className="size-7 p-0" title="Chat">
                  <MessageSquare className="size-3.5" />
                </TabsTrigger>
                {isAdmin && (
                  <TabsTrigger
                    value="pilot"
                    className="size-7 p-0 data-[state=active]:text-emerald-600 dark:data-[state=active]:text-emerald-400"
                    title="Pilot (admin only — sandboxed tab group)"
                  >
                    <Crosshair className="size-3.5" />
                  </TabsTrigger>
                )}
                {showFullTabs && (
                  <>
                    <TabsTrigger value="lists" className="size-7 p-0" title="Plan & tasks">
                      <ListChecks className="size-3.5" />
                    </TabsTrigger>
                    <TabsTrigger value="tasks" className="size-7 p-0" title="Tasks">
                      <ListTodo className="size-3.5" />
                    </TabsTrigger>
                    <TabsTrigger value="agenda" className="size-7 p-0" title="Agenda">
                      <Calendar className="size-3.5" />
                    </TabsTrigger>
                  </>
                )}
                {/* Capture (Scrape), Patterns (Data), SEO — advertised in the
                    Web Store listing and free to run for guests (no
                    server-agent cost). */}
                <TabsTrigger value="scrape" className="size-7 p-0" title="Scrape">
                  <ScanLine className="size-3.5" />
                </TabsTrigger>
                <TabsTrigger value="data" className="size-7 p-0" title="Data">
                  <Database className="size-3.5" />
                </TabsTrigger>
                <TabsTrigger value="seo" className="size-7 p-0" title="SEO">
                  <Search className="size-3.5" />
                </TabsTrigger>
                {showFullTabs && (
                  <>
                    <TabsTrigger value="highlight" className="size-7 p-0" title="Highlights">
                      <Highlighter className="size-3.5" />
                    </TabsTrigger>
                    <TabsTrigger value="guidance" className="size-7 p-0" title="Guidance">
                      <BookOpen className="size-3.5" />
                    </TabsTrigger>
                    <TabsTrigger value="notes" className="size-7 p-0" title="Notes">
                      <NotebookPen className="size-3.5" />
                    </TabsTrigger>
                    <TabsTrigger value="screenshots" className="size-7 p-0" title="Screenshots">
                      <Camera className="size-3.5" />
                    </TabsTrigger>
                    <TabsTrigger value="tools" className="size-7 p-0" title="Tools">
                      <Wrench className="size-3.5" />
                    </TabsTrigger>
                  </>
                )}
                <TabsTrigger value="settings" className="size-7 p-0" title="Settings">
                  <SettingsIcon className="size-3.5" />
                </TabsTrigger>
                {isAdmin && (
                  <TabsTrigger
                    value="showcase"
                    className="size-7 p-0 data-[state=active]:text-violet-600 dark:data-[state=active]:text-violet-400"
                    title="Showcase (admin only)"
                  >
                    <Sparkles className="size-3.5" />
                  </TabsTrigger>
                )}
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
            {/* forceMount (audit P1-14): ChatView owns the live stream-chunk
                listeners and the stall watchdog. Radix unmounts inactive tab
                content by default, so switching sidepanel tabs mid-stream
                dropped every chunk in the gap and orphaned the watchdog
                (which later fired against the new run). Keep the chat
                surfaces mounted; visibility via data-state. */}
            <TabsContent
              value="chat"
              forceMount
              className="flex-1 min-h-0 data-[state=inactive]:hidden"
            >
              <Suspense fallback={TabFallback}>
                <ChatView />
              </Suspense>
            </TabsContent>
            {isAdmin && (
              <TabsContent
                value="pilot"
                forceMount
                className="flex-1 min-h-0 data-[state=inactive]:hidden"
              >
                <Suspense fallback={TabFallback}>
                  <PilotView />
                </Suspense>
              </TabsContent>
            )}
            {showFullTabs && (
              <>
                <TabsContent value="lists" className="flex-1 min-h-0">
                  <Suspense fallback={TabFallback}>
                    <ListsHubView />
                  </Suspense>
                </TabsContent>
                <TabsContent value="tasks" className="flex-1 min-h-0">
                  <Suspense fallback={TabFallback}>
                    <TasksView />
                  </Suspense>
                </TabsContent>
                <TabsContent value="agenda" className="flex-1 min-h-0">
                  <Suspense fallback={TabFallback}>
                    <AgendaView />
                  </Suspense>
                </TabsContent>
              </>
            )}
            <TabsContent value="scrape" className="flex-1 min-h-0">
              <Suspense fallback={TabFallback}>
                <ScrapeView />
              </Suspense>
            </TabsContent>
            <TabsContent value="data" className="flex-1 min-h-0">
              <Suspense fallback={TabFallback}>
                <DataView />
              </Suspense>
            </TabsContent>
            <TabsContent value="seo" className="flex-1 min-h-0">
              <Suspense fallback={TabFallback}>
                <SeoView />
              </Suspense>
            </TabsContent>
            {showFullTabs && (
              <>
                <TabsContent value="highlight" className="flex-1 min-h-0">
                  <Suspense fallback={TabFallback}>
                    <HighlightView />
                  </Suspense>
                </TabsContent>
                <TabsContent value="guidance" className="flex-1 min-h-0">
                  <Suspense fallback={TabFallback}>
                    <GuidanceView />
                  </Suspense>
                </TabsContent>
                <TabsContent value="notes" className="flex-1 min-h-0">
                  <Suspense fallback={TabFallback}>
                    <NotesView />
                  </Suspense>
                </TabsContent>
                <TabsContent value="screenshots" className="flex-1 min-h-0">
                  <Suspense fallback={TabFallback}>
                    <ScreenshotsView />
                  </Suspense>
                </TabsContent>
                <TabsContent value="tools" className="flex-1 min-h-0">
                  <Suspense fallback={TabFallback}>
                    <ToolsView />
                  </Suspense>
                </TabsContent>
              </>
            )}
            <TabsContent value="settings" className="flex-1 min-h-0">
              <Suspense fallback={TabFallback}>
                <SettingsView />
              </Suspense>
            </TabsContent>
            <TabsContent value="profile" className="flex-1 min-h-0">
              <Suspense fallback={TabFallback}>
                <ProfileView />
              </Suspense>
            </TabsContent>
            {isAdmin && (
              <TabsContent value="showcase" className="flex-1 min-h-0">
                <Suspense fallback={TabFallback}>
                  <ShowcaseView />
                </Suspense>
              </TabsContent>
            )}
            {isAdmin && (
              <TabsContent value="debug" className="flex-1 min-h-0">
                <Suspense fallback={TabFallback}>
                  <DebugView />
                </Suspense>
              </TabsContent>
            )}
          </Tabs>
        </AuthGate>
      </div>
    </TooltipProvider>
  );
}
