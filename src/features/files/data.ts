import { getSupabase } from '@/lib/supabase/client';
import type { ScreenshotRow } from '@/lib/supabase/queries';
import { fetchRecentScreenshots } from '@/lib/supabase/queries';

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

export interface FileFamilyFile {
  id: string;
  parentFileId: string | null;
  duplicateOfFileId: string | null;
  canonicalProcessedDocumentId: string | null;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  derivationKind: string | null;
}

export interface FileFamilyProcessedDocument {
  id: string;
  sourceKind: string | null;
  sourceId: string | null;
  parentProcessedId: string | null;
  derivationKind: string | null;
  name: string | null;
  mimeType: string | null;
  totalPages: number | null;
  cleanReady: boolean;
}

export interface FileResourceFamily {
  schemaVersion: number;
  requestedFileId: string;
  rootFileId: string;
  files: FileFamilyFile[];
  processedDocuments: FileFamilyProcessedDocument[];
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

function requireString(row: Record<string, unknown>, key: string, context: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`The file-family service returned invalid ${context}.${key}.`);
  }
  return value;
}

function requireUuid(row: Record<string, unknown>, key: string, context: string): string {
  const value = requireString(row, key, context);
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`The file-family service returned invalid ${context}.${key}.`);
  }
  return value;
}

function nullableString(row: Record<string, unknown>, key: string, context: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error(`The file-family service returned invalid ${context}.${key}.`);
  }
  return value;
}

function nullableUuid(row: Record<string, unknown>, key: string, context: string): string | null {
  const value = nullableString(row, key, context);
  if (value !== null && !UUID_PATTERN.test(value)) {
    throw new Error(`The file-family service returned invalid ${context}.${key}.`);
  }
  return value;
}

function nullableNumber(row: Record<string, unknown>, key: string, context: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`The file-family service returned invalid ${context}.${key}.`);
  }
  return value;
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

function parseRepresentation(value: unknown, index: number): FileFamilyRepresentation {
  if (!isRecord(value)) {
    throw new Error(`The file-family service returned invalid representations[${index}].`);
  }
  const context = `representations[${index}]`;
  const count = value.count;
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    throw new Error(`The file-family service returned invalid ${context}.count.`);
  }
  if (typeof value.promotable !== 'boolean') {
    throw new Error(`The file-family service returned invalid ${context}.promotable.`);
  }
  return {
    key: requireString(value, 'key', context),
    label: requireString(value, 'label', context),
    category: requireString(value, 'category', context),
    count,
    promotable: value.promotable,
    fetchTool: requireString(value, 'fetch_tool', context),
  };
}

function parseFamilyFile(value: unknown, index: number): FileFamilyFile {
  if (!isRecord(value)) {
    throw new Error(`The file-family service returned invalid files[${index}].`);
  }
  const context = `files[${index}]`;
  return {
    id: requireUuid(value, 'id', context),
    parentFileId: nullableUuid(value, 'parent_file_id', context),
    duplicateOfFileId: nullableUuid(value, 'duplicate_of_file_id', context),
    canonicalProcessedDocumentId: nullableUuid(value, 'canonical_processed_document_id', context),
    name: requireString(value, 'file_name', context),
    mimeType: nullableString(value, 'mime_type', context),
    sizeBytes: nullableNumber(value, 'size_bytes', context),
    derivationKind: nullableString(value, 'derivation_kind', context),
  };
}

function parseProcessedDocument(value: unknown, index: number): FileFamilyProcessedDocument {
  if (!isRecord(value)) {
    throw new Error(`The file-family service returned invalid processed_documents[${index}].`);
  }
  const context = `processed_documents[${index}]`;
  if (typeof value.clean_ready !== 'boolean') {
    throw new Error(`The file-family service returned invalid ${context}.clean_ready.`);
  }
  return {
    id: requireUuid(value, 'id', context),
    sourceKind: nullableString(value, 'source_kind', context),
    sourceId: nullableString(value, 'source_id', context),
    parentProcessedId: nullableUuid(value, 'parent_processed_id', context),
    derivationKind: nullableString(value, 'derivation_kind', context),
    name: nullableString(value, 'name', context),
    mimeType: nullableString(value, 'mime_type', context),
    totalPages: nullableNumber(value, 'total_pages', context),
    cleanReady: value.clean_ready,
  };
}

export function parseFileResourceFamily(value: unknown): FileResourceFamily {
  if (!isRecord(value) || value.resource_type !== 'file') {
    throw new Error('The file-family service returned an invalid resource envelope.');
  }
  const schemaVersion = value.schema_version;
  if (!Number.isInteger(schemaVersion) || typeof schemaVersion !== 'number') {
    throw new Error('The file-family service returned an invalid schema_version.');
  }
  if (schemaVersion < 1 || schemaVersion > 2) {
    throw new Error(`Unsupported file-family schema version ${schemaVersion}.`);
  }
  if (
    !Array.isArray(value.files) ||
    !Array.isArray(value.processed_documents) ||
    !Array.isArray(value.representations) ||
    !Array.isArray(value.capabilities) ||
    !isRecord(value.counts)
  ) {
    throw new Error('The file-family service returned an incomplete resource envelope.');
  }
  const requestedFileId = requireUuid(value, 'requested_file_id', 'resource');
  const rootFileId = requireUuid(value, 'root_file_id', 'resource');
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(value.counts)) {
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      throw new Error(`The file-family service returned invalid counts.${key}.`);
    }
    counts[key] = count;
  }
  if (!value.capabilities.every((item) => typeof item === 'string')) {
    throw new Error('The file-family service returned invalid capabilities.');
  }
  return {
    schemaVersion,
    requestedFileId,
    rootFileId,
    files: value.files.map(parseFamilyFile),
    processedDocuments: value.processed_documents.map(parseProcessedDocument),
    representations: value.representations.map(parseRepresentation),
    capabilities: value.capabilities,
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

export function parseAttachedFileIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    if (typeof candidate.file_id === 'string' && UUID_PATTERN.test(candidate.file_id)) {
      ids.add(candidate.file_id);
    }
  }
  return ids;
}

export async function fetchAttachedFileIds(conversationId: string): Promise<Set<string>> {
  const { data, error } = await getSupabase().rpc('conversation_files', {
    p_conversation_id: conversationId,
  });
  if (error) throw new Error(error.message);
  return parseAttachedFileIds(data);
}

export async function attachFileToConversation(
  fileId: string,
  conversationId: string,
  label: string,
): Promise<void> {
  const existing = await fetchAttachedFileIds(conversationId);
  if (existing.has(fileId)) return;
  const { error } = await getSupabase().rpc('conversation_file_add', {
    p_conversation_id: conversationId,
    p_file_id: fileId,
    p_label: label,
  });
  if (error) throw new Error(error.message);
}

export async function detachFileFromConversation(
  fileId: string,
  conversationId: string,
): Promise<void> {
  const { error } = await getSupabase().rpc('conversation_file_remove', {
    p_conversation_id: conversationId,
    p_file_id: fileId,
  });
  if (error) throw new Error(error.message);
}

export async function fetchRecentExtensionCaptures(limit = 100): Promise<ScreenshotRow[]> {
  return fetchRecentScreenshots(limit);
}
