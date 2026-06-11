/**
 * Renderer for the server-side `interaction_ask` tool — a multi-question
 * questionnaire (radio + toggle inputs at minimum) that the agent sends so
 * the user can answer several policy/preference questions in one go.
 *
 * Submission flow: this card collects the answers and posts them back as a
 * normal user chat message (formatted as natural text + a JSON code block
 * the next agent turn can parse). The server tool itself completes
 * immediately — there's no SSE channel waiting for answers, so the round
 * trip is the user's reply.
 *
 * Submitted state persists per `callId` in a small Zustand store so the form
 * doesn't reappear if the user scrolls away and back.
 */

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useChatStream } from '@/hooks/use-chat-stream';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/state/chat';
import { Check, MessageCircleQuestion } from 'lucide-react';
import { useState } from 'react';
import { create } from 'zustand';
import type { ToolTimelineEntry } from '../ToolTimelineRow';
import { CopyToolButton } from './CopyToolButton';

interface QuestionSpec {
  id: string;
  prompt: string;
  component_type?: string;
  options?: string[];
}

interface AskArgs {
  introduction?: string;
  questions: QuestionSpec[];
}

type AnswerValue = string | boolean | null;

interface SubmittedState {
  answers: Record<string, AnswerValue>;
  byCallId: Record<string, Record<string, AnswerValue>>;
  markSubmitted: (callId: string, answers: Record<string, AnswerValue>) => void;
}

const useInteractionAskStore = create<SubmittedState>((set) => ({
  answers: {},
  byCallId: {},
  markSubmitted: (callId, answers) =>
    set((s) => ({ byCallId: { ...s.byCallId, [callId]: answers } })),
}));

export function InteractionAskCard({
  entry,
}: { entry: ToolTimelineEntry; kind: 'server' | 'client' }) {
  const args = entry.args as AskArgs | undefined;
  const phase = entry.phase;
  const submittedAnswers = useInteractionAskStore((s) => s.byCallId[entry.callId]);
  const markSubmitted = useInteractionAskStore((s) => s.markSubmitted);

  // Local form state — only used while the questionnaire hasn't been submitted yet.
  const [draft, setDraft] = useState<Record<string, AnswerValue>>({});

  const { send } = useChatStream();
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const conversationId = useChatStore((s) => s.selectedConversationId);

  if (!args || !Array.isArray(args.questions) || args.questions.length === 0) {
    // Malformed payload — let the boundary fall back to the default row.
    return null;
  }

  const submit = () => {
    if (!selectedAgentId) return;
    const filled: Record<string, AnswerValue> = {};
    for (const q of args.questions) {
      filled[q.id] = draft[q.id] ?? defaultFor(q);
    }
    markSubmitted(entry.callId, filled);
    const text = formatAnswerMessage(args, filled);
    void send(text, {
      agentId: selectedAgentId,
      conversationId: conversationId ?? undefined,
    });
  };

  const isSubmitted = submittedAnswers != null;
  const allAnswered = args.questions.every((q) => isAnswered(q, draft[q.id]));

  return (
    <div className="my-1 rounded-lg border border-sky-300/60 bg-sky-50/70 p-3 text-sm shadow-sm dark:border-sky-700/60 dark:bg-sky-950/30">
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
              {isSubmitted ? 'Answered' : 'Questions for you'}
            </span>
            {isSubmitted && <Check className="size-3 text-emerald-600 dark:text-emerald-400" />}
            <span className="ml-auto text-[10px] text-muted-foreground">
              {args.questions.length} {args.questions.length === 1 ? 'question' : 'questions'}
            </span>
            <CopyToolButton
              data={{
                toolName: entry.toolName,
                args: entry.args,
                result: entry.output,
                message: entry.message,
                phase,
                startedAt: entry.startedAt,
                endedAt: entry.endedAt,
                callId: entry.callId,
              }}
            />
          </div>
          {args.introduction && (
            <p className="mt-1 whitespace-pre-wrap text-foreground">{args.introduction}</p>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {args.questions.map((q) => (
          <QuestionRow
            key={q.id}
            question={q}
            value={isSubmitted ? submittedAnswers[q.id] : draft[q.id]}
            disabled={isSubmitted}
            onChange={(v) => setDraft((d) => ({ ...d, [q.id]: v }))}
          />
        ))}
      </div>

      {!isSubmitted && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="mr-auto text-[11px] text-muted-foreground">
            {countAnswered(args, draft)} / {args.questions.length} answered
          </span>
          <Button
            type="button"
            size="sm"
            disabled={!allAnswered || !selectedAgentId}
            onClick={submit}
          >
            Send answers
          </Button>
        </div>
      )}
    </div>
  );
}

function QuestionRow({
  question,
  value,
  disabled,
  onChange,
}: {
  question: QuestionSpec;
  value: AnswerValue | undefined;
  disabled: boolean;
  onChange: (v: AnswerValue) => void;
}) {
  const componentType = (question.component_type ?? '').toLowerCase();

  if (componentType === 'toggle' || componentType === 'switch') {
    const checked = value === true;
    return (
      <div className="flex items-start gap-3 rounded-md border border-border/60 bg-background/60 p-2.5">
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={(v) => onChange(Boolean(v))}
        />
        <Label className="min-w-0 flex-1 cursor-pointer whitespace-pre-wrap text-[13px] font-normal leading-snug">
          {question.prompt}
        </Label>
      </div>
    );
  }

  if (
    componentType === 'radio' ||
    (Array.isArray(question.options) && question.options.length > 0)
  ) {
    const selected = typeof value === 'string' ? value : null;
    const options = question.options ?? [];
    return (
      <div className="rounded-md border border-border/60 bg-background/60 p-2.5">
        <div className="whitespace-pre-wrap text-[13px] font-medium leading-snug">
          {question.prompt}
        </div>
        <div className="mt-2 space-y-1">
          {options.map((opt) => (
            <label
              key={opt}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-muted/40',
                disabled && 'cursor-default opacity-80 hover:bg-transparent',
              )}
            >
              <input
                type="radio"
                name={`q-${question.id}`}
                checked={selected === opt}
                disabled={disabled}
                onChange={() => onChange(opt)}
                className="mt-1 size-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1 whitespace-pre-wrap">{opt}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  // Default: freeform textarea.
  const text = typeof value === 'string' ? value : '';
  return (
    <div className="rounded-md border border-border/60 bg-background/60 p-2.5">
      <Label className="text-[13px] font-medium leading-snug">{question.prompt}</Label>
      <Textarea
        value={text}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="mt-2 text-[13px]"
        placeholder="Your answer…"
      />
    </div>
  );
}

function isAnswered(q: QuestionSpec, v: AnswerValue | undefined): boolean {
  const componentType = (q.component_type ?? '').toLowerCase();
  if (componentType === 'toggle' || componentType === 'switch') {
    // A toggle is ALWAYS answered — an untouched switch is a valid "no"
    // (defaultFor materializes false at submit). Requiring typeof boolean
    // forced users to physically click every switch before Send unlocked.
    return true;
  }
  if (componentType === 'radio' || (Array.isArray(q.options) && q.options.length > 0)) {
    return typeof v === 'string' && v.length > 0;
  }
  return typeof v === 'string' && v.trim().length > 0;
}

function defaultFor(q: QuestionSpec): AnswerValue {
  const componentType = (q.component_type ?? '').toLowerCase();
  if (componentType === 'toggle' || componentType === 'switch') return false;
  return null;
}

function countAnswered(args: AskArgs, draft: Record<string, AnswerValue>): number {
  let n = 0;
  for (const q of args.questions) if (isAnswered(q, draft[q.id])) n++;
  return n;
}

function formatAnswerMessage(args: AskArgs, answers: Record<string, AnswerValue>): string {
  const lines: string[] = ['Here are my answers:', ''];
  for (const q of args.questions) {
    const v = answers[q.id];
    const display =
      typeof v === 'boolean'
        ? v
          ? 'Yes'
          : 'No'
        : v == null || v === ''
          ? '(no answer)'
          : String(v);
    lines.push(`- **${q.id}**: ${display}`);
  }
  lines.push('', '```json');
  lines.push(JSON.stringify(answers, null, 2));
  lines.push('```');
  return lines.join('\n');
}
