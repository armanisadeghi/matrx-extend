/** Shapes returned by the private tool catalog read. A malformed response is
 * unverified, never an empty or matching catalog. */
export interface DbToolParameter {
  type?: string | string[];
  enum?: unknown[];
  required?: boolean | string[];
  [k: string]: unknown;
}

export interface DbToolRow {
  id: string;
  name: string;
  description: string | null;
  parameters: Record<string, unknown>;
  tier: string | null;
  admin_only: boolean | null;
  is_active: boolean | null;
  category: string | null;
  source_kind: string | null;
}

export interface DbSurfaceDefaultsRow {
  surface_name: string;
  always_include_tools: string[] | null;
  /** Bundle membership is verified separately through platform.associations. */
  always_include_bundles: string[] | null;
  never_include_tools: string[] | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function booleanOrNull(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean';
}

function stringArrayOrNull(value: unknown): value is string[] | null {
  return (
    value === null || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

export function isDbToolRow(value: unknown): value is DbToolRow {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !stringOrNull(value.description) ||
    !stringOrNull(value.tier) ||
    !stringOrNull(value.category) ||
    !stringOrNull(value.source_kind) ||
    !booleanOrNull(value.admin_only) ||
    !booleanOrNull(value.is_active) ||
    !isRecord(value.parameters)
  )
    return false;

  const parameters = value.parameters as Record<string, unknown>;
  return Object.entries(parameters).every(([name, param]) => {
    // Registry-level JSON Schema metadata describes the tool, not a field.
    if (name === '$envelope') return typeof param === 'string' && isRecord(parameters[param]);
    if (name === '$variants' || name === '$defs') return isRecord(param);
    if (name === '$schema') return typeof param === 'string';
    if (name.startsWith('$')) return false;
    if (!isRecord(param)) return false;
    if (
      param.type !== undefined &&
      typeof param.type !== 'string' &&
      !(Array.isArray(param.type) && param.type.every((item) => typeof item === 'string'))
    )
      return false;
    if (param.enum !== undefined && !Array.isArray(param.enum)) return false;
    // A parameter's presence uses boolean required; an object parameter's
    // nested JSON Schema uses an array naming its required child properties.
    if (
      param.required !== undefined &&
      typeof param.required !== 'boolean' &&
      !(Array.isArray(param.required) && param.required.every((item) => typeof item === 'string'))
    )
      return false;
    return true;
  });
}

/** Tool-call arguments only; registry metadata is never an argument. */
export function toolParameterProperties(
  parameters: DbToolRow['parameters'],
): Record<string, DbToolParameter> {
  return Object.fromEntries(
    Object.entries(parameters)
      .filter(([name]) => !name.startsWith('$'))
      .map(([name, parameter]) => [name, parameter as DbToolParameter]),
  );
}

export function isDbSurfaceDefaultsRow(value: unknown): value is DbSurfaceDefaultsRow {
  return (
    isRecord(value) &&
    typeof value.surface_name === 'string' &&
    stringArrayOrNull(value.always_include_tools) &&
    stringArrayOrNull(value.always_include_bundles) &&
    stringArrayOrNull(value.never_include_tools)
  );
}

export interface DbBundleMemberRow {
  bundle_name: string;
  tool_name: string | null;
}

export function isDbBundleMemberRow(value: unknown): value is DbBundleMemberRow {
  return isRecord(value) && typeof value.bundle_name === 'string' && stringOrNull(value.tool_name);
}

export interface DbBindingRow {
  tool_id: string;
  executor_name: string;
  is_active: boolean;
}

export function isDbBindingRow(value: unknown): value is DbBindingRow {
  return (
    isRecord(value) &&
    typeof value.tool_id === 'string' &&
    typeof value.executor_name === 'string' &&
    typeof value.is_active === 'boolean'
  );
}
