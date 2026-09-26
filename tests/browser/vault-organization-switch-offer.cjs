'use strict';

/*
 * Real-browser probe for the authorization fence on a generated-value offer.
 * The caller owns the Settings UI transition; this helper owns only a disposable
 * localhost form and the extension transport. It never reads or mutates Vault
 * items, and records no generated or supplied value in its evidence.
 */
const crypto = require('node:crypto');
const http = require('node:http');

const GENERATION_PORT = 'matrx-generation-panel-v1';
const MINIMUM_REMAINING_TTL_MS = 10_000;

function ownedFixture() {
  const state = { submits: 0 };
  const server = http.createServer((request, response) => {
    if (request.method === 'POST') {
      state.submits += 1;
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html><body><h1>Disposable organization-switch fixture</h1>
      <form method="post" action="/submit">
        <label>New password<input id="new" type="password" autocomplete="new-password"></label>
        <label>Confirm password<input id="confirm" type="password" autocomplete="new-password"></label>
        <button type="submit">Save password</button>
      </form></body></html>`);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () =>
      resolve({
        state,
        url: `http://127.0.0.1:${server.address().port}/password`,
        close: () =>
          new Promise((closeResolve, closeReject) =>
            server.close((error) => (error ? closeReject(error) : closeResolve())),
          ),
      }),
    );
  });
}

function isOffer(offer) {
  return (
    offer &&
    typeof offer.id === 'string' &&
    offer.id.length > 0 &&
    Number.isFinite(offer.expiresAt) &&
    offer.expiresAt >= Date.now() + MINIMUM_REMAINING_TTL_MS
  );
}

exports.runOrganizationSwitchOfferProbe = async ({
  context,
  worker,
  panel,
  wait,
  assert,
  focusOwnedBrowser,
  switchOrganization,
}) => {
  assert(typeof switchOrganization === 'function', 'organization_switch_callback_required');
  let fixture;
  let page;
  let portOpened = false;
  let focusWitnessArmed = false;
  let failure;
  const evidence = {
    scope: 'owned localhost password form and raw extension generation port',
    fixtureMutations: false,
    offerDiscoveredWithGenerousTtl: false,
    organizationSwitchInvoked: false,
    staleResponse: false,
    fieldsUnchanged: false,
    noWebsiteSubmission: false,
  };
  const syntheticValue = `organization-switch-${crypto.randomUUID()}`;
  try {
    fixture = await ownedFixture();
    page = await context.newPage();
    await page.goto(fixture.url);
    await page.bringToFront();
    const tabId = await worker.evaluate(
      async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id,
      fixture.url,
    );
    assert(Number.isInteger(tabId), 'organization_switch_fixture_tab_missing');
    await focusOwnedBrowser(tabId);

    focusWitnessArmed = await worker.evaluate((id) => {
      if (globalThis.__vaultOrganizationSwitchFocusWitness) return false;
      const counts = {
        windowFocus: 0,
        windowRemoved: 0,
        tabActivated: 0,
        tabChanged: 0,
        navigation: 0,
        tabRemoved: 0,
        orgChange: 0,
        authChange: 0,
        profileChange: 0,
      };
      const windowFocus = () => {
        counts.windowFocus += 1;
      };
      const windowRemoved = () => {
        counts.windowRemoved += 1;
      };
      const tabActivated = () => {
        counts.tabActivated += 1;
      };
      const tabChanged = (changedId, change) => {
        if (changedId === id && (change.status === 'loading' || change.url)) counts.tabChanged += 1;
      };
      const navigation = (details) => {
        if (details.tabId === id) counts.navigation += 1;
      };
      const tabRemoved = (removedId) => {
        if (removedId === id) counts.tabRemoved += 1;
      };
      const storageChanged = (changes, area) => {
        if (area !== 'local') return;
        if ('matrx.org.active' in changes) counts.orgChange += 1;
        if ('matrx.auth.accessToken' in changes) counts.authChange += 1;
        if ('matrx.user.profile' in changes) counts.profileChange += 1;
      };
      chrome.windows.onFocusChanged.addListener(windowFocus);
      chrome.windows.onRemoved.addListener(windowRemoved);
      chrome.tabs.onActivated.addListener(tabActivated);
      chrome.tabs.onUpdated.addListener(tabChanged);
      chrome.webNavigation.onCommitted.addListener(navigation);
      chrome.tabs.onRemoved.addListener(tabRemoved);
      chrome.storage.onChanged.addListener(storageChanged);
      globalThis.__vaultOrganizationSwitchFocusWitness = {
        counts,
        dispose: () => {
          chrome.windows.onFocusChanged.removeListener(windowFocus);
          chrome.windows.onRemoved.removeListener(windowRemoved);
          chrome.tabs.onActivated.removeListener(tabActivated);
          chrome.tabs.onUpdated.removeListener(tabChanged);
          chrome.webNavigation.onCommitted.removeListener(navigation);
          chrome.tabs.onRemoved.removeListener(tabRemoved);
          chrome.storage.onChanged.removeListener(storageChanged);
        },
      };
      return true;
    }, tabId);
    assert(focusWitnessArmed === true, 'organization_switch_focus_witness_missing');

    let registryReady = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      registryReady = await worker.evaluate(async (id) => {
        const results = await chrome.scripting.executeScript({
          target: { tabId: id, allFrames: true },
          func: () => !!window.__matrx_generation_target_registry__,
        });
        return results.length === 1 && results[0].result === true;
      }, tabId);
      if (registryReady) break;
      await wait(100);
    }
    assert(registryReady, 'organization_switch_generation_registry_not_mounted');

    const connectionId = await panel.evaluate(`new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: ${JSON.stringify(GENERATION_PORT)} });
      let settled = false;
      let timer;
      const finish = (id) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        port.onMessage.removeListener(listener);
        port.onDisconnect.removeListener(disconnected);
        if (id) globalThis.__vaultOrganizationSwitchOfferPort = port;
        else { try { port.disconnect(); } catch {} }
        resolve(id);
      };
      const listener = (message) => {
        if (message?.__matrxCredentialGeneration !== true || message.operation !== 'connected') return;
        finish(typeof message.connectionId === 'string' ? message.connectionId : null);
      };
      const disconnected = () => finish(null);
      port.onMessage.addListener(listener);
      port.onDisconnect.addListener(disconnected);
      timer = setTimeout(() => finish(null), 10000);
    })`);
    portOpened = true;
    assert(
      typeof connectionId === 'string' && /^[a-f0-9]{36}$/.test(connectionId),
      'organization_switch_port_handshake_missing',
    );
    const request = (payload) =>
      panel.evaluate(
        `chrome.runtime.sendMessage(${JSON.stringify({
          __matrxCredentialGeneration: true,
          connectionId,
          ...payload,
        })})`,
      );
    const discovery = await request({ operation: 'discover', tabId });
    const offer = discovery?.offers?.find(isOffer);
    assert(discovery?.status === 'ready' && offer, 'organization_switch_generous_offer_missing');
    evidence.offerDiscoveredWithGenerousTtl = true;

    await switchOrganization({ tabId, offerExpiresAt: offer.expiresAt });
    evidence.organizationSwitchInvoked = true;
    assert(
      offer.expiresAt >= Date.now() + 3_000,
      'organization_switch_old_offer_expired_before_use',
    );
    const focused = await worker.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id);
      const window = await chrome.windows.get(tab.windowId);
      return tab.active === true && window.focused === true;
    }, tabId);
    assert(focused === true, 'organization_switch_fixture_lost_focus');
    const afterSwitchDiscovery = await request({ operation: 'discover', tabId });
    evidence.newActorOfferReady =
      afterSwitchDiscovery?.status === 'ready' &&
      afterSwitchDiscovery.offers?.some(
        (candidate) => isOffer(candidate) && candidate.id !== offer.id,
      ) === true;
    assert(evidence.newActorOfferReady, 'organization_switch_new_actor_offer_unavailable');
    const result = await request({ operation: 'use', offerId: offer.id, value: syntheticValue });
    const focusEvents = await worker.evaluate(
      () => globalThis.__vaultOrganizationSwitchFocusWitness?.counts ?? null,
    );
    assert(
      focusEvents &&
        focusEvents.orgChange >= 1 &&
        Object.entries(focusEvents).every(([name, count]) => name === 'orgChange' || count === 0),
      'organization_switch_competing_invalidation_observed',
    );
    evidence.noCompetingBrowserInvalidation = true;
    assert(result?.status === 'stale', 'organization_switch_offer_not_stale');
    evidence.staleResponse = true;
    evidence.fieldsUnchanged = await page.evaluate(
      () =>
        document.querySelector('#new').value === '' &&
        document.querySelector('#confirm').value === '',
    );
    assert(evidence.fieldsUnchanged, 'organization_switch_stale_offer_wrote_fields');
    evidence.noWebsiteSubmission = fixture.state.submits === 0;
    assert(evidence.noWebsiteSubmission, 'organization_switch_stale_offer_submitted_form');
  } catch (error) {
    failure = error;
  }
  // Values are never returned or retained after the request reaches the extension.
  const cleanup = await Promise.allSettled([
    Promise.resolve().then(async () => {
      if (portOpened)
        return panel.evaluate(`(() => {
            const port = globalThis.__vaultOrganizationSwitchOfferPort;
            if (!port) return true;
            try { port.disconnect(); } finally { delete globalThis.__vaultOrganizationSwitchOfferPort; }
            return true;
          })()`);
      return true;
    }),
    Promise.resolve().then(async () => {
      if (page && !page.isClosed()) await page.close();
    }),
    Promise.resolve().then(async () => {
      if (fixture) await fixture.close();
    }),
    Promise.resolve().then(async () => {
      if (!focusWitnessArmed) return true;
      return worker.evaluate(() => {
        const witness = globalThis.__vaultOrganizationSwitchFocusWitness;
        if (!witness) return false;
        witness.dispose();
        delete globalThis.__vaultOrganizationSwitchFocusWitness;
        return true;
      });
    }),
  ]);
  evidence.portClosed = cleanup[0].status === 'fulfilled' && cleanup[0].value === true;
  evidence.ownedFixturePageClosed = cleanup[1].status === 'fulfilled' && (!page || page.isClosed());
  evidence.ownedFixtureServerClosed = cleanup[2].status === 'fulfilled';
  evidence.focusWitnessDisposed = cleanup[3].status === 'fulfilled' && cleanup[3].value === true;
  if (
    cleanup.some((result) => result.status === 'rejected') ||
    !evidence.portClosed ||
    !evidence.ownedFixturePageClosed ||
    !evidence.ownedFixtureServerClosed ||
    !evidence.focusWitnessDisposed
  )
    throw new Error('organization_switch_offer_probe_cleanup_failed');
  if (failure) throw failure;
  return evidence;
};
