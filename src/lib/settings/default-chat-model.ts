/**
 * The person's default AI model for everyday chat — the SAME setting the web
 * app uses (`agents.model_prefs.chat_default_model`, Settings → first screen:
 * "Default AI model for basic work").
 *
 * Applied exactly where the web applies it: to the general chat door
 * (`extend.browser_chat`) when the person has not picked a model in the
 * extension's own model menu. An agent someone built keeps the model its
 * builder chose. No choice → no override → the agent's own model answers.
 */

import { DEFAULT_CHAT_MANDATE_KEY } from '@/lib/mandates';
import { resolvePlatformKnobString } from './platform-knobs';

export const CHAT_DEFAULT_MODEL_KNOB = 'agents.model_prefs.chat_default_model';

/** The model to send for this run, or null to leave the agent's own model. */
export async function defaultChatModelFor(
  mandateKey: string | null | undefined,
): Promise<string | null> {
  if (mandateKey !== DEFAULT_CHAT_MANDATE_KEY) return null;
  return resolvePlatformKnobString(CHAT_DEFAULT_MODEL_KNOB);
}
