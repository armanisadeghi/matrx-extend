import {
  type SocialPostMedia,
  addPostToCollection,
  createCollection,
  getPostMedia,
  getPostMediaCoverage,
} from '@/lib/api/routes/social';
import { DEFAULT_POLL_FLOOR_MS } from '@/lib/capture-ladder/queue';
import {
  type SwipeCollection,
  type SwipeMembership,
  type SwipePost,
  type SwipeProfile,
  type SwipeStats,
  type SwipeTranscript,
  readSwipeCollections,
  readSwipeMemberships,
  readSwipePost,
  readSwipePostSummary,
  removeSwipeMembership,
  updateSwipeCollection,
  updateSwipeNotes,
} from '@/lib/swipe-file/library';
import { swipePostWebUrl } from '@/lib/swipe-file/navigation';
import {
  type MediaCoverage,
  type SwipeCaptureReceipt,
  readSwipeReceipt,
} from '@/lib/swipe-file/receipt';
import { saveToSwipeFile } from '@/lib/swipe-file/save';
import { useSwipeFileStore } from '@/state/swipe-file';
import { Button, BasicInput as Input } from '@ai-matrx/design-system';
import { ArrowLeft, Bookmark, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StoredMedia } from './StoredMedia';

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Could not complete this action.';

export function SwipeFileView() {
  const selection = useSwipeFileStore((s) => s.selection);
  const select = useSwipeFileStore((s) => s.select);
  const [collections, setCollections] = useState<SwipeCollection[]>([]);
  const [memberships, setMemberships] = useState<SwipeMembership[]>([]);
  const [filter, setFilter] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [newName, setNewName] = useState('');
  const [rename, setRename] = useState('');
  const [profile, setProfile] = useState<SwipeProfile | null>(null);
  const [stats, setStats] = useState<SwipeStats | null>(null);
  const [post, setPost] = useState<SwipePost | null>(null);
  const [transcripts, setTranscripts] = useState<SwipeTranscript[]>([]);
  const [media, setMedia] = useState<SocialPostMedia[]>([]);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [coverage, setCoverage] = useState<MediaCoverage | null>(null);
  const [receipt, setReceipt] = useState<SwipeCaptureReceipt | null>(null);
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [destination, setDestination] = useState('');
  const generation = useRef(0);
  const currentCollection = collections.find((c) => c.id === filter);
  const member = memberships.find(
    (m) =>
      m.target_id === selection?.postId &&
      (!selection.collectionId || m.source_id === selection.collectionId),
  );
  const organizationId = member?.organization_id ?? selection?.organizationId;
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, m] = await Promise.all([
        readSwipeCollections(includeArchived),
        readSwipeMemberships(),
      ]);
      setCollections(c);
      setMemberships(m);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    setRename(currentCollection?.name ?? '');
  }, [currentCollection]);
  useEffect(() => {
    setNote(member?.metadata?.note ?? '');
    setTags(member?.metadata?.tags?.join(', ') ?? '');
  }, [member]);
  useEffect(() => {
    const id = ++generation.current;
    setPost(null);
    setProfile(null);
    setStats(null);
    setMediaLoaded(false);
    setMedia([]);
    setTranscripts([]);
    setReceipt(null);
    setCoverage(null);
    setStatus('');
    if (!selection) return;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const details = await readSwipePost(selection.postId);
        if (generation.current !== id) return;
        setPost(details.post);
        setProfile(details.profile ?? null);
        setStats(details.stats ?? null);
        setTranscripts(details.transcripts);
        if (!organizationId) throw new Error('Choose a collection to open the stored files.');
        const [files, capture, currentCoverage] = await Promise.all([
          getPostMedia(selection.postId, organizationId),
          readSwipeReceipt(selection.postId),
          getPostMediaCoverage(selection.postId, organizationId).catch(() => null),
        ]);
        if (generation.current !== id) return;
        setMedia(files);
        setMediaLoaded(true);
        setReceipt(capture);
        setCoverage(currentCoverage);
      } catch (cause) {
        if (generation.current === id) setError(message(cause));
      } finally {
        if (generation.current === id) setLoading(false);
      }
    })();
    return () => {
      generation.current++;
    };
  }, [selection, organizationId]);
  useEffect(() => {
    if (!selection || !organizationId || coverage?.browser_capture?.status !== 'pending') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refreshPending = async () => {
      try {
        const [nextCoverage, files] = await Promise.all([
          getPostMediaCoverage(selection.postId, organizationId),
          getPostMedia(selection.postId, organizationId),
        ]);
        if (cancelled) return;
        setCoverage(nextCoverage);
        setMedia(files);
        if (nextCoverage.browser_capture?.status === 'pending')
          timer = setTimeout(() => void refreshPending(), DEFAULT_POLL_FLOOR_MS);
      } catch (cause) {
        if (!cancelled) setError(message(cause));
      }
    };
    timer = setTimeout(() => void refreshPending(), DEFAULT_POLL_FLOOR_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selection, organizationId, coverage?.browser_capture?.status]);
  async function act(work: () => Promise<void>, success: string) {
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      await work();
      await reload();
      setStatus(success);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  const visibleCollections = new Set(collections.map((c) => c.id));
  const rows = memberships.filter(
    (m) => visibleCollections.has(m.source_id) && (!filter || m.source_id === filter),
  );
  const filtered = rows.filter((m) =>
    `${collections.find((c) => c.id === m.source_id)?.name ?? ''} ${m.metadata?.note ?? ''} ${m.metadata?.tags?.join(' ') ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="h-full min-h-0 flex flex-col">
      <header className="flex items-center justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-2">
          <Bookmark className="size-4 text-primary" />
          <h1 className="text-sm font-semibold">Swipe file</h1>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Refresh swipe file"
          onClick={() => void reload()}
          disabled={loading}
        >
          <RefreshCw className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
          >
            {error}
          </div>
        )}
        {status && <output className="text-xs text-emerald-600">{status}</output>}
        {loading && (
          <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Loading…
          </div>
        )}
        {selection ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => select(null)}>
              <ArrowLeft className="size-3" />
              Collections
            </Button>
            {post && (
              <>
                <div className="space-y-2">
                  <div className="flex gap-2 text-[11px] text-muted-foreground">
                    <span className="capitalize">{post.platform}</span>
                    <span>{post.format}</span>
                    <span>
                      {post.posted_at
                        ? new Date(post.posted_at).toLocaleDateString()
                        : 'Date unavailable'}
                    </span>
                  </div>
                  {profile && (
                    <p className="text-xs text-muted-foreground">
                      {profile.display_name ? `${profile.display_name} · ` : ''}@
                      {profile.handle.replace(/^@/, '')}
                    </p>
                  )}
                  <h2 className="text-sm font-semibold break-words">
                    {post.title || 'Saved post'}
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    <a
                      className="inline-flex items-center gap-1 text-xs text-primary underline"
                      href={post.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Original post
                      <ExternalLink className="size-3" />
                    </a>
                    {organizationId && (
                      <a
                        className="inline-flex items-center gap-1 text-xs text-primary underline"
                        href={swipePostWebUrl(post.id, organizationId)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Matrx
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                </div>
                <section className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold">Capture</h3>
                    {member && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const result = await saveToSwipeFile(
                              { url: post.url, collectionId: member.source_id },
                              setStatus,
                            );
                            if (result.status === 'failed') throw new Error(result.reason);
                            if (selection) select({ ...selection });
                          }, 'Capture refreshed')
                        }
                      >
                        Refresh capture
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded bg-muted px-2 py-1">
                      {mediaLoaded
                        ? `${media.length} stored ${media.length === 1 ? 'file' : 'files'}`
                        : 'Media status unavailable'}
                    </span>
                    <span className="rounded bg-muted px-2 py-1">
                      {transcripts.length ? 'Transcript available' : 'No stored transcript'}
                    </span>
                    <span className="rounded bg-muted px-2 py-1">
                      {coverage?.status === 'complete'
                        ? 'All reported media stored'
                        : coverage?.expected_items != null
                          ? `${coverage.stored_items} of ${coverage.expected_items} media items stored`
                          : 'Coverage unverified'}
                    </span>
                  </div>
                  {coverage?.browser_capture && (
                    <div className="space-y-1 text-xs">
                      <p>
                        {coverage.browser_capture.status === 'pending'
                          ? `Browser capture processing · ${coverage.browser_capture.observed_items} media items observed`
                          : `${coverage.browser_capture.stored_items} browser media files stored`}
                      </p>
                      {coverage.browser_capture.failed_items > 0 && (
                        <p className="text-amber-600">
                          {coverage.browser_capture.failed_items} browser media{' '}
                          {coverage.browser_capture.failed_items === 1 ? 'item' : 'items'}{' '}
                          unavailable
                        </p>
                      )}
                      {coverage.browser_capture.notes.map((note, index) => (
                        <p key={`${index}-${note}`} className="text-muted-foreground">
                          {note}
                        </p>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">Comments excluded</p>
                  {post.platform === 'youtube' && (
                    <p className="text-xs text-muted-foreground">
                      YouTube video plays from the original post.
                    </p>
                  )}
                  {receipt?.mediaNotes.map((warning, index) => (
                    <p key={`${index}-${warning}`} className="text-xs text-amber-600">
                      {warning}
                    </p>
                  ))}
                </section>
                {stats && (
                  <section className="rounded-lg border p-3 space-y-2">
                    <h3 className="text-xs font-semibold">Captured metrics</h3>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {(['views', 'likes', 'comments', 'shares', 'saves'] as const).map((key) => (
                        <div key={key}>
                          <span className="block capitalize text-muted-foreground">{key}</span>
                          <span>{stats[key] === null ? '—' : stats[key].toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                    {stats.metrics_observed_at && (
                      <p className="text-[11px] text-muted-foreground">
                        Observed {new Date(stats.metrics_observed_at).toLocaleString()}
                      </p>
                    )}
                  </section>
                )}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold">Caption</h3>
                  <p className="whitespace-pre-wrap break-words text-xs">
                    {post.caption || 'No caption captured'}
                  </p>
                  {post.hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                      {post.hashtags.map((tag) => (
                        <span key={tag}>#{tag.replace(/^#/, '')}</span>
                      ))}
                    </div>
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold">Stored media</h3>
                  {organizationId &&
                    media.map((file) => (
                      <StoredMedia
                        key={`${post.id}-${file.file_id}`}
                        media={file}
                        postId={post.id}
                        organizationId={organizationId}
                      />
                    ))}
                  {!loading && mediaLoaded && media.length === 0 && (
                    <p className="text-xs text-muted-foreground">No stored files</p>
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold">Transcript</h3>
                  {transcripts.map((t) => (
                    <details key={t.id} className="rounded-lg border p-2">
                      <summary className="cursor-pointer text-xs">
                        {t.language} · {t.source}
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap text-xs">{t.text}</p>
                    </details>
                  ))}
                  {!transcripts.length && (
                    <p className="text-xs text-muted-foreground">No stored transcript</p>
                  )}
                </section>
                {member && (
                  <section className="rounded-lg border p-3 space-y-2">
                    <h3 className="text-xs font-semibold">
                      {collections.find((c) => c.id === member.source_id)?.name ?? 'Collection'}
                    </h3>
                    <label className="block text-xs space-y-1">
                      <span>Note</span>
                      <textarea
                        className="w-full min-h-20 rounded-md border bg-background p-2 text-xs"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                    <label htmlFor="swipe-tags" className="block text-xs space-y-1">
                      <span>Tags</span>
                      <Input
                        id="swipe-tags"
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                        placeholder="Ideas, hooks, inspiration"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              updateSwipeNotes(
                                member,
                                note,
                                tags
                                  .split(',')
                                  .map((t) => t.trim())
                                  .filter(Boolean),
                              ),
                            'Changes saved',
                          )
                        }
                      >
                        Save changes
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await removeSwipeMembership(member);
                            select(null);
                          }, 'Removed from collection')
                        }
                      >
                        Remove from collection
                      </Button>
                    </div>
                  </section>
                )}
                <div className="flex gap-2">
                  <select
                    aria-label="Destination collection"
                    className="min-w-0 flex-1 rounded-md border bg-background p-2 text-xs"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                  >
                    <option value="">Add to collection…</option>
                    {collections
                      .filter((c) => !c.deleted_at)
                      .map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={busy || !destination}
                    onClick={() =>
                      void act(async () => {
                        const c = collections.find((c) => c.id === destination);
                        if (!c) throw new Error('Choose a collection.');
                        const r = await addPostToCollection(c.id, post.id, c.organization_id);
                        if (!r.ok) throw new Error(r.error);
                      }, 'Added to collection')
                    }
                  >
                    Add
                  </Button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <select
              aria-label="Collection filter"
              className="w-full rounded-md border bg-background p-2 text-xs"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">All collections</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.deleted_at ? ' (archived)' : ''}
                </option>
              ))}
            </select>
            <label className="flex gap-2 items-center text-xs">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Show archived collections
            </label>
            <div className="flex gap-2">
              <Input
                aria-label="New collection name"
                placeholder="New collection"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Button
                size="sm"
                disabled={busy || !newName.trim()}
                onClick={() =>
                  void act(async () => {
                    const r = await createCollection(newName.trim());
                    if (!r.ok) throw new Error(r.error);
                    setNewName('');
                  }, 'Collection created')
                }
              >
                Create
              </Button>
            </div>
            {currentCollection && (
              <div className="space-y-2 rounded-lg border p-2">
                <Input
                  aria-label="Collection name"
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !rename.trim()}
                    onClick={() =>
                      void act(
                        () => updateSwipeCollection(currentCollection, { name: rename.trim() }),
                        'Collection renamed',
                      )
                    }
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        async () => {
                          await updateSwipeCollection(currentCollection, {
                            deleted_at: currentCollection.deleted_at
                              ? null
                              : new Date().toISOString(),
                          });
                          setFilter('');
                        },
                        currentCollection.deleted_at
                          ? 'Collection restored'
                          : 'Collection archived',
                      )
                    }
                  >
                    {currentCollection.deleted_at ? 'Restore' : 'Archive'}
                  </Button>
                </div>
              </div>
            )}
            <Input
              aria-label="Search saved notes and tags"
              placeholder="Search notes, tags, collections"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {!loading && filtered.length === 0 && (
              <div className="py-8 text-center text-xs text-muted-foreground">No saved items</div>
            )}
            {filtered.map((m) => (
              <SwipeRow
                key={m.id}
                member={m}
                collectionName={collections.find((c) => c.id === m.source_id)?.name ?? 'Collection'}
                open={() =>
                  select({
                    postId: m.target_id,
                    collectionId: m.source_id,
                    organizationId: m.organization_id,
                  })
                }
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
function SwipeRow({
  member,
  collectionName,
  open,
}: { member: SwipeMembership; collectionName: string; open: () => void }) {
  const [post, setPost] = useState<SwipePost | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (member.target_type === 'social_post')
      void readSwipePostSummary(member.target_id)
        .then((r) => {
          if (active) setPost(r);
        })
        .catch((cause) => {
          if (active) setError(message(cause));
        });
    return () => {
      active = false;
    };
  }, [member.target_id, member.target_type]);
  if (member.target_type !== 'social_post')
    return (
      <div className="rounded-lg border p-3 space-y-1">
        <p className="text-xs font-medium">
          {member.target_type === 'social_ad' ? 'Saved ad' : 'Saved profile'}
        </p>
        <p className="text-xs text-muted-foreground">
          {collectionName} · Available in the main app
        </p>
      </div>
    );
  return (
    <button
      type="button"
      onClick={open}
      className="w-full text-left rounded-lg border bg-card hover:bg-accent/40 p-3 space-y-1"
    >
      <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{collectionName}</span>
        <span className="capitalize">{post?.platform}</span>
      </div>
      <p className="text-xs font-medium line-clamp-2">
        {post?.title || post?.caption || (error ? 'Post unavailable' : 'Saved post')}
      </p>
      {member.metadata?.note && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{member.metadata.note}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </button>
  );
}
