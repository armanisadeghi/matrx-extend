import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessD47Trace,
  cleanupD47Probe,
  discoveryTerminal,
  sanitizeD47Failure,
} from './showcase-d47-driver-evidence.mjs';

const origin = 'http://127.0.0.1:4179';
const oldPageContext = { unique_id: 'old-unique', frame_id: 'main' };
const expectedBodySha256 = 'a'.repeat(64);
const options = { origin, oldPageContext, expectedBodySha256 };
const trace = (terminal = 'context_destroyed', commitOrder = 5) => [
  {
    order: 1,
    kind: 'context_created',
    tab_id: 7,
    id: 9,
    unique_id: 'old-unique',
    frame_id: 'main',
  },
  terminal === 'context_destroyed'
    ? { order: 2, kind: 'context_destroyed', tab_id: 7, id: 9 }
    : { order: 2, kind: 'contexts_cleared', tab_id: 7 },
  {
    order: 3,
    kind: 'context_created',
    tab_id: 7,
    id: 10,
    unique_id: 'new-unique',
    frame_id: 'main',
  },
  {
    order: 4,
    kind: 'binding',
    tab_id: 7,
    context_id: 10,
    binding_name: '__matrx_capture_1',
    handshake: true,
  },
  {
    order: commitOrder,
    kind: 'frame_navigated',
    tab_id: 7,
    frame_id: 'main',
    current_fixture: true,
  },
  {
    order: 6,
    kind: 'binding',
    tab_id: 7,
    context_id: 10,
    binding_name: '__matrx_capture_1',
    target_packet: true,
    current_payload: true,
    old_payload: false,
    url: `${origin}/api/document-race`,
    method: 'GET',
    source: 'fetch',
    request_body_key: 'none',
    status: 200,
    body_sha256: expectedBodySha256,
    request_sequence: 1,
  },
];

test('seed discovery only ends after capture window reaches terminal UI', () => {
  assert.equal(discoveryTerminal({ discovering: true, responses: false, error: false }), false);
  assert.equal(discoveryTerminal({ discovering: false, responses: true, error: false }), true);
  assert.equal(discoveryTerminal({ discovering: false, responses: false, error: false }), false);
  assert.equal(discoveryTerminal({ discovering: false, responses: true, error: true }), false);
});

test('current request provenance accepts both Chrome event orderings and context teardown forms', () => {
  assert.equal(assessD47Trace(trace(), options).ok, true);
  assert.equal(assessD47Trace(trace('contexts_cleared', 7), options).ok, true);
  assert.equal(assessD47Trace(trace(), options).current_packet_before_commit, false);
  assert.equal(
    assessD47Trace(trace('context_destroyed', 7), options).current_packet_before_commit,
    true,
  );
});

test('trace refuses swapped request identity, old payload and absent positive control', () => {
  for (const [change, reason] of [
    [
      (events) => {
        events[5].method = 'POST';
      },
      'current_request_identity_mismatch',
    ],
    [
      (events) => {
        events[5].request_body_key = 'sha256:other';
      },
      'current_request_identity_mismatch',
    ],
    [
      (events) => {
        events[5].body_sha256 = 'b'.repeat(64);
      },
      'current_request_identity_mismatch',
    ],
    [
      (events) => {
        events[5].source = 'xhr';
      },
      'current_request_identity_mismatch',
    ],
    [
      (events) => {
        events[5].old_payload = true;
      },
      'old_binding_payload_observed',
    ],
    [
      (events) => {
        events.splice(3, 1);
      },
      'current_binding_handshake_missing',
    ],
    [
      (events) => {
        events.splice(1, 1);
      },
      'old_context_terminal_missing',
    ],
    [
      (events) => {
        events[5].context_id = 9;
      },
      'current_context_identity_missing',
    ],
  ]) {
    const events = trace();
    change(events);
    assert.equal(assessD47Trace(events, options).reason, reason);
  }
});

test('probe cleanup removes listener and detaches even after removal fails', async () => {
  const calls = [];
  const worker = {
    detach: async () => {
      calls.push('detach');
    },
  };
  assert.deepEqual(
    await cleanupD47Probe(worker, true, async () => {
      calls.push('remove');
      throw new Error('remove_failed');
    }),
    ['remove_failed'],
  );
  assert.deepEqual(calls, ['remove', 'detach']);
  calls.length = 0;
  assert.equal(
    await cleanupD47Probe(worker, false, async () => {
      calls.push('remove');
    }),
    null,
  );
  assert.deepEqual(calls, ['detach']);
});

test('failure receipt retains safe class and stage but strips raw error text', () => {
  assert.deepEqual(
    sanitizeD47Failure(
      new Error('seed_discovery_terminal_not_observed:{"password":"secret"}'),
      'capture_seed',
    ),
    { name: 'Error', stage: 'capture_seed', message_code: 'seed_discovery_terminal_not_observed' },
  );
  assert.equal(
    sanitizeD47Failure(new Error('https://host/?token=secret'), 'native').message_code,
    'unclassified_error',
  );
});
