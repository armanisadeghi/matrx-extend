/**
 * Agenda — multi-surface scheduled agent runs.
 *
 * v0 surface: list of the user's tasks + a simple "New task" form. Run-now
 * triggers an immediate fire by setting next_due_at = now and waiting for
 * the SW scanner to pick it up; the notification is the user-facing handoff
 * back into chat (full programmatic execution is v1).
 *
 * Highlighted-task focus on mount: when the SW handles a notification click
 * it stashes `matrx.agenda.focus_task_id` in chrome.storage.session — we
 * read that here and scroll the matching row into view.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type AgendaTask,
  type AuthMode,
  type SurfaceTarget,
  type TriggerType,
  createTask,
  deleteTask,
  listMyTasks,
  updateTask,
} from '@/lib/agenda/queries';
import { isTaskRunning, runTask } from '@/lib/agenda/runner';
import { log } from '@/lib/debug/log';
import { useChatStream } from '@/hooks/use-chat-stream';
import {
  Calendar,
  Clock,
  Heart,
  Pause,
  Play,
  PlayCircle,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const FOCUS_KEY = 'matrx.agenda.focus_task_id';

export function AgendaView() {
  const [tasks, setTasks] = useState<AgendaTask[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const { send } = useChatStream();

  const refresh = useCallback(async () => {
    const list = await listMyTasks();
    setTasks(list);
  }, []);

  useEffect(() => {
    void refresh();
    void chrome.storage.session?.get([FOCUS_KEY]).then((r) => {
      const id = r[FOCUS_KEY];
      if (typeof id === 'string') {
        setFocusTaskId(id);
        void chrome.storage.session?.remove(FOCUS_KEY);
      }
    });
  }, [refresh]);

  // Auto-run focused task when its auth_mode is 'auto'. The SW notification
  // click flow lands the user here with focus_task_id set; for ask-mode
  // tasks we just highlight, for auto-mode we go.
  useEffect(() => {
    if (!focusTaskId || !tasks) return;
    const task = tasks.find((t) => t.id === focusTaskId);
    if (!task) return;
    if (task.auth_mode === 'auto' && task.enabled && !isTaskRunning(task.id)) {
      void runTask(task, send).then(() => void refresh());
    }
  }, [focusTaskId, tasks, send, refresh]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Calendar className="size-4" />
          Agenda
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {tasks?.length ?? '—'}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => setShowForm((s) => !s)}
        >
          <Plus className="size-3.5" />
          New task
        </Button>
      </div>

      {showForm && (
        <NewTaskForm
          onCancel={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            void refresh();
          }}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {tasks === null ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            No scheduled tasks yet. Click <strong>New task</strong> to add one.
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                highlighted={task.id === focusTaskId}
                onChanged={refresh}
                send={send}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  highlighted,
  onChanged,
  send,
}: {
  task: AgendaTask;
  highlighted: boolean;
  onChanged: () => Promise<void>;
  send: ReturnType<typeof useChatStream>['send'];
}) {
  const [working, setWorking] = useState<'run' | 'toggle' | 'delete' | null>(null);

  const runNow = async () => {
    setWorking('run');
    try {
      // Fires the task through the chat stream pipeline. Switches the
      // sidepanel to the chat tab so the user sees it run.
      await runTask(task, send);
      log.info('sys', `agenda: "${task.title}" running`);
    } finally {
      setWorking(null);
      await onChanged();
    }
  };

  const toggleEnabled = async () => {
    setWorking('toggle');
    try {
      await updateTask(task.id, { enabled: !task.enabled });
    } finally {
      setWorking(null);
      await onChanged();
    }
  };

  const remove = async () => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    setWorking('delete');
    try {
      await deleteTask(task.id);
    } finally {
      setWorking(null);
      await onChanged();
    }
  };

  const isHeartbeat = task.trigger_type === 'heartbeat';
  const Icon = isHeartbeat ? Heart : task.trigger_type === 'cron' ? Calendar : Clock;

  return (
    <li
      className={[
        'flex items-start gap-2 px-3 py-2.5 transition-colors',
        highlighted ? 'bg-amber-500/10' : '',
        task.enabled ? '' : 'opacity-50',
      ].join(' ')}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{task.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
          <span className="rounded bg-secondary/40 px-1.5 py-0.5">{task.trigger_type}</span>
          <span className="rounded bg-secondary/40 px-1.5 py-0.5">{task.auth_mode}</span>
          {task.surfaces.map((s) => (
            <span key={s} className="rounded bg-secondary/40 px-1.5 py-0.5">
              {s}
            </span>
          ))}
          {task.next_due_at && (
            <span title={task.next_due_at}>
              · next {formatRelativeTime(task.next_due_at)}
            </span>
          )}
        </div>
        {task.description && (
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {task.description}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          title="Run now"
          disabled={!!working}
          onClick={runNow}
        >
          {working === 'run' ? (
            <Zap className="size-3.5 animate-pulse" />
          ) : (
            <PlayCircle className="size-3.5" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          title={task.enabled ? 'Pause' : 'Resume'}
          disabled={!!working}
          onClick={toggleEnabled}
        >
          {task.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0 text-destructive"
          title="Delete"
          disabled={!!working}
          onClick={remove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

// ─── New task form ──────────────────────────────────────────────────────────

function NewTaskForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('one-shot');
  const [oneShotAt, setOneShotAt] = useState(() => {
    const d = new Date(Date.now() + 5 * 60_000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [intervalSec, setIntervalSec] = useState(3600);
  const [authMode, setAuthMode] = useState<AuthMode>('ask');
  const [surface, setSurface] = useState<SurfaceTarget>('any');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!title.trim() || !prompt.trim()) return;
    setSubmitting(true);
    try {
      const triggerConfig =
        triggerType === 'one-shot'
          ? { type: 'one-shot' as const, at: new Date(oneShotAt).toISOString() }
          : triggerType === 'interval'
            ? { type: 'interval' as const, every_seconds: intervalSec }
            : triggerType === 'heartbeat'
              ? { type: 'heartbeat' as const, every_seconds: intervalSec }
              : triggerType === 'context-match'
                ? { type: 'context-match' as const }
                : { type: 'cron' as const, expression: '0 9 * * *' };
      await createTask({
        title: title.trim(),
        prompt: prompt.trim(),
        trigger_type: triggerType,
        trigger_config: triggerConfig,
        auth_mode: authMode,
        surfaces: [surface],
      });
      onCreated();
    } catch (err) {
      log.error('sys', 'agenda: createTask failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 border-b border-border/50 bg-secondary/20 px-3 py-3">
      <div className="space-y-1">
        <Label htmlFor="agenda-title" className="text-xs">
          Title
        </Label>
        <Input
          id="agenda-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Daily Gmail triage"
          className="h-8 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="agenda-prompt" className="text-xs">
          Prompt
        </Label>
        <textarea
          id="agenda-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Open Gmail and summarize all unread email from today."
          rows={3}
          className="w-full resize-y rounded-md border-0 bg-background px-2 py-1.5 text-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Trigger</Label>
          <Select value={triggerType} onValueChange={(v) => setTriggerType(v as TriggerType)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="one-shot">One-shot</SelectItem>
              <SelectItem value="interval">Interval</SelectItem>
              <SelectItem value="heartbeat">Heartbeat</SelectItem>
              <SelectItem value="cron">Cron</SelectItem>
              <SelectItem value="context-match">On-match</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Auth</Label>
          <Select value={authMode} onValueChange={(v) => setAuthMode(v as AuthMode)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ask">Ask before running</SelectItem>
              <SelectItem value="auto">Run automatically</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {triggerType === 'one-shot' && (
        <div className="space-y-1">
          <Label htmlFor="agenda-at" className="text-xs">
            Run at
          </Label>
          <Input
            id="agenda-at"
            type="datetime-local"
            value={oneShotAt}
            onChange={(e) => setOneShotAt(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      )}
      {(triggerType === 'interval' || triggerType === 'heartbeat') && (
        <div className="space-y-1">
          <Label htmlFor="agenda-interval" className="text-xs">
            Every (seconds)
          </Label>
          <Input
            id="agenda-interval"
            type="number"
            min={60}
            value={intervalSec}
            onChange={(e) => setIntervalSec(parseInt(e.target.value, 10) || 60)}
            className="h-8 text-xs"
          />
        </div>
      )}
      <div className="space-y-1">
        <Label className="text-xs">Surface</Label>
        <Select value={surface} onValueChange={(v) => setSurface(v as SurfaceTarget)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any surface</SelectItem>
            <SelectItem value="chrome-extension-chat">Chrome extension</SelectItem>
            <SelectItem value="desktop">Desktop app</SelectItem>
            <SelectItem value="web">Web app</SelectItem>
            <SelectItem value="mobile">Mobile</SelectItem>
            <SelectItem value="sandbox">Sandbox</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={submitting || !title.trim() || !prompt.trim()}
          onClick={submit}
        >
          {submitting ? 'Creating…' : 'Create task'}
        </Button>
      </div>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const dueMs = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(dueMs);
  const sign = dueMs >= 0 ? 'in ' : '';
  const past = dueMs >= 0 ? '' : ' ago';
  const min = Math.round(abs / 60_000);
  if (min < 1) return dueMs >= 0 ? 'now' : 'just now';
  if (min < 60) return `${sign}${min}m${past}`;
  const hr = Math.round(abs / 3_600_000);
  if (hr < 24) return `${sign}${hr}h${past}`;
  const day = Math.round(abs / 86_400_000);
  return `${sign}${day}d${past}`;
}
