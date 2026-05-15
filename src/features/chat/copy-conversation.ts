/**
 * Pure formatters that turn ChatMessages into copyable text. Used by the
 * per-message Copy menu (assistant bubble) and the chat-header
 * "Copy conversation" button. Kept in one file so both surfaces emit the
 * same shape — admins exporting full transcripts and users exporting
 * single messages produce diff-compatible output.
 */

import { stringifyJson } from '@/lib/clipboard/copy';
import type { ChatMessage, MessagePart, ToolPartCall } from '@/state/chat';

export interface MessageCopyOptions {
  /** Include `[Tool: name — status]` lines inline with the text. */
  includeToolCalls: boolean;
  /** Include `<args>` / `<result>` blocks under each tool. Requires includeToolCalls. */
  includeFullToolResults: boolean;
  /** Include `<thinking>...</thinking>` blocks for reasoning parts. */
  includeThinking: boolean;
}

export interface ConversationCopyOptions extends MessageCopyOptions {
  includeAssistantMessages: boolean;
  includeUserMessages: boolean;
  /** Emit a leading `<agent name="..." id="..." />` line. */
  includeAgentInfo: boolean;
  /** Emit a leading preamble describing the payload to an AI. */
  includeInstructionsForAi: boolean;
}

export interface AgentInfo {
  id: string;
  name: string;
}

const DEFAULT_AI_INSTRUCTIONS =
  'The following is a transcript of a conversation between a user and an ' +
  'AI assistant in the Matrx browser-agent harness. Messages are wrapped ' +
  'in <message role="user|assistant"> tags. Tool calls invoked by the ' +
  'assistant are wrapped in <tool name="..." status="..."> tags and may ' +
  'include <args> and <result> children when present. Reasoning the ' +
  'assistant produced before its reply is wrapped in <thinking>.';

export const DEFAULT_MESSAGE_COPY_OPTIONS: MessageCopyOptions = {
  includeToolCalls: false,
  includeFullToolResults: false,
  includeThinking: false,
};

export const DEFAULT_CONVERSATION_COPY_OPTIONS: ConversationCopyOptions = {
  includeAssistantMessages: true,
  includeUserMessages: true,
  includeAgentInfo: false,
  includeThinking: false,
  includeToolCalls: false,
  includeFullToolResults: false,
  includeInstructionsForAi: false,
};

function statusLabel(phase: ToolPartCall['phase']): string {
  if (phase === 'completed') return 'completed';
  if (phase === 'error') return 'error';
  return 'running';
}

/**
 * Render one tool call. When `withData` is false (the normal-user flavor)
 * the body is a single `<tool>` self-closing-ish line that names the tool
 * and reports success/error — no args, no result payload. With `withData`
 * the JSON inputs and outputs are inlined so an admin can audit the full
 * exchange.
 */
function formatToolCall(tool: ToolPartCall, withData: boolean): string {
  const status = statusLabel(tool.phase);
  if (!withData) {
    return `<tool name="${tool.toolName}" status="${status}" />`;
  }
  const lines: string[] = [];
  lines.push(`<tool name="${tool.toolName}" status="${status}">`);
  if (tool.args !== undefined) {
    lines.push('  <args>');
    lines.push(indent(stringifyJson(tool.args), 4));
    lines.push('  </args>');
  }
  if (tool.result !== undefined) {
    lines.push('  <result>');
    lines.push(indent(stringifyJson(tool.result), 4));
    lines.push('  </result>');
  }
  lines.push('</tool>');
  return lines.join('\n');
}

function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n');
}

/**
 * Walk an assistant message's parts in arrival order and emit a block of
 * text. Text parts pass through. Reasoning is emitted as
 * `<thinking>...</thinking>` when requested. Tool parts emit a `<tool>`
 * line — bare-named for users, with args/result for the everything view.
 */
export function formatAssistantBody(
  message: ChatMessage,
  opts: MessageCopyOptions,
): string {
  const parts = message.parts;
  if (!parts || parts.length === 0) {
    // DB-hydrated history path — parts aren't reconstructed, so all we
    // have is the concatenated content string.
    return message.content;
  }
  const out: string[] = [];
  for (const part of parts) {
    const rendered = renderPart(part, opts);
    if (rendered) out.push(rendered);
  }
  return out.join('\n\n');
}

function renderPart(part: MessagePart, opts: MessageCopyOptions): string {
  if (part.type === 'text') return part.content.trim();
  if (part.type === 'reasoning') {
    if (!opts.includeThinking || !part.content) return '';
    return `<thinking>\n${part.content.trim()}\n</thinking>`;
  }
  // tool
  if (!opts.includeToolCalls) return '';
  return formatToolCall(part.tool, opts.includeFullToolResults);
}

/**
 * Top-level: build the entire conversation transcript as one string. The
 * `<conversation>` wrapper makes it easy for an AI on the receiving end to
 * understand the shape without guessing.
 */
export function formatConversation(
  messages: ChatMessage[],
  opts: ConversationCopyOptions,
  agent: AgentInfo | null,
): string {
  const lines: string[] = [];
  if (opts.includeInstructionsForAi) {
    lines.push(DEFAULT_AI_INSTRUCTIONS);
    lines.push('');
  }
  lines.push('<conversation>');
  if (opts.includeAgentInfo && agent) {
    lines.push(`  <agent name="${escapeAttr(agent.name)}" id="${agent.id}" />`);
  }
  for (const m of messages) {
    if (m.role === 'user' && !opts.includeUserMessages) continue;
    if (m.role === 'assistant' && !opts.includeAssistantMessages) continue;

    const body =
      m.role === 'assistant'
        ? formatAssistantBody(m, opts)
        : m.content;
    if (!body.trim()) continue;

    lines.push('');
    lines.push(`<message role="${m.role}">`);
    lines.push(indent(body, 2));
    lines.push('</message>');
  }
  lines.push('');
  lines.push('</conversation>');
  return lines.join('\n');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
