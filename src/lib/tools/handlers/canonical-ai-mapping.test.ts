/**
 * The canonical `ai` tool maps its public args onto each on-device leaf's own schema.
 * classify sent `categories` (leaf requires `labels`) and describe_image sent `prompt`
 * (leaf reads `question`), so every classify call failed the leaf's strict parse.
 */
import { describe, expect, it, vi } from 'vitest';
import { ai } from './canonical-mergers';
import { ai_classify, ai_describe_image } from './onbox-ai';

const ctx = {} as never;

describe('canonical ai -> on-device leaf args', () => {
  it("classify passes categories as the leaf's labels", async () => {
    const spy = vi.spyOn(ai_classify, 'run').mockResolvedValue({ ok: true } as never);
    const out = await ai.run(
      { action: 'classify', text: 'refund please', categories: ['billing', 'support'] } as never,
      ctx,
    );
    expect(out).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['billing', 'support'] }),
      ctx,
    );
    spy.mockRestore();
  });

  it("describe_image passes prompt as the leaf's question and refuses image_url alone", async () => {
    const spy = vi.spyOn(ai_describe_image, 'run').mockResolvedValue({ ok: true } as never);
    const b64 = 'A'.repeat(80);
    await ai.run(
      { action: 'describe_image', image_base64: b64, prompt: 'What brand is this?' } as never,
      ctx,
    );
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ image_base64: b64, question: 'What brand is this?' }),
      ctx,
    );
    const refused = await ai.run(
      { action: 'describe_image', image_url: 'https://x.test/a.png' } as never,
      ctx,
    );
    expect(refused).toMatchObject({ ok: false });
    spy.mockRestore();
  });
});
