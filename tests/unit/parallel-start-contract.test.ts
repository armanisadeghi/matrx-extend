import { buildParallelStartContract } from '@/lib/tools/handlers/parallel-start-contract';
import { describe, expect, it } from 'vitest';

describe('parallel child conversation-start contract', () => {
  it('sends every field required by the canonical start gate', () => {
    expect(
      buildParallelStartContract(
        '39c38960-d30c-4840-b0c1-c9960de95582',
        '6c5a5d83-71d9-4404-ac41-c490c817adf2',
      ),
    ).toEqual({
      organization_id: '39c38960-d30c-4840-b0c1-c9960de95582',
      conversation_id: '6c5a5d83-71d9-4404-ac41-c490c817adf2',
      is_new: true,
      store: true,
    });
  });

  it('mints a distinct conversation id for each child when omitted', () => {
    const first = buildParallelStartContract('39c38960-d30c-484f-b652-034e697418df');
    const second = buildParallelStartContract('39c38960-d30c-484f-b652-034e697418df');

    expect(first.conversation_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first.conversation_id).not.toBe(second.conversation_id);
  });
});
