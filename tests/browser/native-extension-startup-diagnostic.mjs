import { open } from 'node:fs/promises';
import { join } from 'node:path';

// Passive failure evidence only: never wakes a worker or visits a browser page.
export function extensionStartupDiagnostic({
  extensionId,
  targetInfos = [],
  targetObservation,
  registries = [],
  stderr = '',
}) {
  const prefix = `chrome-extension://${extensionId}/`;
  const matching = targetInfos.filter(
    (target) => typeof target.url === 'string' && target.url.startsWith(prefix),
  );
  const entries = registries.flatMap((registry) => {
    const entry = registry?.[extensionId];
    return entry && typeof entry === 'object' ? [entry] : [];
  });
  const disabled = entries.some(
    (entry) =>
      entry.state === 0 ||
      (Array.isArray(entry.disable_reasons)
        ? entry.disable_reasons.length > 0
        : Number.isSafeInteger(entry.disable_reasons) && entry.disable_reasons > 0),
  );
  const flags = {
    loadExtensionSwitchRejected:
      /(?:--load-extension.{0,100}(?:not allowed|not supported|ignored|unsupported)|(?:not allowed|not supported|ignored|unsupported).{0,100}--load-extension)/i.test(
        stderr,
      ),
    extensionLoadFailed:
      /(?:failed to load extension|could not load extension|error loading extension)/i.test(stderr),
    manifestInvalid:
      /(?:manifest (?:file )?(?:is )?(?:missing|invalid|unreadable)|manifest is not valid JSON)/i.test(
        stderr,
      ),
  };
  const workerCount =
    targetObservation?.expectedWorkerCount ??
    matching.filter((target) => target.type === 'service_worker').length;
  const targetCount = targetObservation?.expectedTargetCount ?? matching.length;
  const registryAvailable = registries.length > 0;
  let status = 'unknown';
  if (workerCount > 0) status = 'worker_observed';
  else if (disabled) status = 'disabled';
  // Browser-wide stderr is a signature, not proof that this specific ID failed.
  else if (targetCount > 0 || entries.some((entry) => entry.state === 1))
    status = 'present_without_worker';
  else if (registryAvailable && entries.length === 0) status = 'absent';
  return {
    status,
    registryAvailable,
    registered: registryAvailable ? entries.length > 0 : null,
    disabled,
    expectedTargetCount: targetCount,
    expectedWorkerCount: workerCount,
    loadFailureReported: flags.extensionLoadFailed || flags.manifestInvalid,
    stderrFlags: flags,
  };
}

export async function readExtensionStartupRegistries(profile) {
  const registries = [];
  for (const name of ['Preferences', 'Secure Preferences']) {
    let handle;
    try {
      handle = await open(join(profile, 'Default', name), 'r');
      // Fixed-size read prevents arbitrary profile contents entering memory/output.
      const buffer = Buffer.alloc(1024 * 1024 + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 1024 * 1024) continue;
      const settings = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))?.extensions
        ?.settings;
      if (settings && typeof settings === 'object' && !Array.isArray(settings))
        registries.push(settings);
    } catch {
      // Missing, partially written, or unreadable files leave evidence unknown.
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  return registries;
}
