/**
 * Unit tests for guidance cloud-sync mappers (TASK-004).
 *
 * Covers the item <-> row round-trip for every GuidanceItem kind, ensuring
 * kind-specific fields survive the trip through the `data` jsonb and that
 * epoch-ms timestamps convert losslessly through ISO. Also checks that an
 * unknown/corrupt kind maps to null rather than throwing.
 */

import { itemToRowPayload, rowToItem } from '@/lib/guidance/cloud-sync';
import type { GuidanceItem } from '@/lib/guidance/types';
import type { WbxGuidanceRow } from '@/lib/supabase/queries';
import { describe, expect, it } from 'vitest';

/** Build the cloud row shape from a payload (mirrors what the DB returns). */
function payloadToRow(item: GuidanceItem): WbxGuidanceRow {
  const p = itemToRowPayload(item);
  return {
    id: p.id,
    domain: p.domain,
    kind: p.kind,
    caption: p.caption ?? null,
    origin_url: p.origin_url ?? null,
    data: p.data,
    created_at: p.created_at,
    updated_at: p.updated_at,
    is_deleted: false,
  };
}

const CREATED = Date.parse('2026-06-10T12:00:00.123Z');
const UPDATED = Date.parse('2026-06-10T12:30:45.678Z');

describe('guidance cloud-sync mappers', () => {
  it('round-trips a note', () => {
    const note: GuidanceItem = {
      id: 'gd_note_1',
      kind: 'note',
      domain: 'example.com',
      caption: 'a hint',
      origin_url: 'https://example.com/x',
      text: 'click the blue button first',
      created_at: CREATED,
      updated_at: UPDATED,
    };
    expect(rowToItem(payloadToRow(note))).toEqual(note);
  });

  it('round-trips a screenshot with annotations', () => {
    const shot: GuidanceItem = {
      id: 'gd_shot_1',
      kind: 'screenshot',
      domain: 'example.com',
      file_id: 'file-abc',
      url: 'https://cdn/x.jpg',
      width: 1280,
      height: 720,
      annotated_file_id: 'file-def',
      annotated_url: 'https://cdn/x-annotated.png',
      annotation_doc: { shapes: [1, 2, 3] },
      created_at: CREATED,
      updated_at: UPDATED,
    };
    expect(rowToItem(payloadToRow(shot))).toEqual(shot);
  });

  it('round-trips a gif', () => {
    const gif: GuidanceItem = {
      id: 'gd_gif_1',
      kind: 'gif',
      domain: 'sub.example.com',
      file_id: 'file-gif',
      url: null,
      duration_ms: 4200,
      frame_count: 84,
      created_at: CREATED,
      updated_at: UPDATED,
    };
    expect(rowToItem(payloadToRow(gif))).toEqual(gif);
  });

  it('round-trips a demo_ref', () => {
    const demo: GuidanceItem = {
      id: 'gd_demo_1',
      kind: 'demo_ref',
      domain: 'example.com',
      caption: 'login flow',
      demo_id: 'demo-xyz',
      name: 'Login flow',
      step_count: 5,
      parameter_names: ['username', 'password'],
      created_at: CREATED,
      updated_at: UPDATED,
    };
    expect(rowToItem(payloadToRow(demo))).toEqual(demo);
  });

  it('preserves millisecond precision through the ISO conversion', () => {
    const note: GuidanceItem = {
      id: 'gd_ms',
      kind: 'note',
      domain: 'example.com',
      text: 'x',
      created_at: CREATED,
      updated_at: UPDATED,
    };
    const back = rowToItem(payloadToRow(note));
    expect(back?.created_at).toBe(CREATED);
    expect(back?.updated_at).toBe(UPDATED);
  });

  it('returns null for an unknown kind', () => {
    const row: WbxGuidanceRow = {
      id: 'gd_bad',
      domain: 'example.com',
      kind: 'totally_unknown',
      caption: null,
      origin_url: null,
      data: {},
      created_at: new Date(CREATED).toISOString(),
      updated_at: new Date(UPDATED).toISOString(),
      is_deleted: false,
    };
    expect(rowToItem(row)).toBeNull();
  });
});
