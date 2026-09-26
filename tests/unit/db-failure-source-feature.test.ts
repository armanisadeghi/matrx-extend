/**
 * Forcing test for `sourceFeatureForTable` (DD-092 / source_feature attribution).
 *
 * `client-unmapped` is the LOUD fallback: it means this client could not map
 * the failing table to a feature. Seeing it in the error dashboard means the
 * map in `db-failure.ts` needs a new entry — this test locks in one hit per
 * registered branch plus the fallback so a table silently landing in
 * `client-unmapped` is caught here first.
 */

import { sourceFeatureForTable } from '@/lib/supabase/db-failure';
import { describe, expect, it } from 'vitest';

describe('sourceFeatureForTable', () => {
  it('maps web-capture tables', () => {
    expect(sourceFeatureForTable('docproc.processed_documents')).toBe('web-capture');
    expect(sourceFeatureForTable('capture_handoff')).toBe('web-capture');
    expect(sourceFeatureForTable('media.capture_handoff')).toBe('web-capture');
    expect(sourceFeatureForTable('extend.wbx_highlight')).toBe('web-capture');
  });

  it('maps udt tables and rpcs', () => {
    expect(sourceFeatureForTable('workbench.udt_datasets')).toBe('udt');
    expect(sourceFeatureForTable('workbench.udt_dataset_fields')).toBe('udt');
    expect(sourceFeatureForTable('rpc:append_rows_to_user_table')).toBe('udt');
    expect(sourceFeatureForTable('rpc:create_user_table_with_fields')).toBe('udt');
  });

  it('maps agent_task to agents-other', () => {
    expect(sourceFeatureForTable('agent_task')).toBe('agents-other');
  });

  it('falls back to client-unmapped for anything unregistered', () => {
    expect(sourceFeatureForTable('some.unknown_table')).toBe('client-unmapped');
    expect(sourceFeatureForTable('')).toBe('client-unmapped');
  });
});
