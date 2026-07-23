import { getSupabase } from '@/lib/supabase/client';
import type { ScreenshotRow } from '@/lib/supabase/queries';
import { fetchRecentScreenshots } from '@/lib/supabase/queries';
import { chatDb } from '@/lib/supabase/schemas';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface FileInventoryItem {
  id: string;
  name: string;
  path: string;
  mimeType: string | null;
  sizeBytes: number | null;
  visibility: string;
  updatedAt: string;
}

export interface FileFamilyRepresentation {
  key: string;
  label: string;
  category: string;
  count: number;
  promotable: boolean;
  fetchTool: string;
}

export interface FileResourceFamily {
  schemaVersion: number;
  requestedFileId: string;
  rootFileId: string | null;
  files: ReadonlyArray<Record<string, unknown>>;
  processedDocuments: ReadonlyArray<Record<string, unknown>>;
  representations: FileFamilyRepresentation[];
  capabilities: string[];
  counts: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

function number(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

export function parseFileInventoryRows(value: unknown): FileInventoryItem[] {
  if (!Array.isArray(value)) return [];
  const files: FileInventoryItem[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const kind = text(candidate, 'kind');
    if (kind !== null && kind !== 'file') continue;
    const id = text(candidate, 'id');
    const name = text(candidate, 'name', 'file_name');
    const path = text(candidate, 'path', 'file_path');
    const updatedAt = text(candidate, 'updated_at');
    if (!id || !UUID_PATTERN.test(id) || !name || !path || !updatedAt) continue;
    files.push({
      id,
      name,
      path,
      mimeType: text(candidate, 'mime_type'),
      sizeBytes: number(candidate, 'size_bytes', 'file_size'),
      visibility: text(candidate, 'visibility') ?? 'personal',
      updatedAt,
    });
  }
  return files;
}

export async function fetchRecentFiles(userId: string, limit = 100): Promise<FileInventoryItem[]> {
  const { data, error } = await getSupabase().rpc('get_user_file_tree', {
    p_user_id: userId,
    p_limit: Math.min(Math.max(limit, 1), 200),
    p_offset: 0,
    p_include_folders: false,
    p_include_deleted: false,
    p_order_by: 'updated_at_desc',
  });
  if (error) throw new Error(error.message);
  return parseFileInventoryRows(data);
}

function parseRepresentation(value: unknown): FileFamilyRepresentation | null {
  if (!isRecord(value)) return null;
  if (typeof value.key !== 'string' || typeof value.label !== 'string') return null;
  return {
    key: value.key,
    label: value.label,
    category: typeof value.category === 'string' ? value.category : 'other',
    count: typeof value.count === 'number' ? value.count : 0,
    promotable: value.promotable === true,
    fetchTool: typeof value.fetch_tool === 'string' ? value.fetch_tool : 'context',
  };
}

export function parseFileResourceFamily(value: unknown): FileResourceFamily {
  if (!isRecord(value) || value.resource_type !== 'file') {
    throw new Error('The file-family service returned an invalid resource envelope.');
  }
  const schemaVersion = typeof value.schema_version === 'number' ? value.schema_version : 1;
  if (schemaVersion < 1 || schemaVersion > 2) {
    throw new Error(`Unsupported file-family schema version ${schemaVersion}.`);
  }
  const counts = isRecord(value.counts)
    ? Object.fromEntries(
        Object.entries(value.counts).filter(
          (entry): entry is [string, number] => typeof entry[1] === 'number',
        ),
      )
    : {};
  return {
    schemaVersion,
    requestedFileId: typeof value.requested_file_id === 'string' ? value.requested_file_id : '',
    rootFileId: typeof value.root_file_id === 'string' ? value.root_file_id : null,
    files: Array.isArray(value.files) ? value.files.filter(isRecord) : [],
    processedDocuments: Array.isArray(value.processed_documents)
      ? value.processed_documents.filter(isRecord)
      : [],
    representations: Array.isArray(value.representations)
      ? value.representations
          .map(parseRepresentation)
          .filter((item): item is FileFamilyRepresentation => item !== null)
      : [],
    capabilities: Array.isArray(value.capabilities)
      ? value.capabilities.filter((item): item is string => typeof item === 'string')
      : [],
    counts,
  };
}

export async function fetchFileResourceFamily(fileId: string): Promise<FileResourceFamily> {
  const { data, error } = await getSupabase().rpc('get_file_resource_family', {
    p_file_id: fileId,
  });
  if (error) throw new Error(error.message);
  return parseFileResourceFamily(data);
}

interface AssociationRow {
  direction?: unknown;
  other_type?: unknown;
  other_id?: unknown;
}

export function parseAttachedFileIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const row = candidate as AssociationRow;
    if (
      row.direction === 'incoming' &&
      row.other_type === 'file' &&
      typeof row.other_id === 'string' &&
      UUID_PATTERN.test(row.other_id)
    ) {
      ids.add(row.other_id);
    }
  }
  return ids;
}

export async function fetchAttachedFileIds(conversationId: string): Promise<Set<string>> {
  const { data, error } = await getSupabase().rpc('assoc_for_entity', {
    p_type: 'conversation',
    p_id: conversationId,
  });
  if (error) throw new Error(error.message);
  return parseAttachedFileIds(data);
}

async function resolveConversationOrganizationId(conversationId: string): Promise<string> {
  const { data, error } = await chatDb()
    .from('conversation')
    .select('organization_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const organizationId = isRecord(data) ? text(data, 'organization_id') : null;
  if (organizationId) return organizationId;

  const personal = await getSupabase().rpc('current_personal_org_id');
  if (personal.error) throw new Error(personal.error.message);
  if (typeof personal.data !== 'string' || !UUID_PATTERN.test(personal.data)) {
    throw new Error('No organization is available for this conversation.');
  }
  return personal.data;
}

export async function attachFileToConversation(
  fileId: string,
  conversationId: string,
  label: string,
): Promise<void> {
  const existing = await fetchAttachedFileIds(conversationId);
  if (existing.has(fileId)) return;
  const organizationId = await resolveConversationOrganizationId(conversationId);
  const { error } = await getSupabase().rpc('assoc_add', {
    p_source_type: 'file',
    p_source_id: fileId,
    p_target_type: 'conversation',
    p_target_id: conversationId,
    p_org_id: organizationId,
    p_label: label,
    p_metadata: { file_id: fileId },
  });
  if (error) throw new Error(error.message);
}

export async function detachFileFromConversation(
  fileId: string,
  conversationId: string,
): Promise<void> {
  const { error } = await getSupabase().rpc('assoc_remove', {
    p_source_type: 'file',
    p_source_id: fileId,
    p_target_type: 'conversation',
    p_target_id: conversationId,
    p_role: null,
  });
  if (error) throw new Error(error.message);
}

export async function fetchRecentExtensionCaptures(limit = 100): Promise<ScreenshotRow[]> {
  return fetchRecentScreenshots(limit);
}
