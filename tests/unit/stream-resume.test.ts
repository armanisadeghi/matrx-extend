/**
 * Stall-recovery resume decision logic (src/lib/stream/resume.ts).
 *
 * The regression this guards against: `attemptResume` used to be a permanent
 * no-op scaffolded against a cursor-replay endpoint the backend never built
 * (`GET /ai/agent/runs/{request_id}/resume`), so every stall replayed the
 * whole turn (re-running tool side effects, double billing). It now calls the
 * SAME `/ai/conversations/{id}/resume` endpoint the STREAM_CONTINUE path
 * already uses successfully — these tests pin down the decision logic (when
 * do we even attempt it) and the orchestration around a caller-supplied
 * `resumeRun` function, without touching the network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attemptResume, decideResume, isResumeEnabled } from '../../src/lib/stream/resume';

describe('decideResume — pure decision, no network', () => {
  it('refuses without a conversationId', () => {
    expect(decideResume({ runId: 'r1', conversationId: null, requestId: 'req-1' })).toEqual({
      attempt: false,
      reason: 'no-conversation-id',
    });
  });

  it('refuses without a requestId', () => {
    expect(decideResume({ runId: 'r1', conversationId: 'conv-1', requestId: null })).toEqual({
      attempt: false,
      reason: 'no-request-id',
    });
  });

  it('refuses when both are missing', () => {
    // conversationId is checked first — order matters for a deterministic reason.
    expect(decideResume({ runId: 'r1', conversationId: null, requestId: null })).toEqual({
      attempt: false,
      reason: 'no-conversation-id',
    });
  });

  it('allows when both ids are present', () => {
    expect(decideResume({ runId: 'r1', conversationId: 'conv-1', requestId: 'req-1' })).toEqual({
      attempt: true,
      reason: 'ok',
    });
  });
});

describe('isResumeEnabled — defaults ON', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  it('is true when the flag was never set', async () => {
    expect(await isResumeEnabled()).toBe(true);
  });

  it('is true when explicitly enabled', async () => {
    await chrome.storage.local.set({ 'matrx.stream.resume.enabled': true });
    expect(await isResumeEnabled()).toBe(true);
  });

  it('is false only when explicitly disabled', async () => {
    await chrome.storage.local.set({ 'matrx.stream.resume.enabled': false });
    expect(await isResumeEnabled()).toBe(false);
  });
});

describe('attemptResume — orchestration around a caller-supplied resumeRun', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  it('never calls resumeRun when the decision says no', async () => {
    const resumeRun = vi.fn();
    const result = await attemptResume(
      { runId: 'r1', conversationId: null, requestId: 'req-1' },
      resumeRun,
    );
    expect(result).toEqual({ resumed: false, reason: 'no-conversation-id' });
    expect(resumeRun).not.toHaveBeenCalled();
  });

  it('never calls resumeRun when the flag is disabled', async () => {
    await chrome.storage.local.set({ 'matrx.stream.resume.enabled': false });
    const resumeRun = vi.fn();
    const result = await attemptResume(
      { runId: 'r1', conversationId: 'conv-1', requestId: 'req-1' },
      resumeRun,
    );
    expect(result).toEqual({ resumed: false, reason: 'resume-disabled' });
    expect(resumeRun).not.toHaveBeenCalled();
  });

  it('calls resumeRun with (conversationId, requestId) and reports success on a runId', async () => {
    const resumeRun = vi.fn().mockResolvedValue('run-2');
    const result = await attemptResume(
      { runId: 'run-1', conversationId: 'conv-1', requestId: 'req-1' },
      resumeRun,
    );
    expect(resumeRun).toHaveBeenCalledWith('conv-1', 'req-1');
    expect(result).toEqual({ resumed: true, reason: 'ok' });
  });

  it('reports failure when resumeRun declines (returns null)', async () => {
    // e.g. the conversation isn't selected anymore, or another instance
    // already claimed this user_request_id (claimResume in use-chat-stream).
    const resumeRun = vi.fn().mockResolvedValue(null);
    const result = await attemptResume(
      { runId: 'run-1', conversationId: 'conv-1', requestId: 'req-1' },
      resumeRun,
    );
    expect(result).toEqual({ resumed: false, reason: 'resume-run-declined' });
  });

  it('reports failure (not a throw) when resumeRun itself throws', async () => {
    const resumeRun = vi.fn().mockRejectedValue(new Error('STREAM_START failed'));
    const result = await attemptResume(
      { runId: 'run-1', conversationId: 'conv-1', requestId: 'req-1' },
      resumeRun,
    );
    expect(result).toEqual({ resumed: false, reason: 'resume-run-error' });
  });
});
