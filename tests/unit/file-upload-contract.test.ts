import { SYSTEM_AUTO_PATH_PREFIX, parseFileUploadResponse } from '@/lib/api/routes/files';
import { describe, expect, it } from 'vitest';

describe('file upload contract', () => {
  it('uses the canonical hidden system-files namespace', () => {
    expect(SYSTEM_AUTO_PATH_PREFIX).toBe('system-files/matrx-extend/');
  });

  it('parses the current aidream response without exposing storage locations', () => {
    expect(
      parseFileUploadResponse({
        file_id: '019f7916-d58e-72d1-a607-9661664692e1',
        file_path: 'system-files/matrx-extend/browser-agent/screenshots/example.png',
        version_number: 1,
        size_bytes: 42,
        checksum: 'abc',
        url: 'https://signed.example.test/file',
        is_new: true,
        cdn_url: null,
      }),
    ).toEqual(
      expect.objectContaining({
        size_bytes: 42,
        is_new: true,
      }),
    );
  });

  it('fails loudly on stale or incomplete wire shapes', () => {
    expect(() =>
      parseFileUploadResponse({
        file_id: '019f7916-d58e-72d1-a607-9661664692e1',
        file_path: 'example.png',
        version_number: 1,
        file_size: 42,
        checksum: null,
        url: null,
        is_new: true,
        cdn_url: null,
      }),
    ).toThrow('invalid size_bytes');
  });
});
