/**
 * User-facing model presets for the Customize popover.
 *
 * The labels are intentionally descriptive ("Max Reasoning") rather than
 * provider-revealing ("Opus 4.7"). Users pick by intent; the server
 * resolves the UUID to whatever provider/endpoint is wired up. If a model
 * is replaced or upgraded behind the scenes, the user's choice keeps
 * working without a code change here — only the UUID needs to point at the
 * new row in `ai_model`.
 *
 * Admins get a full unfiltered list from Supabase via the Debug tab; this
 * curated subset is what end-users see.
 *
 * Order = most powerful → fastest. Display in this order; users tend to
 * scan top-down for "I want my best".
 */

export interface UserModelPreset {
  /** Stable display label — never reveals the underlying model. */
  label: string;
  /** Optional one-liner explaining when to use this. */
  hint: string;
  /** ai_model.id UUID. Sent verbatim as `config_overrides.model`. */
  id: string;
}

export const USER_MODEL_PRESETS: UserModelPreset[] = [
  {
    label: 'Max Reasoning',
    hint: 'Deepest analysis, hardest problems, longest reasoning.',
    id: '2b6c05fe-c3e9-42b0-897c-edf590295141',
  },
  {
    label: 'High Intelligence',
    hint: 'Top-tier analysis, hardest problems, long reasoning.',
    id: '5970727c-37fc-4a0f-88c6-04ea8ca09ec6',
  },
  {
    label: 'Strong Thinking',
    hint: 'Deep thinking, Heavy reasoning + great memory.',
    id: '56363cb1-0d87-40b7-8bdc-664901e9f1ef',
  },
  {
    label: 'Reasoning & Math',
    hint: 'Highly intelligent, ideal for math and logic problems.',
    id: '3fe99fab-882d-4a44-b4c2-5502c1d3fd49',
  },
  {
    label: 'Lightning Reasoning',
    hint: 'Very Quick thinking with extremely high accuracy.',
    id: '0a283352-3488-4646-acac-0072d68c15e0',
  },
  {
    label: 'Fast Reasoning',
    hint: 'Fast answers with high intelligence and accuracy.',
    id: '98690c27-a650-4c0f-85b1-2444099d6df3',
  },
  {
    label: 'Fast Intelligence',
    hint: 'Balanced quality + speed with large very context.',
    id: 'e2150d2f-7dd3-4fad-9d81-6e6ea41d4afd',
  },
  {
    label: 'Standard',
    hint: 'Fast and accurate for simple text tasks + large context.',
    id: 'bd68e0a8-0bf3-400f-85cd-f923736d8025',
  },
];

/** Quick reverse lookup — UUID → label. Used to render the chip's current state. */
export const USER_MODEL_LABEL_BY_ID: Record<string, string> = Object.fromEntries(
  USER_MODEL_PRESETS.map((p) => [p.id, p.label]),
);
