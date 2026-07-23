# Extension Files

The Files side-panel tab is the extension's small, canonical file surface. It
does not create a second file store.

## Data paths

- **Library** calls the public, identity-locked `get_user_file_tree` RPC with
  `p_order_by = updated_at_desc`. That is the same discoverability boundary as
  the web Files UI: owned and explicitly granted root files are listable;
  contextual access, binary derivatives, and the extension's hidden `system/`
  namespace do not become globally discoverable.
- **Captures** reads `extend.wbx_screenshot`, whose rows are metadata pointers
  to canonical file IDs. RLS owns the user boundary. This is intentionally
  cross-page; the existing Screenshots tab remains the current-page capture
  and delete surface.
- **Family inspector** calls `get_file_resource_family(file_id)`. It is
  read-only and never schedules extraction, cleanup, RAG, transcription,
  analysis, or verification work.
- **Attach/detach** uses the canonical `assoc_add` / `assoc_remove` RPCs to
  write a role-less `file -> conversation` edge with
  `metadata = { file_id }`. The backend resolves that file's complete readable
  family at request time. No file content is copied into the request payload.

## Relationship vocabulary

- A **stored file** is the binary object and its storage identity.
- A **processed document** is a result derived by extraction/cleanup from a
  stored file or another processing result. It is not another copy of the
  binary.
- `parent_file_id` and `parent_processed_id` are provenance edges. Ancestors
  are earlier sources; descendants are derived outputs; siblings share a
  parent.
- `duplicate_of_file_id` is an equivalence/dedupe edge, not a provenance edge.
  It remains visible as related metadata but does not automatically expand the
  readable family or sharing boundary.

## Deliberate first version boundary

An attachment needs a real conversation ID. The extension learns that ID when
the first stream opens, so Files can attach to an existing/current
conversation but cannot affect the very first message of a brand-new chat.
The UI says this directly. Solving pre-first-turn attachment requires a
conversation-reservation flow shared with the server; it must not be faked
with an ephemeral context key.
