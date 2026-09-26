import { beforeEach, describe, expect, it, vi } from 'vitest';

const knob = vi.fn<(key: string) => Promise<string | null>>();
vi.mock('@/lib/settings/platform-knobs', () => ({
  resolvePlatformKnobString: (key: string) => knob(key),
}));

import { DEFAULT_CHAT_MANDATE_KEY } from '@/lib/mandates';
import { CHAT_DEFAULT_MODEL_KNOB, defaultChatModelFor } from '@/lib/settings/default-chat-model';

describe('the account default model for everyday chat', () => {
  beforeEach(() => knob.mockReset());

  it('applies to the general chat door', async () => {
    knob.mockResolvedValue('model-the-person-chose');
    await expect(defaultChatModelFor(DEFAULT_CHAT_MANDATE_KEY)).resolves.toBe(
      'model-the-person-chose',
    );
    expect(knob).toHaveBeenCalledWith(CHAT_DEFAULT_MODEL_KNOB);
  });

  it('never rewrites the model of an agent someone built', async () => {
    knob.mockResolvedValue('model-the-person-chose');
    await expect(defaultChatModelFor('extend.structured_extractor')).resolves.toBeNull();
    await expect(defaultChatModelFor(null)).resolves.toBeNull();
    expect(knob).not.toHaveBeenCalled();
  });

  it('sends nothing when the person has no default, so the agent’s own model answers', async () => {
    knob.mockResolvedValue(null);
    await expect(defaultChatModelFor(DEFAULT_CHAT_MANDATE_KEY)).resolves.toBeNull();
  });
});
