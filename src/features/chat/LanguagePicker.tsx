/**
 * LanguagePicker — voice-loop language picker for the chat header.
 *
 * Six-language set per TASK-002 spec: en / es / fr / fa / zh / ru. Bound to
 * `useVoicePrefsStore.language`, persisted via chrome.storage.local through
 * the existing zustand store, so picks survive sidepanel restarts and SW
 * tear-downs.
 *
 * The selected language is consumed by:
 *   - `useCartesiaSpeaker.speak()` (TTS for agent message bubbles)
 *   - the on-device translation step that will run before TTS in TASK-002d
 *
 * Native-name labels (e.g. فارسی, 中文) are shown in addition to the English
 * name so users can recognize their own language at a glance. No flag emojis
 * — the repo CLAUDE.md prohibits emojis in user-visible UI.
 */

import { Check, Languages } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useVoicePrefsStore } from '@/state/voice-prefs';

interface LanguageOption {
  code: string;
  englishName: string;
  nativeName: string;
}

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en', englishName: 'English', nativeName: 'English' },
  { code: 'es', englishName: 'Spanish', nativeName: 'Español' },
  { code: 'fr', englishName: 'French', nativeName: 'Français' },
  { code: 'fa', englishName: 'Persian', nativeName: 'فارسی' },
  { code: 'zh', englishName: 'Chinese', nativeName: '中文' },
  { code: 'ru', englishName: 'Russian', nativeName: 'Русский' },
];

export function LanguagePicker() {
  const language = useVoicePrefsStore((s) => s.language);
  const setLanguage = useVoicePrefsStore((s) => s.setLanguage);
  const [open, setOpen] = useState(false);

  const selected =
    LANGUAGE_OPTIONS.find((o) => o.code === language) ?? LANGUAGE_OPTIONS[0]!;

  const onPick = (code: string) => {
    setLanguage(code);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          title={`Voice language: ${selected.englishName}`}
          aria-label={`Voice language, currently ${selected.englishName}`}
        >
          <Languages className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="end">
        <div className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Voice language
        </div>
        {LANGUAGE_OPTIONS.map((opt) => {
          const isSelected = opt.code === language;
          return (
            <button
              key={opt.code}
              type="button"
              onClick={() => onPick(opt.code)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-accent',
                isSelected && 'bg-accent',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm">{opt.nativeName}</div>
                {opt.nativeName !== opt.englishName && (
                  <div className="text-[11px] text-muted-foreground">
                    {opt.englishName}
                  </div>
                )}
              </div>
              {isSelected && (
                <Check className="size-3.5 shrink-0 text-primary" />
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
