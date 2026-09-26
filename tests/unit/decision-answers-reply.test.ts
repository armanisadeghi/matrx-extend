/**
 * A decision reply is never an empty bubble in the extension.
 *
 * A decision agent's turn is one `decision_answers` part and no text. The
 * live stream only logged its typed `data` event and the history reader
 * skipped the part, so the reply rendered empty. Use case: All Green
 * Recycling's feedback inbox triaged by the Feedback triage agent from the
 * side panel.
 */
import { decisionAnswersText, decisionRenderBlock } from '@/lib/chat/decision-answers';
import { dbMessagesToChatMessages } from '@/lib/supabase/queries';
import { describe, expect, it } from 'vitest';

function part(defect: boolean, pTrue: number, surface: string) {
  return {
    type: 'decision_answers',
    __kind: 'decision_answers',
    model: 'jev-1.13.0',
    method: 'native',
    answers: {
      is_defect: { type: 'noul', answer: defect, probability: pTrue, confidence: 0.8 },
      owning_surface: {
        type: 'choice',
        answer: surface,
        probabilities: { frontend: 0.15, server: 0.25, [surface]: 0.6 },
        confidence: 0.6,
      },
    },
    unanswerable: { urgency: 'The report does not say when pickup was due.' },
  };
}

describe.each([
  [false, 0.29, 'data', '- is_defect: No (71%)'],
  [true, 0.93, 'frontend', '- is_defect: Yes (93%)'],
])('decision reply (defect=%s)', (defect, pTrue, surface, line) => {
  it('the live data event becomes a visible block with the verdict', () => {
    const block = decisionRenderBlock(part(defect, pTrue, surface), 7);
    expect(block?.type).toBe('markdown');
    expect(block?.content).toContain(line);
    expect(block?.content).toContain(`- owning_surface: ${surface} (60%)`);
    expect(block?.content).toContain('- urgency: not answered. The report does not say');
  });

  it('a reloaded decision reply keeps its verdict', () => {
    const { messages } = dbMessagesToChatMessages([
      {
        id: 'm1',
        conversation_id: 'c1',
        role: 'assistant',
        position: 1,
        status: 'complete',
        content: [part(defect, pTrue, surface)],
        created_at: '2026-09-26T08:00:00Z',
        metadata: {},
      } as never,
    ]);
    expect(messages[0]?.content).toContain(line);
  });
});

it('a non-decision value is not a guess', () => {
  expect(decisionAnswersText({ text: 'hello' })).toBeNull();
});
