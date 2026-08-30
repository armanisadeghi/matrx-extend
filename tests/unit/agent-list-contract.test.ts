import { describe, expect, it } from 'vitest';

import { DEFAULT_CHAT_MANDATE_KEY, DEFAULT_CHAT_MANDATE_REF } from '@/lib/mandates';
import { mandateExecutePath } from '@/lib/api/routes/ai';
import { AgxAgentSchema } from '@/lib/supabase/queries';

const LIVE_AGENT_ROW = {
  id: '1f365d07-cad3-4ef7-81fc-57a6c60767e7',
  agent_type: 'user',
  name: 'Test Agent',
  description: null,
  model_id: null,
  category: null,
  tags: null,
  is_active: true,
  is_archived: false,
  is_favorite: false,
  created_by: '8c10c4b1-0247-40ac-8d0f-c5c478bd23e0',
  organization_id: null,
  task_id: null,
  source_agent_id: null,
  created_at: '2026-08-17T00:00:00Z',
  updated_at: '2026-08-17T00:00:00Z',
  is_owner: true,
  access_level: 'owner',
  shared_by_email: null,
};

describe('agent list contract', () => {
  it('accepts the canonical agx_get_list_full row shape', () => {
    expect(AgxAgentSchema.parse(LIVE_AGENT_ROW).created_by).toBe(LIVE_AGENT_ROW.created_by);
  });

  it('does not require retired user_id or project_id fields', () => {
    const parsed = AgxAgentSchema.parse(LIVE_AGENT_ROW);
    expect('user_id' in parsed).toBe(false);
    expect('project_id' in parsed).toBe(false);
  });
});

describe('default chat Mandate route', () => {
  it('uses a UI-only reference and a server-resolved execution path', () => {
    expect(DEFAULT_CHAT_MANDATE_REF).toBe('mandate:extend.browser_chat');
    expect(mandateExecutePath(DEFAULT_CHAT_MANDATE_KEY)).toBe(
      '/v2/ai/mandates/extend.browser_chat',
    );
  });
});
