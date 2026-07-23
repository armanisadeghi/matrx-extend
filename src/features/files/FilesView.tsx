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
  Loader2,
  Paperclip,
  RefreshCw,
  Search,
  Unlink,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type FileFamilyFile,
  type FileFamilyProcessedDocument,
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
const GRAPH_PAGE_SIZE = 100;

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
  const loadGeneration = useRef(0);
  const familyGeneration = useRef(0);
  const attachmentGeneration = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const attachmentSnapshot = attachmentGeneration.current;
    if (!user) {
      setFiles([]);
      setCaptures([]);
      setAttachedIds(new Set());
      setState('ready');
      setError(null);
      return;
    }
    setState('loading');
    setError(null);
    try {
      const [library, recentCaptures, attached] = await Promise.all([
        fetchRecentFiles(user.id),
        fetchRecentExtensionCaptures(),
        conversationId ? fetchAttachedFileIds(conversationId) : Promise.resolve(new Set<string>()),
      ]);
      if (generation !== loadGeneration.current) return;
      setFiles(library);
      setCaptures(recentCaptures);
      // A refresh that began before an attach/detach must not restore its
      // older attachment snapshot after the mutation succeeds.
      if (attachmentSnapshot === attachmentGeneration.current) {
        setAttachedIds(attached);
      }
      setState('ready');
    } catch (cause) {
      if (generation !== loadGeneration.current) return;
      setError(cause instanceof Error ? cause.message : 'Could not load files.');
      setState('error');
    }
  }, [conversationId, user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openFamily = useCallback(async (id: string, name: string) => {
    const generation = ++familyGeneration.current;
    setFamilyFile({ id, name });
    setFamily(null);
    setFamilyState('loading');
    setFamilyError(null);
    try {
      const result = await fetchFileResourceFamily(id);
      if (generation !== familyGeneration.current) return;
      setFamily(result);
      setFamilyState('ready');
    } catch (cause) {
      if (generation !== familyGeneration.current) return;
      setFamilyError(cause instanceof Error ? cause.message : 'Could not load the file family.');
      setFamilyState('error');
    }
  }, []);

  const toggleAttachment = useCallback(
    async (fileId: string, name: string) => {
      if (!conversationId || busyFileId) return;
      const mutationGeneration = ++attachmentGeneration.current;
      setBusyFileId(fileId);
      setError(null);
      try {
        const wasAttached = attachedIds.has(fileId);
        if (wasAttached) {
          await detachFileFromConversation(fileId, conversationId);
        } else {
          await attachFileToConversation(fileId, conversationId, name);
        }
        if (useChatStore.getState().selectedConversationId !== conversationId) return;
        // Reflect the committed mutation immediately. The reload below remains
        // authoritative, but a reconciliation failure must not display the
        // inverse of a mutation that already succeeded.
        setAttachedIds((current) => {
          const next = new Set(current);
          if (wasAttached) next.delete(fileId);
          else next.add(fileId);
          return next;
        });
        // Invalidate any pre-commit snapshot, then replace local state with an
        // authoritative post-commit read instead of patching a possibly stale
        // set left behind by rapid conversation switches.
        if (mutationGeneration === attachmentGeneration.current) {
          attachmentGeneration.current += 1;
        }
        await reload();
      } catch (cause) {
        if (useChatStore.getState().selectedConversationId === conversationId) {
          setError(cause instanceof Error ? cause.message : 'Could not update the attachment.');
        }
      } finally {
        setBusyFileId((current) => (current === fileId ? null : current));
      }
    },
    [attachedIds, busyFileId, conversationId, reload],
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
        onBack={() => {
          familyGeneration.current += 1;
          setFamilyFile(null);
        }}
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
            Your Matrx library and saved extension screenshots.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          onClick={() => void reload()}
          disabled={state === 'loading' || busyFileId !== null}
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
            Screenshots
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
                  attachmentDisabled={busyFileId !== null}
                  working={busyFileId === file.id}
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
                  attachmentDisabled={busyFileId !== null}
                  working={busyFileId === capture.file_id}
                  onFamily={() =>
                    void openFamily(capture.file_id, capture.page_title ?? capture.page_url_full)
                  }
                  onAttach={() =>
                    void toggleAttachment(capture.file_id, capture.page_title ?? 'Screenshot')
                  }
                  onOpen={() =>
                    void chrome.tabs.create({
                      url: `${ENV.FRONTEND_URL}/files/f/${encodeURIComponent(capture.file_id)}`,
                    })
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
  attachmentDisabled,
  working,
  onFamily,
  onAttach,
  onOpen,
}: {
  file: FileInventoryItem;
  attached: boolean;
  attachEnabled: boolean;
  attachmentDisabled: boolean;
  working: boolean;
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
        attachmentDisabled={attachmentDisabled}
        working={working}
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
  attachmentDisabled,
  working,
  onFamily,
  onAttach,
  onOpen,
}: {
  capture: ScreenshotRow;
  attached: boolean;
  attachEnabled: boolean;
  attachmentDisabled: boolean;
  working: boolean;
  onFamily: () => void;
  onAttach: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-card">
      <button
        type="button"
        className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 bg-muted/40 px-2 text-muted-foreground hover:bg-muted/60"
        onClick={onOpen}
        title="Open capture in Files"
      >
        <FileImage className="size-6 text-violet-500" />
        <span className="line-clamp-2 text-center text-[9px]">
          {capture.page_title ?? 'Saved screenshot'}
        </span>
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
          disabled={!attachEnabled || attachmentDisabled}
          title={
            attachEnabled
              ? attached
                ? 'Detach from current chat'
                : 'Attach to current chat'
              : 'Send the first chat message before attaching'
          }
        >
          {working ? (
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
  attachmentDisabled,
  working,
  onFamily,
  onAttach,
  onOpen,
}: {
  attached: boolean;
  attachEnabled: boolean;
  attachmentDisabled: boolean;
  working: boolean;
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
        disabled={!attachEnabled || attachmentDisabled}
        title={
          attachEnabled
            ? attached
              ? 'Detach from current chat'
              : 'Attach to current chat'
            : 'Send the first chat message before attaching'
        }
      >
        {working ? (
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
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2 py-2">
        <Button size="sm" variant="ghost" className="size-7 p-0" onClick={onBack} title="Back">
          <ArrowLeft className="size-3.5" />
        </Button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{file.name}</div>
          <div className="text-[10px] text-muted-foreground">Readable provenance family</div>
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
            <FamilyStat label="Representations" value={family.representations.length} />
          </div>

          <section>
            <h2 className="mb-1.5 font-medium">Relationships</h2>
            <div className="space-y-1 rounded-md border border-border/60 p-2 text-[11px]">
              <Relationship
                label="Requested file"
                value={shortId(family.requestedFileId || file.id)}
              />
              <Relationship label="Readable family anchor" value={shortId(family.rootFileId)} />
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
              <Relationship label="Duplicate family" value="Not enumerated here" />
            </div>
          </section>

          <section>
            <h2 className="mb-1.5 font-medium">Stored-file ancestry</h2>
            <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
              Each indented row points to the stored file above it through{' '}
              <code>parent_file_id</code>. This is the binary ancestry graph.
            </p>
            <BinaryFamilyGraph family={family} />
          </section>

          <section>
            <h2 className="mb-1.5 font-medium">Processing-result ancestry</h2>
            <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
              These are processing records derived from stored files or from another processing
              result. They are not extra copies of the binary.
            </p>
            <ProcessedFamilyGraph documents={family.processedDocuments} />
          </section>

          <section className="rounded-md border border-border/60 p-2">
            <h2 className="font-medium">Dedupe boundary</h2>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              Extension uploads checksum-match within your identity in the organization and reuse
              the canonical file instead of making another row. The broader Files service also
              supports explicit create, reuse, and force-copy intents; only a deliberate force-copy
              needs a reason and records <code>duplicate_of_file_id</code>. That equivalence link
              stays separate from ancestry and is not expanded here, so it cannot become an
              access-sharing path.
            </p>
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
              capabilities. The inventory returns completely within its 16-generation and 5,000-row
              safety contract or fails loudly; discovery itself creates no processing work.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

function BinaryFamilyGraph({ family }: { family: FileResourceFamily }) {
  const ordered = orderBinaryFamily(family.files);
  const [page, setPage] = useState(0);
  if (ordered.length === 0) {
    return <FamilyGraphEmpty body="No readable stored-file nodes were returned." />;
  }
  const relationById = binaryRelations(family.files, family.requestedFileId);
  const pageCount = Math.ceil(ordered.length / GRAPH_PAGE_SIZE);
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * GRAPH_PAGE_SIZE;
  const visible = ordered.slice(start, start + GRAPH_PAGE_SIZE);
  return (
    <div className="space-y-1 rounded-md border border-border/60 p-2">
      {visible.map(({ node, depth }) => (
        <div
          key={node.id}
          className="rounded border border-border/40 bg-background/60 px-2 py-1.5"
          style={{ marginLeft: `${Math.min(depth, 12) * 10}px` }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <GitBranch className="size-3 shrink-0 text-sky-500" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{node.name}</span>
            <Badge
              variant={node.id === family.requestedFileId ? 'default' : 'secondary'}
              className="text-[8px]"
            >
              {relationById.get(node.id) ?? 'related branch'}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[9px] text-muted-foreground">
            <span>{shortId(node.id)}</span>
            {node.parentFileId && <span>parent {shortId(node.parentFileId)}</span>}
            {node.derivationKind && <span>{node.derivationKind}</span>}
            {node.duplicateOfFileId && <span>equivalent to {shortId(node.duplicateOfFileId)}</span>}
          </div>
        </div>
      ))}
      {pageCount > 1 && (
        <GraphPager
          page={safePage}
          pageCount={pageCount}
          start={start}
          visibleCount={visible.length}
          total={ordered.length}
          onPage={setPage}
        />
      )}
    </div>
  );
}

function ProcessedFamilyGraph({
  documents,
}: {
  documents: FileFamilyProcessedDocument[];
}) {
  const ordered = orderProcessedFamily(documents);
  const [page, setPage] = useState(0);
  if (ordered.length === 0) {
    return <FamilyGraphEmpty body="This family has no readable processing results yet." />;
  }
  const pageCount = Math.ceil(ordered.length / GRAPH_PAGE_SIZE);
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * GRAPH_PAGE_SIZE;
  const visible = ordered.slice(start, start + GRAPH_PAGE_SIZE);
  return (
    <div className="space-y-1 rounded-md border border-border/60 p-2">
      {visible.map(({ node, depth }) => (
        <div
          key={node.id}
          className="rounded border border-border/40 bg-background/60 px-2 py-1.5"
          style={{ marginLeft: `${Math.min(depth, 12) * 10}px` }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <File className="size-3 shrink-0 text-emerald-500" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
              {node.name ?? 'Processing result'}
            </span>
            {node.cleanReady && (
              <Badge variant="secondary" className="text-[8px]">
                clean text
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[9px] text-muted-foreground">
            <span>{shortId(node.id)}</span>
            {node.parentProcessedId ? (
              <span>parent {shortId(node.parentProcessedId)}</span>
            ) : node.sourceId ? (
              <span>source {shortId(node.sourceId)}</span>
            ) : (
              <span>source redacted</span>
            )}
            {node.derivationKind && <span>{node.derivationKind}</span>}
          </div>
        </div>
      ))}
      {pageCount > 1 && (
        <GraphPager
          page={safePage}
          pageCount={pageCount}
          start={start}
          visibleCount={visible.length}
          total={ordered.length}
          onPage={setPage}
        />
      )}
    </div>
  );
}

function GraphPager({
  page,
  pageCount,
  start,
  visibleCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  start: number;
  visibleCount: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 pt-1">
      <Button
        size="sm"
        variant="secondary"
        className="h-7 flex-1 text-[10px]"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </Button>
      <span className="shrink-0 px-1 text-[9px] text-muted-foreground">
        {start + 1}–{start + visibleCount} of {total}
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 flex-1 text-[10px]"
        disabled={page + 1 >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

function FamilyGraphEmpty({ body }: { body: string }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 px-2 py-3 text-center text-[10px] text-muted-foreground">
      {body}
    </div>
  );
}

function orderBinaryFamily(
  nodes: FileFamilyFile[],
): Array<{ node: FileFamilyFile; depth: number }> {
  return orderFamilyNodes(
    nodes,
    (node) => node.id,
    (node) => node.parentFileId,
  );
}

function orderProcessedFamily(
  nodes: FileFamilyProcessedDocument[],
): Array<{ node: FileFamilyProcessedDocument; depth: number }> {
  return orderFamilyNodes(
    nodes,
    (node) => node.id,
    (node) => node.parentProcessedId,
  );
}

function orderFamilyNodes<T>(
  nodes: T[],
  getId: (node: T) => string,
  getParentId: (node: T) => string | null,
): Array<{ node: T; depth: number }> {
  const byId = new Map(nodes.map((node) => [getId(node), node]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const node of nodes) {
    const parentId = getParentId(node);
    if (!parentId || !byId.has(parentId)) {
      roots.push(node);
      continue;
    }
    const siblings = children.get(parentId) ?? [];
    siblings.push(node);
    children.set(parentId, siblings);
  }
  const result: Array<{ node: T; depth: number }> = [];
  const visited = new Set<string>();
  const visit = (node: T, depth: number) => {
    const id = getId(node);
    if (visited.has(id)) return;
    visited.add(id);
    result.push({ node, depth });
    for (const child of children.get(id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  for (const node of nodes) visit(node, 0);
  return result;
}

function binaryRelations(nodes: FileFamilyFile[], requestedId: string): Map<string, string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ancestors = new Set<string>();
  let cursor = byId.get(requestedId)?.parentFileId ?? null;
  while (cursor && !ancestors.has(cursor)) {
    ancestors.add(cursor);
    cursor = byId.get(cursor)?.parentFileId ?? null;
  }
  const isDescendant = (node: FileFamilyFile): boolean => {
    const seen = new Set<string>();
    let parentId = node.parentFileId;
    while (parentId && !seen.has(parentId)) {
      if (parentId === requestedId) return true;
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentFileId ?? null;
    }
    return false;
  };
  const requestedParent = byId.get(requestedId)?.parentFileId ?? null;
  return new Map(
    nodes.map((node) => {
      if (node.id === requestedId) return [node.id, 'requested'];
      if (ancestors.has(node.id)) return [node.id, 'ancestor'];
      if (isDescendant(node)) return [node.id, 'descendant'];
      if (requestedParent && node.parentFileId === requestedParent) return [node.id, 'sibling'];
      return [node.id, 'related branch'];
    }),
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
