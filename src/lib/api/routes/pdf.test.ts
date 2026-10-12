import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ STATUS_INVALID_BODY: -1 }));
vi.mock('@/lib/api/matrx-api', () => ({
  runOpAs: async (call: (api: unknown, o: unknown) => Promise<unknown>) => ({
    ok: true,
    data: await call({}, {}),
  }),
}));
vi.mock('@ai-matrx/api/files', () => ({ extractTextRemote: client.extract }));

import { extractPdfText } from './pdf';

/** What aidream's text-extraction door really answers: an NDJSON event stream. */
function ndjson(...events: unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

const COMPLETE = {
  event: 'data',
  data: {
    type: 'pdf_extract_complete',
    filename: 'lease.pdf',
    page_count: 2,
    total_pages: 9,
    page_start: 3,
    page_end: 4,
    ocr_pages: 0,
    total_chars: 42,
    text_content: 'page three text\npage four text',
    file_id: null,
  },
};

describe('read_pdf → aidream text extraction contract', () => {
  beforeEach(() => client.extract.mockReset());

  it('sends the file as a MediaRef and forwards the page range', async () => {
    client.extract.mockResolvedValue(ndjson(COMPLETE));
    await extractPdfText({ fileId: 'f-1', pageStart: 3, pageEnd: 4 });

    const [, { body }] = client.extract.mock.calls[0] as [
      unknown,
      { body: Record<string, unknown> },
    ];
    expect(body.media).toEqual({ file_id: 'f-1' });
    expect(body.page_start).toBe(3);
    expect(body.page_end).toBe(4);
  });

  it('reads the terminal pdf_extract_complete event out of the stream', async () => {
    client.extract.mockResolvedValue(
      ndjson(
        { event: 'data', data: { type: 'pdf_extract_started', total_pages: 9 } },
        { event: 'data', data: { type: 'pdf_page_extracted', page_number: 3, total_pages: 9 } },
        COMPLETE,
        { event: 'end', data: {} },
      ),
    );
    const r = await extractPdfText({ fileId: 'f-1', pageStart: 3, pageEnd: 4 });

    expect(r).toEqual({
      ok: true,
      data: {
        text: 'page three text\npage four text',
        page_count: 2,
        total_pages: 9,
        page_start: 3,
        page_end: 4,
        file_id: null,
      },
    });
  });

  it("surfaces the server's own error sentence from a stream error event", async () => {
    client.extract.mockResolvedValue(
      ndjson({
        event: 'error',
        data: {
          error_type: 'ValueError',
          message: 'x',
          user_message: 'page_start 12 is past the last page (9).',
        },
      }),
    );
    const r = await extractPdfText({ fileId: 'f-1', pageStart: 12 });
    expect(r).toMatchObject({ ok: false, error: 'page_start 12 is past the last page (9).' });
  });

  it('never reports success for a stream that ended without a result', async () => {
    client.extract.mockResolvedValue(ndjson({ event: 'end', data: {} }));
    const r = await extractPdfText({ fileId: 'f-1' });
    expect(r.ok).toBe(false);
  });
});
