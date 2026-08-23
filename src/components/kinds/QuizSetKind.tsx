/**
 * `quiz_set` — answerable in the panel, not a printed answer key.
 *
 * The registered `quiz_question` shape is (type, question, options[],
 * correct_answer, explanation). Options are rendered as choices and the
 * correct answer stays hidden until the user picks one — printing the answers
 * beside the questions would make the kind useless as a quiz.
 */

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KindComponentProps } from './types';

interface Question {
  question: string;
  options: string[];
  correct: string;
  explanation: string;
}

function readQuiz(value: unknown): { title: string; questions: Question[] } {
  if (typeof value !== 'object' || value === null) return { title: '', questions: [] };
  const root = value as Record<string, unknown>;
  const list = Array.isArray(root.questions) ? root.questions : [];

  const questions: Question[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const q = entry as Record<string, unknown>;
    const text = typeof q.question === 'string' ? q.question : '';
    if (!text) continue;
    questions.push({
      question: text,
      options: Array.isArray(q.options)
        ? q.options.filter((o): o is string => typeof o === 'string')
        : [],
      correct: typeof q.correct_answer === 'string' ? q.correct_answer : '',
      explanation: typeof q.explanation === 'string' ? q.explanation : '',
    });
  }

  return { title: typeof root.title === 'string' ? root.title : '', questions };
}

function QuestionRow({ question, index }: { question: Question; index: number }) {
  const [picked, setPicked] = useState<string | null>(null);
  const answered = picked !== null;

  return (
    <li className="px-3 py-2">
      <p className="text-[12px] font-medium">
        <span className="mr-1 tabular-nums text-muted-foreground">{index + 1}.</span>
        {question.question}
      </p>
      {question.options.length > 0 ? (
        <div className="mt-1.5 space-y-1">
          {question.options.map((option) => {
            const isCorrect = option === question.correct;
            const isPicked = option === picked;
            return (
              <button
                key={option}
                type="button"
                disabled={answered}
                onClick={() => setPicked(option)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded border px-2 py-1 text-left text-[11px] transition-colors',
                  !answered && 'border-border hover:bg-secondary/60',
                  answered && isCorrect && 'border-emerald-500/50 bg-emerald-500/10',
                  answered && isPicked && !isCorrect && 'border-destructive/50 bg-destructive/10',
                  answered && !isCorrect && !isPicked && 'border-border opacity-60',
                )}
              >
                {answered && isCorrect && (
                  <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
                {answered && isPicked && !isCorrect && (
                  <X className="h-3 w-3 shrink-0 text-destructive" />
                )}
                <span className="min-w-0 flex-1">{option}</span>
              </button>
            );
          })}
        </div>
      ) : (
        answered && (
          <p className="mt-1 text-[11px] text-muted-foreground">Answer: {question.correct}</p>
        )
      )}
      {answered && question.explanation && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {question.explanation}
        </p>
      )}
      {!answered && question.options.length === 0 && question.correct && (
        <button
          type="button"
          onClick={() => setPicked(question.correct)}
          className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          Show answer
        </button>
      )}
    </li>
  );
}

export function QuizSetKind({ value, complete }: KindComponentProps) {
  const { title, questions } = readQuiz(value);

  if (questions.length === 0) {
    return (
      <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-[12px] text-muted-foreground">
        {complete ? 'This quiz has no questions.' : 'Writing the quiz…'}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="truncate text-[12px] font-medium">{title || 'Quiz'}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {questions.length}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {questions.map((question, i) => (
          <QuestionRow key={`${question.question}-${i}`} question={question} index={i} />
        ))}
      </ul>
    </div>
  );
}
