import {
  parseAttachedFileIds,
  parseFileInventoryRows,
  parseFileResourceFamily,
} from '@/features/files/data';
import { describe, expect, it } from 'vitest';

const FILE_ID = '019f7916-d58e-72d1-a607-9661664692e1';
const SECOND_FILE_ID = '11111111-1111-4111-8111-111111111111';

describe('extension file inventory', () => {
  it('parses both unified and legacy file-tree rows while dropping folders', () => {
    expect(
      parseFileInventoryRows([
        {
          kind: 'file',
          id: FILE_ID,
          name: 'report.pdf',
          path: 'reports/report.pdf',
          mime_type: 'application/pdf',
          size_bytes: 42,
          visibility: 'personal',
          updated_at: '2026-07-23T00:00:00Z',
        },
        {
          kind: 'file',
          id: SECOND_FILE_ID,
          file_name: 'photo.png',
          file_path: 'photos/photo.png',
          file_size: 99,
          updated_at: '2026-07-22T00:00:00Z',
        },
        {
          kind: 'folder',
          id: '22222222-2222-4222-8222-222222222222',
          name: 'reports',
          path: 'reports',
          updated_at: '2026-07-21T00:00:00Z',
        },
      ]),
    ).toEqual([
      expect.objectContaining({ id: FILE_ID, name: 'report.pdf', sizeBytes: 42 }),
      expect.objectContaining({ id: SECOND_FILE_ID, name: 'photo.png', sizeBytes: 99 }),
    ]);
  });

  it('parses family schema v2 and rejects a future contract', () => {
    expect(
      parseFileResourceFamily({
        schema_version: 2,
        resource_type: 'file',
        requested_file_id: FILE_ID,
        root_file_id: FILE_ID,
        files: [
          {
            id: FILE_ID,
            parent_file_id: null,
            duplicate_of_file_id: null,
            canonical_processed_document_id: null,
            file_name: 'report.pdf',
            mime_type: 'application/pdf',
            size_bytes: 42,
            derivation_kind: null,
          },
        ],
        processed_documents: [],
        representations: [
          {
            key: 'clean',
            label: 'Clean text',
            category: 'text',
            count: 1,
            promotable: true,
            fetch_tool: 'document_content',
          },
        ],
        capabilities: ['document_content'],
        counts: { files: 1 },
      }),
    ).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        requestedFileId: FILE_ID,
        representations: [expect.objectContaining({ key: 'clean', fetchTool: 'document_content' })],
      }),
    );

    expect(() =>
      parseFileResourceFamily({
        schema_version: 3,
        resource_type: 'file',
      }),
    ).toThrow('Unsupported file-family schema version 3');
  });

  it('rejects missing or malformed required family fields instead of rendering an empty family', () => {
    expect(() =>
      parseFileResourceFamily({
        resource_type: 'file',
        requested_file_id: FILE_ID,
        root_file_id: FILE_ID,
        files: [],
        processed_documents: [],
        representations: [],
        capabilities: [],
        counts: {},
      }),
    ).toThrow('invalid schema_version');

    expect(() =>
      parseFileResourceFamily({
        schema_version: 2,
        resource_type: 'file',
        requested_file_id: FILE_ID,
        root_file_id: FILE_ID,
        files: [{ id: FILE_ID }],
        processed_documents: [],
        representations: [],
        capabilities: [],
        counts: {},
      }),
    ).toThrow('invalid files[0].file_name');
  });

  it('keeps only valid file IDs from the conversation-scoped attachment RPC', () => {
    expect(
      parseAttachedFileIds([
        { file_id: FILE_ID, label: 'Report' },
        { file_id: 'not-a-uuid' },
        { other_id: SECOND_FILE_ID },
      ]),
    ).toEqual(new Set([FILE_ID]));
  });
});
