/**
 * Header button: copy the whole conversation. Opens a popover with a
 * checkbox per section (user / assistant / tools / thinking / etc.) so
 * the user picks what goes in the export, then hits Copy. The set of
 * options is identical for users and admins — admins don't get extra
 * data here (per-message has the admin-only "everything" flavor for
 * single rows). The XML-ish format is parser-friendly for pasting into
 * another AI chat.
 */

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { copyToClipboard } from '@/lib/clipboard/copy';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/state/chat';
import { Check, ClipboardCopy, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  type AgentInfo,
  type ConversationCopyOptions,
  DEFAULT_CONVERSATION_COPY_OPTIONS,
  formatConversation,
} from './copy-conversation';

interface CopyConversationButtonProps {
  getMessages: () => ChatMessage[];
  getAgent: () => AgentInfo | null;
  disabled?: boolean;
}

interface OptionDef {
  key: keyof ConversationCopyOptions;
  label: string;
  description?: string;
  /** When true, the checkbox is disabled if the gate option is off. */
  requires?: keyof ConversationCopyOptions;
}

const OPTIONS: OptionDef[] = [
  {
    key: 'includeUserMessages',
    label: 'Include all user messages',
  },
  {
    key: 'includeAssistantMessages',
    label: 'Include all assistant messages',
  },
  {
    key: 'includeAgentInfo',
    label: 'Include agent info',
    description: 'Name and ID of the agent the user was chatting with.',
  },
  {
    key: 'includeThinking',
    label: 'Include thinking',
    description: 'Reasoning the assistant produced before its reply.',
    requires: 'includeAssistantMessages',
  },
  {
    key: 'includeToolCalls',
    label: 'Include tool calls',
    description: 'Names and status (completed / error) of tools the agent invoked.',
    requires: 'includeAssistantMessages',
  },
  {
    key: 'includeFullToolResults',
    label: 'Include full tool results',
    description: 'Arguments passed and the full result payload for each tool.',
    requires: 'includeToolCalls',
  },
  {
    key: 'includeInstructionsForAi',
    label: 'Include instructions for AI',
    description: 'Leading preamble that explains the format to a receiving AI.',
  },
];

export function CopyConversationButton({
  getMessages,
  getAgent,
  disabled,
}: CopyConversationButtonProps) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConversationCopyOptions>(
    DEFAULT_CONVERSATION_COPY_OPTIONS,
  );
  const [copied, setCopied] = useState(false);

  const previewLength = useMemo(() => {
    if (!open) return 0;
    return formatConversation(getMessages(), opts, getAgent()).length;
    // We intentionally recompute on every render while open — the popover
    // is small and the cost of re-stringifying is negligible at chat
    // sizes. Recomputing keeps the byte-count chip honest as toggles flip.
  }, [open, opts, getMessages, getAgent]);

  const handleCopy = async () => {
    const content = formatConversation(getMessages(), opts, getAgent());
    const ok = await copyToClipboard(content);
    if (ok) {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 900);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          title="Copy entire conversation"
          disabled={disabled}
        >
          <ClipboardCopy className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        <div className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Copy conversation
        </div>
        <div className="space-y-0.5">
          {OPTIONS.map((opt) => {
            const gated = opt.requires ? !opts[opt.requires] : false;
            const checked = Boolean(opts[opt.key]);
            return (
              <label
                key={opt.key}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                  gated && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
                  checked={checked && !gated}
                  disabled={gated}
                  onChange={(e) =>
                    setOpts((prev) => ({ ...prev, [opt.key]: e.target.checked }))
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="leading-tight">{opt.label}</div>
                  {opt.description && (
                    <div className="text-[11px] leading-snug text-muted-foreground">
                      {opt.description}
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
          <span className="px-1 text-[10px] text-muted-foreground">
            ~{previewLength.toLocaleString()} chars
          </span>
          <Button
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <>
                <Check className="size-3.5" /> Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" /> Copy
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
