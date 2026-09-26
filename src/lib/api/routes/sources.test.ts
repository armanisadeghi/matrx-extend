import { describe, expect, it } from 'vitest';
import { refusalFromResult } from './sources';

// The REAL envelope aidream's error handlers send (aidream
// aidream/api/tests/test_sources_routes.py, bridge_auth.py): code, message,
// user_message and remedy at the TOP level.
const envelope = (code: string, message: string, remedy: string) =>
  JSON.stringify({ error: code, code, message, user_message: message, remedy, request_id: 'r-1' });

describe('refusalFromResult reads the server’s own refusal', () => {
  it('source_kind_not_landable (422)', () => {
    const r = refusalFromResult({
      status: 422,
      error: envelope(
        'source_kind_not_landable',
        "A 'youtube_video' cannot be landed as a Source. Land its transcript instead.",
        'use_a_landable_source_kind',
      ),
    });
    expect(r).toMatchObject({
      code: 'source_kind_not_landable',
      remedy: 'use_a_landable_source_kind',
      retryable: false,
    });
    expect(r.message).toMatch(/^A 'youtube_video' cannot be landed as a Source/);
    expect(r.message).not.toMatch(/error 422/);
  });

  it('landing_invalid (422)', () => {
    const r = refusalFromResult({
      status: 422,
      error: envelope(
        'landing_invalid',
        'This capture could not be read: portions.0.ordinal must be at least 1. Nothing was saved.',
        'fix_the_capture_and_save_again',
      ),
    });
    expect(r.code).toBe('landing_invalid');
    expect(r.message).toContain('portions.0.ordinal');
    expect(r.remedy).toBe('fix_the_capture_and_save_again');
  });

  it('organization_membership_required (403)', () => {
    const r = refusalFromResult({
      status: 403,
      error: envelope(
        'organization_membership_required',
        'The calling service named an organization this person does not belong to, so nothing was done.',
        'Retry from the organization the person is working in.',
      ),
    });
    expect(r.code).toBe('organization_membership_required');
    expect(r.message).toMatch(/does not belong to/);
    expect(r.message).not.toMatch(/error 403/);
  });

  it('still accepts a bare HTTPException detail as a fallback', () => {
    const r = refusalFromResult({
      status: 409,
      error: JSON.stringify({
        detail: {
          code: 'person_mismatch',
          message: 'This capture names a different person',
          remedy: 'x',
        },
      }),
    });
    expect(r).toMatchObject({
      code: 'person_mismatch',
      message: 'This capture names a different person.',
    });
  });

  it('an unreachable server is retryable and kept', () => {
    expect(refusalFromResult({ status: 0, error: 'Failed to fetch' })).toMatchObject({
      code: 'server_unreachable',
      retryable: true,
    });
  });
});
