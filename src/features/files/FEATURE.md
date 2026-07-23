# Extension Files

The Files side-panel tab is the extension's small, canonical file surface. It
does not create a second file store.

## Data paths

- **Library** calls the public, identity-locked `get_user_file_tree` RPC with
  `p_order_by = updated_at_desc`. That is the same discoverability boundary as
  the web Files UI: owned and explicitly granted root files are listable;
  contextual access, binary derivatives, and the extension's hidden
  `system-files/matrx-extend/` namespace do not become globally discoverable.
- **Captures** reads `extend.wbx_screenshot`, whose rows are metadata pointers
  to canonical file IDs. RLS owns the user boundary. This is intentionally
  cross-page; the existing Screenshots tab remains the current-page capture
  and delete surface.
- **Family inspector** calls `get_file_resource_family(file_id)`. It is
  read-only and never schedules extraction, cleanup, RAG, transcription,
  analysis, or verification work. It renders every returned stored-file and
  processed-document node with its parent edge, derivation kind, and relation
  to the requested file. Load failures retain the selected file and expose a
  real retry action.
- **Attach/detach** uses the dedicated `conversation_file_add`,
  `conversation_file_remove`, and `conversation_files` RPCs. Add requires
  editor authority over both the conversation and file because the edge
  re-shares viewer context; list/remove independently gate the conversation.
  These RPCs operate on the platform's existing canonical role-less
  `file → conversation` edge, so the extension and web client cannot create
  parallel attachment records.
  A successful mutation updates the visible attachment state immediately and
  then performs an authoritative reload; if reconciliation fails, the UI keeps
  the committed state and surfaces the reload error.
  The backend resolves the attached file's readable family at request time.
  No file content is copied into the request payload.
- **Screenshot cards** open the canonical Files viewer by `file_id`. The
  persisted `extend.wbx_screenshot.file_url` is an expiring upload-time URL and
  is never treated as a durable thumbnail or destination. The current-page
  Screenshots tab resolves fresh authenticated bytes by `file_id` for previews
  and copies/opens the durable Files route.

## Relationship vocabulary

- A **stored file** is the binary object and its storage identity.
- A **processed document** is a result derived by extraction/cleanup from a
  stored file or another processing result. It is not another copy of the
  binary.
- `parent_file_id` and `parent_processed_id` are provenance edges. Ancestors
  are earlier sources; descendants are derived outputs; siblings share a
  parent.
- `duplicate_of_file_id` is an equivalence/dedupe edge, not a provenance edge.
  The extension's legacy `/files/upload` endpoint checksum-matches within the
  current owner + organization and implicitly reuses the canonical row. The
  broader Files service exposes explicit create/reuse/force-copy intents; only
  `force_new_copy` (with a reason) creates a second identity carrying this
  pointer. This provenance-family RPC intentionally does not enumerate a
  separate duplicate family, and visibility redaction normally removes a
  pointer whose target is outside the readable provenance family. That keeps
  dedupe from becoming an access-sharing path.
- The RPC's implementation is bounded to 16 generations and 5,000 rows. It
  returns a complete result within that contract or fails loudly on depth,
  breadth, or cycle overflow; the UI never presents a silently partial graph.
  The UI renders true 100-node pages (replacing, not accumulating, the prior
  page) so a valid maximum family cannot freeze the side panel.
  Every traversed node is caller-readable; a hidden ancestor ends the visible
  path and cannot influence an overflow error.

## Runtime race and byte-loading rules

- Attachment mutations are globally serialized in this compact surface. A
  refresh that started before an attach/detach cannot overwrite the
  server-confirmed result when it resolves later.
- Current-page screenshot previews download authenticated bytes only when the
  card approaches the viewport, then abort and revoke their blob URL after the
  card leaves it. Reloads use a generation token, and a successful delete
  starts an authoritative current-page reload, so an older query cannot
  overwrite a newer result or resurrect a deleted card. Query and deletion
  failures are visible; a failed read never masquerades as an empty gallery,
  and all delete controls are disabled while the single serialized deletion is
  pending.

## Deliberate first version boundary

An attachment needs a real conversation ID. The extension learns that ID when
the first stream opens, so Files can attach to an existing/current
conversation but cannot affect the very first message of a brand-new chat.
The UI says this directly. Solving pre-first-turn attachment requires a
conversation-reservation flow shared with the server; it must not be faked
with an ephemeral context key.
