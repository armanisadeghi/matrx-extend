import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ENV } from '@/config/env';
import { useAuth } from '@/hooks/use-auth';
import type { ScreenshotRow } from '@/lib/supabase/queries';
import { useChatStore } from '@/state/chat';
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  File,
  FileImage,
  Files,
  GitBranch,
  ImageOff,
  Loader2,
  Paperclip,
  RefreshCw,
  Search,
  Unlink,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type FileInventoryItem,
  type FileResourceFamily,
  attachFileToConversation,
  detachFileFromConversation,
  fetchAttachedFileIds,
  fetchFileResourceFamily,
  fetchRecentExtensionCaptures,
  fetchRecentFiles,
} from './data';

type LoadState = 'loading' | 'ready' | 'error';
type InventoryTab = 'library' | 'captures';

export function FilesView() {
  const { user } = useAuth();
  const conversationId = useChatStore((state) => state.selectedConversationId);
  const [tab, setTab] = useState<InventoryTab>('library');
  const [files, setFiles] = useState<FileInventoryItem[]>([]);
  const [captures, setCaptures] = useState<ScreenshotRow[]>([]);
  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [familyFile, setFamilyFile] = useState<{ id: string; name: string } | null>(null);
  const [family, setFamily] = useState<FileResourceFamily | null>(null);
  const [familyState, setFamilyState] = useState<LoadState>('loading');
  const [familyError, setFamilyError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setState('loading');
    setError(null);
    try {
      const [library, recentCaptures, attached] = await Promise.all([
        fetchRecentFiles(user.id),
        fetchRecentExtensionCaptures(),
        conversationId ? fetchAttachedFileIds(conversationId) : Promise.resolve(new Set<string>()),
      ]);
      setFiles(library);
      setCaptures(recentCaptures);
      setAttachedIds(attached);
      setState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load files.');
      setState('error');
    }
  }, [conversationId, user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openFamily = useCallback(async (id: string, name: string) => {
    setFamilyFile({ id, name });
    setFamily(null);
    setFamilyState('loading');
    setFamilyError(null);
    try {
      setFamily(await fetchFileResourceFamily(id));
      setFamilyState('ready');
    } catch (cause) {
      setFamilyError(cause instanceof Error ? cause.message : 'Could not load the file family.');
      setFamilyState('error');
    }
  }, []);

  const toggleAttachment = useCallback(
    async (fileId: string, name: string) => {
      if (!conversationId || busyFileId) return;
      setBusyFileId(fileId);
      setError(null);
      try {
        if (attachedIds.has(fileId)) {
          await detachFileFromConversation(fileId, conversationId);
          setAttachedIds((current) => {
            const next = new Set(current);
            next.delete(fileId);
            return next;
          });
        } else {
          await attachFileToConversation(fileId, conversationId, name);
          setAttachedIds((current) => new Set(current).add(fileId));
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not update the attachment.');
      } finally {
        setBusyFileId(null);
      }
    },
    [attachedIds, busyFileId, conversationId],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const visibleFiles = useMemo(
    () =>
      normalizedQuery
        ? files.filter(
            (file) =>
              file.name.toLowerCase().includes(normalizedQuery) ||
              file.path.toLowerCase().includes(normalizedQuery),
          )
        : files,
    [files, normalizedQuery],
  );
  const visibleCaptures = useMemo(
    () =>
      normalizedQuery
        ? captures.filter(
            (capture) =>
              capture.page_title?.toLowerCase().includes(normalizedQuery) ||
              capture.page_url_full.toLowerCase().includes(normalizedQuery),
          )
        : captures,
    [captures, normalizedQuery],
  );

  if (familyFile) {
    return (
      <FamilyInspector
        file={familyFile}
        family={family}
        state={familyState}
        error={familyError}
        onBack={() => setFamilyFile(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start gap-2 border-b border-border/60 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Files className="size-4 text-primary" />
            <h1 className="text-sm font-semibold">Files</h1>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Your Matrx library and files captured by this extension.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          onClick={() => void reload()}
          disabled={state === 'loading'}
          title="Refresh files"
        >
          <RefreshCw className={`size-3.5 ${state === 'loading' ? 'animate-spin' : ''}`} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          onClick={() => void chrome.tabs.create({ url: `${ENV.FRONTEND_URL}/files` })}
          title="Open the full Files app"
        >
          <ExternalLink className="size-3.5" />
        </Button>
      </div>

      {!conversationId && (
        <div className="mx-3 mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          Open an existing chat or send its first message before attaching a file. The first message
          creates the conversation ID that makes the attachment durable.
        </div>
      )}
      {error && (
        <div className="mx-3 mt-2 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="relative shrink-0 px-3 py-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search recent files"
          className="h-8 pl-8 text-xs"
        />
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as InventoryTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-3 h-8 shrink-0 justify-start">
          <TabsTrigger value="library" className="h-7 text-xs">
            Library
            <Badge variant="secondary" className="ml-1.5 px-1.5 text-[9px]">
              {files.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="captures" className="h-7 text-xs">
            Captures
            <Badge variant="secondary" className="ml-1.5 px-1.5 text-[9px]">
              {captures.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="mt-0 min-h-0 flex-1 overflow-y-auto">
          {state === 'loading' ? (
            <Loading />
          ) : visibleFiles.length === 0 ? (
            <Empty
              icon={<File className="size-5" />}
              title={normalizedQuery ? 'No matching files' : 'No library files yet'}
              body="Open the full Files app to upload and organize files."
            />
          ) : (
            <div className="divide-y divide-border/50">
              {visibleFiles.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  attached={attachedIds.has(file.id)}
                  attachEnabled={conversationId !== null}
                  busy={busyFileId === file.id}
                  onFamily={() => void openFamily(file.id, file.name)}
                  onAttach={() => void toggleAttachment(file.id, file.name)}
                  onOpen={() =>
                    void chrome.tabs.create({
                      url: `${ENV.FRONTEND_URL}/files/f/${encodeURIComponent(file.id)}`,
                    })
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="captures" className="mt-0 min-h-0 flex-1 overflow-y-auto">
          {state === 'loading' ? (
            <Loading />
          ) : visibleCaptures.length === 0 ? (
            <Empty
              icon={<FileImage className="size-5" />}
              title={normalizedQuery ? 'No matching captures' : 'No captures yet'}
              body="Screenshots saved by you or the agent will appear here across every page."
            />
          ) : (
            <div className="grid grid-cols-2 gap-2 p-3">
              {visibleCaptures.map((capture) => (
                <CaptureCard
                  key={capture.id}
                  capture={capture}
                  attached={attachedIds.has(capture.file_id)}
                  attachEnabled={conversationId !== null}
                  busy={busyFileId === capture.file_id}
                  onFamily={() =>
                    void openFamily(capture.file_id, capture.page_title ?? capture.page_url_full)
                  }
                  onAttach={() =>
                    void toggleAttachment(capture.file_id, capture.page_title ?? 'Screenshot')
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FileRow({
  file,
  attached,
  attachEnabled,
  busy,
  onFamily,
  onAttach,
  onOpen,
}: {
  file: FileInventoryItem;
  attached: boolean;
  attachEnabled: boolean;
  busy: boolean;
  onFamily: () => void;
  onAttach: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/70">
        {file.mimeType?.startsWith('image/') ? (
          <FileImage className="size-4 text-violet-500" />
        ) : (
          <File className="size-4 text-sky-500" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium" title={file.name}>
          {file.name}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{formatSize(file.sizeBytes)}</span>
          <span>·</span>
          <span>{formatDate(file.updatedAt)}</span>
          <span>·</span>
          <span>{file.visibility}</span>
        </div>
      </div>
      <RowActions
        attached={attached}
        attachEnabled={attachEnabled}
        busy={busy}
        onFamily={onFamily}
        onAttach={onAttach}
        onOpen={onOpen}
      />
    </div>
  );
}

function CaptureCard({
  capture,
  attached,
  attachEnabled,
  busy,
  onFamily,
  onAttach,
}: {
  capture: ScreenshotRow;
  attached: boolean;
  attachEnabled: boolean;
  busy: boolean;
  onFamily: () => void;
  onAttach: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-card">
      <button
        type="button"
        className="block aspect-[4/3] w-full bg-muted/40"
        onClick={() => capture.file_url && void chrome.tabs.create({ url: capture.file_url })}
        disabled={!capture.file_url}
        title={capture.file_url ? 'Open capture' : 'Capture URL unavailable'}
      >
        {capture.file_url ? (
          <img
            src={capture.file_url}
            alt={capture.page_title ?? 'Screenshot'}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-5" />
          </span>
        )}
      </button>
      <div className="px-2 py-1.5">
        <div className="truncate text-[11px] font-medium" title={capture.page_title ?? ''}>
          {capture.page_title ?? 'Screenshot'}
        </div>
        <div className="truncate text-[9px] text-muted-foreground">
          {formatDate(capture.captured_at)}
        </div>
      </div>
      <div className="flex justify-end gap-0.5 border-t border-border/50 p-1">
        <Button
          size="sm"
          variant="ghost"
          className="size-6 p-0"
          onClick={onFamily}
          title="Inspect family"
        >
          <GitBranch className="size-3" />
        </Button>
        <Button
          size="sm"
          variant={attached ? 'secondary' : 'ghost'}
          className="size-6 p-0"
          onClick={onAttach}
          disabled={!attachEnabled || busy}
          title={
            attachEnabled
              ? attached
                ? 'Detach from current chat'
                : 'Attach to current chat'
              : 'Send the first chat message before attaching'
          }
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : attached ? (
            <Unlink className="size-3" />
          ) : (
            <Paperclip className="size-3" />
          )}
        </Button>
      </div>
    </div>
  );
}

function RowActions({
  attached,
  attachEnabled,
  busy,
  onFamily,
  onAttach,
  onOpen,
}: {
  attached: boolean;
  attachEnabled: boolean;
  busy: boolean;
  onFamily: () => void;
  onAttach: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        size="sm"
        variant="ghost"
        className="size-7 p-0"
        onClick={onFamily}
        title="Inspect family"
      >
        <GitBranch className="size-3.5" />
      </Button>
      <Button
        size="sm"
        variant={attached ? 'secondary' : 'ghost'}
        className="size-7 p-0"
        onClick={onAttach}
        disabled={!attachEnabled || busy}
        title={
          attachEnabled
            ? attached
              ? 'Detach from current chat'
              : 'Attach to current chat'
            : 'Send the first chat message before attaching'
        }
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : attached ? (
          <Unlink className="size-3.5" />
        ) : (
          <Paperclip className="size-3.5" />
        )}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="size-7 p-0"
        onClick={onOpen}
        title="Open in Files"
      >
        <ExternalLink className="size-3.5" />
      </Button>
    </div>
  );
}

function FamilyInspector({
  file,
  family,
  state,
  error,
  onBack,
}: {
  file: { id: string; name: string };
  family: FileResourceFamily | null;
  state: LoadState;
  error: string | null;
  onBack: () => void;
}) {
  const duplicateLinks =
    family?.files.filter((row) => typeof row.duplicate_of_file_id === 'string').length ?? 0;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2 py-2">
        <Button size="sm" variant="ghost" className="size-7 p-0" onClick={onBack} title="Back">
          <ArrowLeft className="size-3.5" />
        </Button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{file.name}</div>
          <div className="text-[10px] text-muted-foreground">Complete readable family</div>
        </div>
      </div>
      {state === 'loading' ? (
        <Loading />
      ) : state === 'error' || !family ? (
        <Empty
          icon={<AlertTriangle className="size-5" />}
          title="Couldn't load this family"
          body={error ?? 'Try again.'}
        />
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="font-medium">What this means</div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              The stored file is the binary object. Processing results are separate database records
              derived from it. Parent links preserve ancestry; duplicate links record equivalent
              content but do not automatically expand access.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <FamilyStat label="Stored files" value={family.files.length} />
            <FamilyStat label="Processing results" value={family.processedDocuments.length} />
            <FamilyStat label="Duplicate links" value={duplicateLinks} />
          </div>

          <section>
            <h2 className="mb-1.5 font-medium">Relationships</h2>
            <div className="space-y-1 rounded-md border border-border/60 p-2 text-[11px]">
              <Relationship
                label="Requested file"
                value={shortId(family.requestedFileId || file.id)}
              />
              <Relationship
                label="Root ancestor"
                value={family.rootFileId ? shortId(family.rootFileId) : 'Unavailable'}
              />
              <Relationship
                label="Binary lineage"
                value={`${family.files.length} readable node${family.files.length === 1 ? '' : 's'}`}
              />
              <Relationship
                label="Processed lineage"
                value={`${family.processedDocuments.length} readable result${
                  family.processedDocuments.length === 1 ? '' : 's'
                }`}
              />
            </div>
          </section>

          <section>
            <h2 className="mb-1.5 font-medium">Available representations</h2>
            <div className="flex flex-wrap gap-1.5">
              {family.representations.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">No derivatives yet.</span>
              ) : (
                family.representations.map((representation) => (
                  <Badge key={representation.key} variant="secondary" className="text-[10px]">
                    {representation.label} · {representation.count}
                  </Badge>
                ))
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-1.5 font-medium">Agent capabilities</h2>
            <div className="flex flex-wrap gap-1.5">
              {family.capabilities.map((capability) => (
                <Badge key={capability} variant="outline" className="text-[10px]">
                  {capability}
                </Badge>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
              Attaching this file gives the agent the readable family through these bounded
              capabilities. Family discovery itself does not create processing work.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

function FamilyStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/60 px-2 py-2 text-center">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[9px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

function Relationship({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-[10px]">{value}</span>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
    </div>
  );
}

function Empty({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="flex size-9 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
        {icon}
      </div>
      <div className="text-sm font-medium">{title}</div>
      <div className="max-w-xs text-xs text-muted-foreground">{body}</div>
    </div>
  );
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes < 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}
