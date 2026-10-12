/**
 * A stand-in for the Supabase client the package's membership / account-choice reads run on
 * (`readMemberships`, `readAccountOrganizationChoices` from `@ai-matrx/auth/organizations`).
 * Only the network edge is faked: the three reads the load ladder makes.
 *
 *   rpc('mbr_for_user')                         → source.memberships()
 *   schema('iam').from('organizations') .in()   → source.organizations(ids)
 *   schema('users').from('user_preferences')    → source.account()  (the row, snake_case)
 */
type Answer = { data: unknown; error: { message: string } | null };

export interface FakeOrganizationsSource {
  memberships: () => Promise<Answer> | Answer;
  organizations: (ids: string[]) => Promise<Answer> | Answer;
  account: () => Promise<Answer> | Answer;
}

function chain(read: () => Promise<Answer> | Answer) {
  const builder: Record<string, unknown> = {};
  for (const name of ['order', 'range', 'select', 'eq', 'maybeSingle']) builder[name] = () => builder;
  builder.then = (resolve: (value: Answer) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve()
      .then(read)
      .then(resolve, reject);
  return builder;
}

export function fakeOrganizationsDb(source: FakeOrganizationsSource): unknown {
  return {
    rpc: (fn: string) => {
      if (fn !== 'mbr_for_user') throw new Error(`unexpected rpc ${fn}`);
      return chain(source.memberships);
    },
    schema: (name: string) => ({
      from: (table: string) => {
        if (name === 'iam' && table === 'organizations') {
          const builder: Record<string, unknown> = { select: () => builder };
          builder.in = (_column: string, ids: string[]) => chain(() => source.organizations(ids));
          return builder;
        }
        if (name === 'users' && table === 'user_preferences') return chain(source.account);
        throw new Error(`unexpected read ${name}.${table}`);
      },
      rpc: async () => ({ error: null }),
    }),
  };
}

/** The ladder's account-choice shape (camelCase, as the old resolver seam returned it) as the table row. */
export function accountRow(choice: { lastActiveOrganizationId?: unknown; startupOrganizationId?: unknown } | null) {
  return choice
    ? {
        last_active_organization_id: choice.lastActiveOrganizationId ?? null,
        startup_organization_id: choice.startupOrganizationId ?? null,
      }
    : null;
}

const farFuture = () => Date.now() + 3_600_000;
const b64u = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** An unsigned JWT naming `sub` — the package reads the person id from the token's claims. */
const tokenFor = (sub: string) =>
  `${b64u('{"alg":"none"}')}.${b64u(JSON.stringify({ sub, exp: 9_999_999_999 }))}.sig`;

/**
 * The OAuth client slice the organization store's session reads (`getSession`, `onChange`), signed in as
 * whoever `userId()` names (null = signed out). Stands in for `getOAuthClient()` from `@/lib/auth/flow`.
 */
export function fakeOAuthClient(userId: () => string | null | undefined | Promise<string | null | undefined>) {
  return {
    getSession: async () => {
      const id = await userId();
      return id ? { personId: id, email: null, accessToken: tokenFor(id), expiresAtMs: farFuture() } : null;
    },
    onChange: () => () => {},
  };
}
