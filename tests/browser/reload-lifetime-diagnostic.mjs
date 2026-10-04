const ID = /^[A-Za-z0-9-]{1,128}$/;
const STATUS = new Set(['new', 'installing', 'installed', 'activating', 'activated', 'redundant']);
const RUNNING = new Set(['stopped', 'starting', 'running', 'stopping']);
const MAX_EVENTS = 80;
const safeId = (value) => (typeof value === 'string' && ID.test(value) ? value : null);
const safeTime = () => new Date().toISOString();
const bounded = (events, event) => {
  if (events.length < MAX_EVENTS) events.push(event);
};
const safeTarget = (info, kind) => ({
  target_id: safeId(info?.targetId),
  type:
    info?.type === 'service_worker' ? 'service_worker' : info?.type === 'page' ? 'page' : 'other',
  kind,
  attached: typeof info?.attached === 'boolean' ? info.attached : null,
});
const fixedError = (error) =>
  /^(?:Protocol error \(Target\.getTargetInfo\): )?No target with given id found$/.test(
    String(error?.message ?? ''),
  )
    ? 'target_absent'
    : 'probe_failed';
const timeout = (promise, ms) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('diagnostic_probe_timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

export async function startReloadLifetimeDiagnostic({ browser, context, page, extensionId }) {
  const prefix = `chrome-extension://${extensionId}/`;
  const evidence = {
    availability: 'unavailable',
    browser_version: null,
    independent_targets: [],
    versions: [],
    registrations: [],
    old_version_id: null,
    old_version_mapping: 'unmeasured',
    version_observation: 'unavailable',
    old_host_probe: null,
    replacement_host_probe: null,
  };
  let browserSession;
  let pageSession;
  const listeners = [];
  const on = (session, name, handler) => {
    session.on(name, handler);
    listeners.push([session, name, handler]);
  };
  const targetKinds = new Map();
  const versions = new Map();
  const ownedTarget = (info) => {
    if (!info?.url?.startsWith(prefix) || !safeId(info.targetId)) return null;
    const kind =
      info.type === 'service_worker'
        ? 'worker'
        : info.url === `${prefix}sidepanel.html`
          ? 'panel'
          : 'extension_other';
    targetKinds.set(info.targetId, kind);
    return safeTarget(info, kind);
  };
  try {
    browserSession = await browser.newBrowserCDPSession();
    on(browserSession, 'Target.targetCreated', ({ targetInfo }) => {
      const target = ownedTarget(targetInfo);
      if (target)
        bounded(evidence.independent_targets, { at: safeTime(), phase: 'created', target });
    });
    on(browserSession, 'Target.targetInfoChanged', ({ targetInfo }) => {
      const target = ownedTarget(targetInfo);
      if (target)
        bounded(evidence.independent_targets, { at: safeTime(), phase: 'changed', target });
    });
    on(browserSession, 'Target.targetDestroyed', ({ targetId }) => {
      const kind = targetKinds.get(targetId);
      if (kind)
        bounded(evidence.independent_targets, {
          at: safeTime(),
          phase: 'destroyed',
          target: safeTarget({ targetId }, kind),
        });
    });
    const version = await browserSession.send('Browser.getVersion');
    evidence.browser_version = {
      protocol_version:
        typeof version?.protocolVersion === 'string' ? version.protocolVersion.slice(0, 40) : null,
      product: /^Chrome\/[0-9.]+$/.test(version?.product ?? '') ? version.product : null,
      revision: /^[A-Za-z0-9.@_-]{1,100}$/.test(version?.revision ?? '') ? version.revision : null,
    };
    await browserSession.send('Target.setDiscoverTargets', { discover: true });
    const initial = await browserSession.send('Target.getTargets');
    for (const info of initial.targetInfos ?? []) {
      const target = ownedTarget(info);
      if (target)
        bounded(evidence.independent_targets, { at: safeTime(), phase: 'initial', target });
    }
    pageSession = await context.newCDPSession(page);
    on(pageSession, 'ServiceWorker.workerVersionUpdated', ({ versions: updates }) => {
      for (const version of updates ?? []) {
        if (!version?.scriptURL?.startsWith(prefix)) continue;
        const versionId = safeId(version.versionId);
        const registrationId = safeId(version.registrationId);
        if (!versionId || !registrationId) continue;
        const item = {
          at: safeTime(),
          version_id: versionId,
          registration_id: registrationId,
          target_id: safeId(version.targetId),
          running_status: RUNNING.has(version.runningStatus) ? version.runningStatus : null,
          status: STATUS.has(version.status) ? version.status : null,
        };
        versions.set(versionId, {
          ...versions.get(versionId),
          ...item,
          target_id: item.target_id ?? versions.get(versionId)?.target_id ?? null,
        });
        bounded(evidence.versions, item);
      }
    });
    on(pageSession, 'ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      for (const registration of registrations ?? []) {
        if (!registration?.scopeURL?.startsWith(prefix)) continue;
        const registrationId = safeId(registration.registrationId);
        if (!registrationId) continue;
        bounded(evidence.registrations, {
          at: safeTime(),
          registration_id: registrationId,
          is_deleted: registration.isDeleted === true,
        });
      }
    });
    await pageSession.send('ServiceWorker.enable');
    evidence.availability = 'ready';
  } catch {
    evidence.availability = 'unavailable';
  }
  const correlateOld = (oldTargetId) => {
    const matches = [...versions.values()].filter((value) => value.target_id === oldTargetId);
    if (matches.length === 1) {
      evidence.old_version_id = matches[0].version_id;
      evidence.old_version_mapping = 'correlated';
      evidence.version_observation = 'visible';
    }
  };
  const probeOne = async (targetId, kind) => {
    if (!browserSession || !safeId(targetId)) return { outcome: 'unmeasured' };
    try {
      const response = await timeout(
        browserSession.send('Target.getTargetInfo', { targetId }),
        3000,
      );
      const info = response?.targetInfo;
      return info?.targetId === targetId
        ? { outcome: 'present', target: safeTarget(info, kind) }
        : { outcome: 'probe_failed' };
    } catch (error) {
      return { outcome: fixedError(error) };
    }
  };
  return {
    evidence,
    correlateOld,
    async probe(oldTargetId, replacementTargetId) {
      evidence.old_host_probe = await probeOne(oldTargetId, 'worker');
      evidence.replacement_host_probe = await probeOne(replacementTargetId, 'worker');
    },
    async close() {
      for (const [session, name, handler] of listeners) session.off(name, handler);
      if (pageSession) await pageSession.send('ServiceWorker.disable').catch(() => {});
      await pageSession?.detach().catch(() => {});
      await browserSession?.detach().catch(() => {});
    },
  };
}
