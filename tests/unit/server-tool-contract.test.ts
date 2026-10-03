import { describe, expect, it } from 'vitest';
import { serverContractIssues } from '../../scripts/_server-tool-contract';
import type { DbToolRow } from '../../scripts/_tool-db-row-validation';

const parameters = {
  action: { type: 'string', enum: ['read', 'write'] },
  args: { type: 'object' },
  $variants: { read: {}, write: { value: { type: 'object', required: true } } },
};
const db: DbToolRow = {
  id: 'records',
  name: 'records',
  parameters,
  description: null,
  tier: 'action',
  admin_only: false,
  is_active: true,
  category: 'records',
  source_kind: 'native',
};
function detail() {
  return {
    tool: {
      name: 'records',
      parameters: structuredClone(parameters),
      execution_contract: {
        resolved_executor: 'server',
        declared_executor: 'aidream',
        active_bindings: ['aidream', 'chrome-extension'],
        declared_parameters: structuredClone(parameters),
        validation: {
          fully_verified: true,
          checked: ['records'],
          exempt: [],
          unverified: [],
          findings: [],
        },
        execution_schema: {
          discriminator: { mapping: { read: '#/$defs/Read', write: '#/$defs/Write' } },
          $defs: { Read: {}, Write: {} },
          oneOf: [{ $ref: '#/$defs/Read' }, { $ref: '#/$defs/Write' }],
        },
      },
    },
  };
}

describe('server contract release proof', () => {
  it('accepts a measured server contract', () =>
    expect(serverContractIssues(db, detail())).toEqual([]));
  it.each([
    'routing',
    'binding',
    'exemption',
    'unverified',
    'variant',
    'runtime-schema',
    'db-cache',
  ])('fails closed for %s drift', (failure) => {
    const value = detail();
    const c = value.tool.execution_contract;
    if (failure === 'routing') c.resolved_executor = 'surface';
    if (failure === 'binding') c.active_bindings = ['chrome-extension'];
    if (failure === 'exemption') c.validation.checked = [];
    if (failure === 'unverified') c.validation.fully_verified = false;
    if (failure === 'variant') c.declared_parameters.$variants.write.value.required = false;
    if (failure === 'runtime-schema') c.execution_schema.oneOf.pop();
    if (failure === 'db-cache') value.tool.parameters.action.enum.pop();
    expect(serverContractIssues(db, value).length).toBeGreaterThan(0);
  });
  it('rejects an old server response with no execution proof', () =>
    expect(
      serverContractIssues(db, { tool: { name: 'records', parameters } }).length,
    ).toBeGreaterThan(0));
});
