/**
 * `google_email_send` — the Gmail boundary, browser half.
 *
 * The contract worth guarding here is almost entirely NEGATIVE: this tool must
 * never acquire a way to send without a human pressing Send on the review card.
 * So the tests pin the shape of the boundary itself:
 *
 *   1. the handler SENDS NOTHING — it raises a card and reports what came back;
 *   2. declining is a normal outcome, not an error, and never reads as sent;
 *   3. `confirmed` without a receipt is reported as a FAILURE, because a send we
 *      cannot evidence is the one lie this tool must not tell;
 *   4. no connected mailbox is a refusal the user can act on, raised BEFORE any
 *      card and without a request;
 *   5. greps, because each of these could be re-added later in code that passes
 *      tsc and biome: no consent argument in the tool schema, no send call in
 *      the handler, and `user_confirmed` written only as a constant at the one
 *      route the Send button reaches.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { google_email_send } from '@/lib/tools/handlers/google-email-send';
import type { AskUserResponse, PendingAskUserRequest, ToolContext } from '@/lib/tools/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let connection: {
  connectionId: string;
  accountEmail: string | null;
  accountName: string | null;
} | null = { connectionId: 'conn-1', accountEmail: 'me@example.com', accountName: 'Me' };

vi.mock('@/lib/google/connection', () => ({
  GMAIL_SEND_SCOPE: 'https://www.googleapis.com/auth/gmail.send',
  GOOGLE_WORKSPACE_SETTINGS_URL: 'https://aimatrx.com/user-settings/integrations/google-workspace',
  resolveGmailSendConnection: async () => connection,
}));

/** Every card the handler raised, and the answer we hand back to it. */
const raised: PendingAskUserRequest[] = [];
let reply: AskUserResponse | 'timed_out' = { callId: 'call-1', cancelled: true };

vi.mock('@/lib/tools/handlers/user', () => ({
  awaitUserResponse: async (request: PendingAskUserRequest) => {
    raised.push(request);
    return reply;
  },
}));

function ctx(): ToolContext {
  return {
    conversationId: 'conv-1',
    runId: 'run-1',
    callId: 'call-1',
    agentName: 'tester',
    permissionMode: 'act',
    assignedTabId: null,
  };
}

const ARGS = {
  to: 'someone@example.com',
  cc: [' cc@example.com ', '  '],
  subject: 'Following up',
  body: 'Hi there.',
};

async function run(args: Record<string, unknown> = ARGS) {
  const parsed = google_email_send.argsSchema.parse(args);
  return (await google_email_send.run(parsed, ctx())) as unknown as Record<string, unknown>;
}

beforeEach(() => {
  raised.length = 0;
  connection = { connectionId: 'conn-1', accountEmail: 'me@example.com', accountName: 'Me' };
  reply = { callId: 'call-1', cancelled: true };
});

describe('the handler proposes; it never sends', () => {
  it('raises an email_review card carrying the exact proposal', async () => {
    await run();
    expect(raised).toHaveLength(1);
    const card = raised[0]!;
    expect(card.kind).toBe('email_review');
    expect(card.conversationId).toBe('conv-1');
    expect(card.email).toMatchObject({
      connectionId: 'conn-1',
      fromEmail: 'me@example.com',
      to: 'someone@example.com',
      cc: ['cc@example.com'], // blank entries dropped, addresses trimmed
      subject: 'Following up',
      body: 'Hi there.',
    });
  });

  it('is ask-user tier — the review card IS the consent, not a second prompt', () => {
    expect(google_email_send.tier).toBe('ask-user');
    // A dynamic tier would mean some argument combination could route around
    // the card. There must not be one.
    expect(google_email_send.tierFor).toBeUndefined();
  });

  it('refuses before raising anything when no mailbox is connected', async () => {
    connection = null;
    const result = await run();
    expect(raised).toHaveLength(0);
    expect(result.sent).toBe(false);
    expect(String(result.error)).toContain('Google Workspace');
  });
});

describe('every outcome is reported honestly', () => {
  it('reports a decline as a normal, non-error outcome', async () => {
    reply = { callId: 'call-1', confirmed: false };
    expect(await run()).toEqual({ sent: false, declined: true });
  });

  it('reports a dismissal as cancelled, not as a decline or a send', async () => {
    reply = { callId: 'call-1', cancelled: true };
    expect(await run()).toEqual({ sent: false, cancelled: true });
  });

  it('reports an expiry as cancelled — a card nobody answered sent nothing', async () => {
    reply = 'timed_out';
    expect(await run()).toEqual({ sent: false, cancelled: true });
  });

  it('reports a confirm with no receipt as a failure, never as sent', async () => {
    reply = { callId: 'call-1', confirmed: true };
    const result = await run();
    expect(result.sent).toBe(false);
    expect(String(result.error)).toContain('Nothing was sent');
  });

  it('echoes what the USER sent, not what the agent proposed', async () => {
    reply = {
      callId: 'call-1',
      confirmed: true,
      sent_email: {
        message_id: 'msg-9',
        to: 'edited@example.com',
        cc: [],
        subject: 'Following up (edited)',
        edited: true,
      },
    };
    expect(await run()).toEqual({
      sent: true,
      message_id: 'msg-9',
      to: 'edited@example.com',
      cc: [],
      subject: 'Following up (edited)',
      edited: true,
      from_email: 'me@example.com',
    });
  });
});

describe('the agent has no vocabulary for consent', () => {
  const schemaKeys = Object.keys(
    (google_email_send.argsSchema as unknown as { shape: Record<string, unknown> }).shape,
  );

  it('accepts only the four fields the user reviews', () => {
    expect(schemaKeys.sort()).toEqual(['body', 'cc', 'subject', 'to']);
  });

  it('rejects any extra argument outright', () => {
    // A confirmation flag must not merely be ignored — it must fail to parse,
    // so a model that invents one gets an error instead of a silent send.
    const parsed = google_email_send.argsSchema.parse({
      ...ARGS,
      user_confirmed: true,
      send_immediately: true,
    }) as Record<string, unknown>;
    expect(parsed.user_confirmed).toBeUndefined();
    expect(parsed.send_immediately).toBeUndefined();
  });
});

describe('there is exactly one door, and a human opens it', () => {
  /** Comments explain the rule; these greps must only see the CODE. */
  const codeOnly = (rel: string) =>
    readFileSync(join(process.cwd(), rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const handler = codeOnly('src/lib/tools/handlers/google-email-send.ts');
  const route = codeOnly('src/lib/api/routes/google-workspace.ts');
  const card = codeOnly('src/features/chat/GmailReviewCard.tsx');

  it('never calls the send route from the handler', () => {
    expect(handler).not.toContain('sendReviewedGmail');
    expect(handler).not.toContain('user_confirmed');
  });

  it('writes user_confirmed exactly once, as a literal, in the route module', () => {
    const occurrences = route.match(/user_confirmed/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(route).toContain('user_confirmed: true,');
    expect(card).not.toContain('user_confirmed');
  });

  it('sends the fields on screen, not the agent\u2019s draft', () => {
    // `draft` is the proposal; only `connectionId` may be read from it.
    expect(card).toContain('connectionId: draft.connectionId');
    for (const field of ['to: draft.to,', 'subject: draft.subject,', 'body: draft.body,']) {
      expect(card).not.toContain(field);
    }
  });

  it('offers no remembered consent — approval covers one message', () => {
    for (const forbidden of ['always', 'remember', 'trustDomain', 'autoSend']) {
      expect(card.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
