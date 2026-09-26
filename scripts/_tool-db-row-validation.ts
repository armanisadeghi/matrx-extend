/** Shapes returned by the private tool catalog read. A malformed response is
 * unverified, never an empty or matching catalog. */
export interface DbToolRow {
  id: string;
  name: string;
  description: string | null;
  parameters: Record<
    string,
    { type?: string | string[]; enum?: unknown[]; required?: boolean; [k: string]: unknown }
  >;
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
  return value === null || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

export function isDbToolRow(value: unknown): value is DbToolRow {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' ||
      !stringOrNull(value.description) || !stringOrNull(value.tier) ||
      !stringOrNull(value.category) || !stringOrNull(value.source_kind) ||
      !booleanOrNull(value.admin_only) || !booleanOrNull(value.is_active) ||
      !isRecord(value.parameters)) return false;

  return Object.values(value.parameters).every((param) => {
    if (!isRecord(param)) return false;
    if (param.type !== undefined && typeof param.type !== 'string' &&
        !(Array.isArray(param.type) && param.type.every((item) => typeof item === 'string'))) return false;
    if (param.enum !== undefined && !Array.isArray(param.enum)) return false;
    if (param.required !== undefined && typeof param.required !== 'boolean') return false;
    return true;
  });
}

export function isDbSurfaceDefaultsRow(value: unknown): value is DbSurfaceDefaultsRow {
  return isRecord(value) && typeof value.surface_name === 'string' &&
    stringArrayOrNull(value.always_include_tools) &&
    stringArrayOrNull(value.always_include_bundles) &&
    stringArrayOrNull(value.never_include_tools);
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
  return isRecord(value) && typeof value.tool_id === 'string' &&
    typeof value.executor_name === 'string' && typeof value.is_active === 'boolean';
}
