import { isDeepStrictEqual } from 'node:util';
import type { DbToolRow } from './_tool-db-row-validation';

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Check the executing server, including its per-action validation verdict. */
export function serverContractIssues(db: DbToolRow, detail: unknown): string[] {
  if (!object(detail) || !object(detail.tool)) return ['invalid server tool detail'];
  const tool = detail.tool;
  const contract = tool.execution_contract;
  if (tool.name !== db.name || !object(contract)) return ['missing execution contract'];
  const issues: string[] = [];
  if (!isDeepStrictEqual(tool.parameters, db.parameters))
    issues.push('server registry differs from live DB parameters');
  if (contract.resolved_executor !== 'server')
    issues.push('canonical resolver does not select server');
  if (
    typeof contract.declared_executor !== 'string' ||
    !Array.isArray(contract.active_bindings) ||
    !contract.active_bindings.includes(contract.declared_executor)
  )
    issues.push('declared executor lacks active binding');
  if (db.name === 'records' && !isDeepStrictEqual(contract.declared_parameters, db.parameters))
    issues.push('DB action variants differ from canonical generated declaration');
  const validation = contract.validation;
  if (
    !object(validation) ||
    validation.fully_verified !== true ||
    !Array.isArray(validation.checked) ||
    !validation.checked.includes(db.name) ||
    !Array.isArray(validation.exempt) ||
    validation.exempt.length ||
    !Array.isArray(validation.unverified) ||
    validation.unverified.length
  )
    issues.push('server argument contract is not fully verified');
  if (object(validation) && Array.isArray(validation.findings)) {
    for (const finding of validation.findings) {
      if (object(finding) && finding.severity === 'error') issues.push(String(finding.message));
    }
  }
  const schema = contract.execution_schema;
  const variants = db.parameters.$variants;
  if (!object(schema)) issues.push('full execution schema is absent');
  else if (object(variants)) {
    const discriminator = schema.discriminator;
    const mapping = object(discriminator) ? discriminator.mapping : null;
    if (
      !object(mapping) ||
      !isDeepStrictEqual(Object.keys(mapping).sort(), Object.keys(variants).sort())
    )
      issues.push('full execution schema does not cover every DB action');
    if (
      !object(schema.$defs) ||
      !Array.isArray(schema.oneOf) ||
      schema.oneOf.length !== Object.keys(variants).length
    )
      issues.push('full execution variants are incomplete');
  }
  return issues;
}

export async function fetchServerToolContract(name: string): Promise<unknown> {
  const {
    AIDREAM_API_URL: base,
    AIDREAM_API_TOKEN: token,
    AIDREAM_ORGANIZATION_ID: organization,
  } = process.env;
  if (!base || !token || !organization)
    throw new Error(
      'Server contract verification requires AIDREAM_API_URL, AIDREAM_API_TOKEN and AIDREAM_ORGANIZATION_ID',
    );
  const response = await fetch(
    `${base.replace(/\/$/, '')}/tools/test/${encodeURIComponent(name)}`,
    {
      headers: { Authorization: `Bearer ${token}`, 'X-Organization-Id': organization },
    },
  );
  if (!response.ok) throw new Error(`Server contract read failed (${response.status})`);
  return response.json();
}
