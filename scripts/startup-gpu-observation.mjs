const FEATURE_KEYS = [
  'gpu_compositing',
  'rasterization',
  'webgl',
  'webgl2',
  'skia_renderer',
  'oop_rasterization',
];

// Caller starts this only after the browser's profile, command line, worker,
// and spawned-process ownership have been verified. CDP owns the 5s deadline.
export function observeStartupGpu(cdp, onResult) {
  const requestedAt = new Date().toISOString();
  const request = cdp.send('SystemInfo.getInfo');
  const observation = { status: 'UNKNOWN', requestedAt };
  onResult(observation);
  return request.then(
    (result) => {
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
      onResult({
        status: skiaBackendType === 'UNKNOWN' ? 'UNKNOWN' : 'RESOLVED',
        requestedAt,
        resolvedAt: new Date().toISOString(),
        skiaBackendType,
        glRenderer,
        featureStatus: safeFeatures,
      });
    },
    () => {
      onResult({
        status: 'UNKNOWN',
        requestedAt,
        failedAt: new Date().toISOString(),
      });
    },
  );
}
