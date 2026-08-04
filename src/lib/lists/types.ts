/**
 * Plan + Tasks + UserTodos — shared types.
 *
 * Three related but distinct concepts:
 *  - Plan       — what we agreed to do (one per conversation)
 *  - Task       — live work item the AGENT owns (N per conversation)
 *  - UserTodo   — task the AGENT assigns to the USER (N per conversation)
 *
 * Tasks are persisted in shared `chat.agent_task`, where aidream's native
 * `tasks` tool also writes. Plans and user todos remain in extension-local
 * storage. The full UI surface lives in src/features/lists/.
 */

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'skipped';
export type PlanStatus = 'proposed' | 'approved' | 'rejected' | 'superseded';

export interface Plan {
  conversation_id: string;
  title: string;
  steps: string[];
  reasoning?: string;
  domains?: string[];
  estimated_minutes?: number;
  status: PlanStatus;
  created_at: number;
  updated_at: number;
}

export interface Task {
  id: string;
  conversation_id: string;
  title: string;
  status: TaskStatus;
  note?: string;
  order: number;
  created_by: 'agent' | 'user';
  created_at: number;
  updated_at: number;
}

export interface UserTodo {
  id: string;
  conversation_id: string;
  title: string;
  /** One-line "why is the agent asking me to do this?" */
  context?: string;
  /** Optional human-readable hint, e.g. "by Thursday". */
  due?: string;
  done: boolean;
  done_at?: number;
  created_at: number;
}

/** Aggregate counts used by the lists-hub tab + the chat header chip. */
export interface ConversationListsSummary {
  conversation_id: string;
  has_plan: boolean;
  plan_title?: string;
  plan_status?: PlanStatus;
  tasks_total: number;
  tasks_in_progress: number;
  tasks_done: number;
  user_todos_open: number;
  user_todos_done: number;
  last_activity: number;
}
