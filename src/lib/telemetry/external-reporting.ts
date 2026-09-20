/**
 * Firefox lets a person decline optional technical/interaction collection.
 * Client errors remain visible locally either way; this gate controls only
 * the external error-store RPC.
 */
type PermissionProbe = {
  contains: (permissions: { data_collection: ['technicalAndInteraction'] }) => Promise<boolean>;
};

function firefoxPermissionProbe(): PermissionProbe | undefined {
  const runtime = globalThis as typeof globalThis & {
    browser?: { permissions?: PermissionProbe };
  };
  return runtime.browser?.permissions;
}

export async function mayReportExternalTelemetry(
  targetBrowser = (import.meta.env as ImportMetaEnv & { BROWSER?: string }).BROWSER ?? 'chrome',
  permissions = firefoxPermissionProbe(),
): Promise<boolean> {
  if (targetBrowser !== 'firefox') return true;
  if (!permissions) return false;
  try {
    return await permissions.contains({ data_collection: ['technicalAndInteraction'] });
  } catch {
    return false;
  }
}
