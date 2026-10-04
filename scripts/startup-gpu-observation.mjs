const FEATURE_KEYS = [
  'gpu_compositing',
  'rasterization',
  'webgl',
  'webgl2',
  'skia_renderer',
  'oop_rasterization',
];

// Caller starts this only after the primary browser's profile, command line,
// worker, and spawned-process ownership have been verified. The connector opens
// a second ownership-checked transport so its deadline cannot poison startup.
export async function observeStartupGpu(connect, onResult, signal) {
  const requestedAt = new Date().toISOString();
  onResult({ status: 'UNKNOWN', requestedAt });
  let cdp;
  const release = () => {
    const current = cdp;
    cdp = undefined;
    return current?.detach().catch(() => {}) ?? Promise.resolve();
  };
  let finished = false;
  const fail = () => {
    if (finished) return;
    finished = true;
    onResult({ status: 'UNKNOWN', requestedAt, failedAt: new Date().toISOString() });
    void release();
  };
  signal?.addEventListener('abort', fail, { once: true });
  try {
    if (signal?.aborted) return fail();
    cdp = await connect();
    if (signal?.aborted) return fail();
    const result = await cdp.send('SystemInfo.getInfo');
    if (signal?.aborted) return fail();
    const aux = result?.gpu?.auxAttributes;
    const featureStatus = result?.gpu?.featureStatus;
    const safeFeatures = Object.fromEntries(
      FEATURE_KEYS.filter((key) => typeof featureStatus?.[key] === 'string').map((key) => [
        key,
        featureStatus[key],
      ]),
    );
    const skiaBackendType =
      typeof aux?.skiaBackendType === 'string' ? aux.skiaBackendType : 'UNKNOWN';
    const glRenderer = typeof aux?.glRenderer === 'string' ? aux.glRenderer : 'UNKNOWN';
    finished = true;
    onResult({
      status: skiaBackendType === 'UNKNOWN' ? 'UNKNOWN' : 'RESOLVED',
      requestedAt,
      resolvedAt: new Date().toISOString(),
      skiaBackendType,
      glRenderer,
      featureStatus: safeFeatures,
    });
  } catch {
    fail();
  } finally {
    signal?.removeEventListener('abort', fail);
    if (!signal?.aborted) await release();
    else void release();
  }
}
