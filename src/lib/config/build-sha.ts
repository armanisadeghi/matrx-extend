declare const __MATRX_BUILD_SHA__: string | undefined;

/** The git sha of the commit this bundle was built from (wxt.config.ts `define`); '' when unknown (tests, tsx). */
export function buildSha(): string {
  try {
    return typeof __MATRX_BUILD_SHA__ === 'string' ? __MATRX_BUILD_SHA__ : '';
  } catch {
    return '';
  }
}
