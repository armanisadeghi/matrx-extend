#!/usr/bin/env node
/** Prepare a published release artifact, then run the real native-panel guest test. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  auditArtifactSelectionEnv,
  desktopArtifactSelectionEnv,
} from '../tests/browser/desktop-artifact-identity.mjs';
import { scrapeNativeSelection } from '../tests/browser/scrape-native-selection.mjs';
import { matchingCrx3RsaKey } from './crx3-identity.mjs';
import {
  selectOrImportNativeTarget,
  verifyImportedNativeEvidence,
} from './current-test-artifact.mjs';
import { hostedDesktopSettingsCase } from './hosted-desktop-settings-route.mjs';
import { lockedHostedTypeScript } from './hosted-driver-dependencies.mjs';
import {
  hostedProfileRoute,
  requireHostedAcceptanceCredential,
  stageProfileOrganizationConfig,
} from './hosted-profile-route.mjs';
import { prepareHostedReleaseArtifact } from './hosted-release-artifact.mjs';
import { hostedScrapeReloadDiagnostic } from './hosted-scrape-reload-diagnostic.mjs';
import { requireHostedScrapeRoute } from './hosted-scrape-route.mjs';
import {
  hostedGuestSeoRoute,
  hostedSeoInterruptTarget,
  hostedSeoMetadataFixture,
  hostedSeoResourceDiagnostic,
} from './hosted-seo-route.mjs';
import { hostedShowcaseRoute } from './hosted-showcase-route.mjs';
import { runHostedStartupIntervalDiagnostic } from './hosted-startup-interval-diagnostic.mjs';
import {
  PUBLISHED_STORE_CRX,
  requirePublishedStoreCrxTarget,
} from './published-store-crx-target.mjs';
import { hashReleaseTree } from './sync-unpacked-release.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function ownedProcess(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveRun({ code, signal }));
  });
}

async function prepareDevelopment(runId, artifactId) {
  assert.match(runId, /^[1-9][0-9]*$/);
  assert.match(artifactId, /^[1-9][0-9]*$/);
  const sourceRoot = join(repo, 'test-results/ci-artifacts');
  const { target, sourceSha } = await selectOrImportNativeTarget(
    sourceRoot,
    runId,
    artifactId,
    async () => {
      const imported = await ownedProcess(process.execPath, [
        join(repo, 'scripts/current-test-artifact.mjs'),
        'import',
        runId,
        artifactId,
      ]);
      assert.equal(imported.code, 0, 'authenticated CI development artifact import failed');
    },
  );
  const extensionDir = join(target, 'chrome-mv3');
  const relocatedReceipt = join(target, 'local-dev-receipt.json');
  const evidence = await verifyImportedNativeEvidence(extensionDir, relocatedReceipt);
  assert.equal(evidence.eligibleStore, false);
  assert.equal(evidence.sourceSha, sourceSha);
  assert.equal(evidence.runId, Number(runId));
  assert.equal(evidence.artifactId, Number(artifactId));
  process.stdout.write(`PREPARED_DEVELOPMENT ${evidence.sourceSha} ${evidence.treeSha256}\n`);
  return {
    extensionDir,
    relocatedReceipt,
    kind: 'ci_development_test',
    eligibleStore: false,
    sourceSha,
    runId: Number(runId),
    artifactId: Number(artifactId),
    ciEvidence: evidence,
  };
}

async function runProfile(prepared, acceptanceCase) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'hosted_profile_runner_required');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'hosted_profile_vm_required');
  const outputDir = join(repo, 'test-results');
  const runId = `hosted-profile-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  const route = hostedProfileRoute(acceptanceCase, prepared, outputDir, runId);
  const profileEnvPath = join(repo, '.env.production');
  const adminEnvPath = join(homedir(), 'code/aidream/.env');
  const organizationConfigPath = join(outputDir, 'notes-private-config.json');
  const memberLinkPath = join(
    dirname(prepared.relocatedReceipt),
    'profile-member-link-private.json',
  );
  const created = [];
  let passed = false;
  try {
    await mkdir(outputDir, { recursive: true, mode: 0o700 });
    const url = process.env.WXT_SUPABASE_URL;
    const key = process.env.WXT_SUPABASE_PUBLISHABLE_KEY;
    assert.equal(url, 'https://db.matrxserver.com', 'hosted_profile_public_url_refused');
    assert.match(key ?? '', /^sb_publishable_[A-Za-z0-9_-]+$/, 'hosted_profile_public_key_refused');
    const profileEnv = await readFile(profileEnvPath, 'utf8');
    const profileValue = (name) =>
      profileEnv
        .split(/\r?\n/)
        .find((line) => line.startsWith(`${name}=`))
        ?.slice(name.length + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    assert.equal(profileValue('WXT_SUPABASE_URL'), url, 'hosted_profile_public_url_mismatch');
    assert.equal(
      profileValue('WXT_SUPABASE_PUBLISHABLE_KEY'),
      key,
      'hosted_profile_public_key_mismatch',
    );
    const childEnv = {
      ...process.env,
      MATRX_PLAYWRIGHT_MODULE: join(packageDir, 'index.mjs'),
      ...route.env,
    };
    if (acceptanceCase === 'profile-admin') {
      await stageProfileOrganizationConfig(organizationConfigPath, process.env);
      created.push(organizationConfigPath);
      const raw = process.env.MATRX_HOSTED_ADMIN_CREDENTIALS_JSON;
      assert.ok(raw, 'hosted_profile_admin_secret_required');
      const credentials = JSON.parse(raw);
      assert.equal(credentials.email, 'admin@admin.com', 'hosted_profile_admin_identity_refused');
      assert.ok(
        typeof credentials.password === 'string' && credentials.password,
        'hosted_profile_admin_password_required',
      );
      assert.ok(!/[\r\n]/.test(credentials.password), 'hosted_profile_admin_password_line_refused');
      assert.equal(
        credentials.password.trim().replace(/^["']|["']$/g, ''),
        credentials.password,
        'hosted_profile_admin_password_file_roundtrip_refused',
      );
      await mkdir(dirname(adminEnvPath), { recursive: true, mode: 0o700 });
      await writeFile(
        adminEnvPath,
        `AI_ADMIN_USERNAME=admin@admin.com\nAI_ADMIN_PASSWORD=${credentials.password}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      created.push(adminEnvPath);
    } else {
      assert.ok(process.env.MATRX_HOSTED_MEMBER_LINK_JSON, 'hosted_profile_member_link_required');
      await writeFile(memberLinkPath, process.env.MATRX_HOSTED_MEMBER_LINK_JSON, {
        flag: 'wx',
        mode: 0o600,
      });
      created.push(memberLinkPath);
      childEnv.MATRX_REVIEWER_MAGIC_LINK_FILE = memberLinkPath;
    }
    childEnv.MATRX_HOSTED_ADMIN_CREDENTIALS_JSON = undefined;
    childEnv.MATRX_HOSTED_MEMBER_LINK_JSON = undefined;
    childEnv.MATRX_HOSTED_PROFILE_ORGANIZATION_JSON = undefined;
    const result = await ownedProcess(process.execPath, [join(repo, route.driver)], {
      cwd: repo,
      env: childEnv,
    });
    assert.equal(
      result.code,
      0,
      `Profile native acceptance exited ${result.code ?? result.signal}`,
    );
    const report = JSON.parse(
      await readFile(join(outputDir, `profile-native-${runId}.json`), 'utf8'),
    );
    assert.equal(report.status, 'passed', 'hosted_profile_report_not_passed');
    assert.equal(report.profile_row_existed_before, true, 'hosted_profile_existing_row_required');
    assert.equal(
      report.extended_census?.complete,
      true,
      'hosted_profile_extended_cases_incomplete',
    );
    assert.equal(report.restoration?.verified, true, 'hosted_profile_restoration_unverified');
    passed = true;
  } finally {
    for (const path of created.reverse()) await unlink(path);
    if (passed) await unlink(route.env.PROFILE_PRIVATE_OWNERSHIP_RECEIPT);
  }
}

async function preparePublishedStoreCrx(outputDir) {
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0.0.0&acceptformat=crx3&x=id%3D${PUBLISHED_STORE_CRX.id}%26uc`;
  const response = await fetch(url);
  assert.equal(response.ok, true, 'official Chrome update download failed');
  const crx = Buffer.from(await response.arrayBuffer());
  assert.equal(sha256(crx), PUBLISHED_STORE_CRX.crxSha256, 'published public CRX SHA-256');
  assert.equal(crx.toString('ascii', 0, 4), 'Cr24', 'CRX magic');
  assert.equal(crx.readUInt32LE(4), 3, 'CRX3 format');
  const zipOffset = 12 + crx.readUInt32LE(8);
  assert.ok(zipOffset > 12 && zipOffset < crx.length - 100, 'CRX ZIP offset');
  assert.equal(crx.toString('ascii', zipOffset, zipOffset + 2), 'PK', 'CRX ZIP payload');
  const crxPath = join(outputDir, `${PUBLISHED_STORE_CRX.id}.crx`);
  const zipPath = join(outputDir, `${PUBLISHED_STORE_CRX.id}.zip`);
  await writeFile(crxPath, crx, { mode: 0o600 });
  await writeFile(zipPath, crx.subarray(zipOffset), { mode: 0o600 });
  const listing = await new Promise((resolveList, reject) => {
    const child = spawn('unzip', ['-Z1', zipPath]);
    let data = '';
    child.stdout.on('data', (chunk) => {
      data += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolveList(data) : reject(new Error('CRX ZIP listing failed')),
    );
  });
  const entries = listing.trimEnd().split('\n');
  assert.ok(entries.includes('manifest.json'), 'published CRX manifest missing');
  assert.ok(
    entries.every(
      (entry) =>
        entry &&
        !entry.startsWith('/') &&
        !entry.split('/').includes('..') &&
        !entry.includes('\\'),
    ),
    'unsafe CRX ZIP entry',
  );
  const extensionDir = join(outputDir, 'published-store-crx-unpacked');
  await mkdir(extensionDir, { recursive: true });
  const extracted = await ownedProcess('unzip', ['-q', zipPath, '-d', extensionDir]);
  assert.equal(extracted.code, 0, 'published CRX extraction failed');
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, PUBLISHED_STORE_CRX.version, 'published CRX version');
  assert.equal(manifest.key, undefined, 'published CRX payload manifest must be unkeyed');
  const signingKey = matchingCrx3RsaKey(crx, PUBLISHED_STORE_CRX.id);
  // Chrome adds this same Store signing key during installation. The temporary
  // unpacked copy needs it to keep the primary item ID under --load-extension.
  manifest.key = signingKey.toString('base64');
  await writeFile(join(extensionDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  // Chromium removes Store verification metadata when this signed CRX is loaded
  // as an unpacked extension. Record that exact adaptation before the immutable
  // runtime receipt; every remaining file stays covered by the strict tree hash.
  const metadataPath = '_metadata/verified_contents.json';
  const metadataBytes = await readFile(join(extensionDir, metadataPath));
  const removedStoreMetadata = {
    path: metadataPath,
    bytes: metadataBytes.length,
    sha256: sha256(metadataBytes),
  };
  await unlink(join(extensionDir, metadataPath));
  const treeSha256 = hashReleaseTree(extensionDir);
  const receipt = {
    kind: 'published_store_crx_unpacked',
    version: PUBLISHED_STORE_CRX.version,
    extensionId: PUBLISHED_STORE_CRX.id,
    crxPath,
    crxSha256: PUBLISHED_STORE_CRX.crxSha256,
    treeSha256,
    downloadSource: 'Google Chrome public update service; verified CRX3 signing key and SHA-256',
    unpackedAdaptation:
      'Temporary manifest.key copied from CRX3 RSA signing proof; exact Store verification metadata removed for unpacked Chromium loading; original CRX unchanged',
    removedStoreMetadata,
  };
  const relocatedReceipt = join(outputDir, 'published-store-crx-receipt.json');
  await writeFile(relocatedReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `PREPARED_PUBLISHED_STORE_CRX ${PUBLISHED_STORE_CRX.version} ${PUBLISHED_STORE_CRX.id} ${treeSha256}\n`,
  );
  return { extensionDir, relocatedReceipt, kind: receipt.kind };
}

async function run(prepared, artifactMode) {
  const { extensionDir, relocatedReceipt, kind } = prepared;
  const acceptanceCase = process.env.MATRX_HOSTED_ACCEPTANCE_CASE ?? 'guest-chat';
  const scrapeReloadDiagnostic = hostedScrapeReloadDiagnostic(
    acceptanceCase,
    process.env.MATRX_SCRAPE_RELOAD_OPEN_DIAGNOSTIC ?? '0',
  );
  const desktopCase = hostedDesktopSettingsCase(
    acceptanceCase,
    process.env.MATRX_HOSTED_DESKTOP_SETTINGS_CASE,
  );
  if (acceptanceCase.startsWith('desktop-settings-'))
    console.log(`HOSTED_DESKTOP_SETTINGS_CASE ${desktopCase}`);
  assert.ok(
    [
      'guest-chat',
      'guest-seo',
      'guest-data',
      'guest-scrape',
      'guest-scrape-development',
      'settings-controls',
      'settings-theme-rendering',
      'settings-persistence',
      'settings-persistence-admin',
      'settings-persistence-member',
      'desktop-settings-guest',
      'desktop-settings-member',
      'desktop-settings-admin',
      'visibility-census-guest',
      'visibility-census-member',
      'visibility-census-admin',
      'audit-key-admin',
      'member-chat',
      'prepare-stale-results',
      'showcase-picker-admin',
      'showcase-stale-admin',
      'showcase-d47-admin',
      'showcase-d47-public-admin',
      'records-readonly-admin',
      'profile-admin',
      'profile-member',
    ].includes(acceptanceCase),
  );
  if (acceptanceCase === 'settings-controls' || acceptanceCase === 'settings-theme-rendering')
    assert.equal(kind, 'ci_development_test', 'Settings controls requires CI development receipt');
  if (acceptanceCase === 'guest-data')
    assert.equal(kind, 'ci_development_test', 'Guest Data requires CI development receipt');
  const guestDataCiReceiptPath =
    acceptanceCase === 'guest-data'
      ? join(
          dirname(relocatedReceipt),
          `guest-data-ci-receipt-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.json`,
        )
      : null;
  if (guestDataCiReceiptPath) {
    assert.equal(
      prepared.ciEvidence?.kind,
      'ci_development_test',
      'data_guest_ci_receipt_required',
    );
    const evidence = prepared.ciEvidence;
    await writeFile(
      guestDataCiReceiptPath,
      `${JSON.stringify(
        {
          schema_version: evidence.schema_version,
          kind: evidence.kind,
          eligibleStore: evidence.eligibleStore,
          publish_state: evidence.publish_state,
          sourceSha: evidence.sourceSha,
          runId: evidence.runId,
          artifactId: evidence.artifactId,
          githubArtifactDigest: evidence.githubArtifactDigest,
          version: evidence.version,
          treeSha256: evidence.treeSha256,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600, flag: 'wx' },
    );
  }
  if (acceptanceCase.startsWith('settings-persistence'))
    assert.equal(
      kind,
      'ci_development_test',
      'Settings persistence requires CI development receipt',
    );
  if (acceptanceCase.startsWith('desktop-settings-'))
    assert.equal(kind, 'ci_development_test', 'Desktop Settings requires CI development receipt');
  if (acceptanceCase.startsWith('visibility-census-'))
    assert.equal(kind, 'ci_development_test', 'Visibility census requires CI development receipt');
  if (acceptanceCase === 'audit-key-admin')
    assert.equal(kind, 'ci_development_test', 'Audit key requires CI development receipt');
  if (acceptanceCase === 'member-chat')
    assert.equal(
      kind,
      'published_store_zip_adapted',
      'Member Chat requires exact Store ZIP payload',
    );
  if (
    acceptanceCase === 'guest-chat' &&
    kind !== 'ci_development_test' &&
    kind !== 'published_store_crx_unpacked'
  )
    assert.equal(
      kind,
      'published_store_zip_adapted',
      'Guest Chat release requires exact Store ZIP payload',
    );
  const scrapeRoute = requireHostedScrapeRoute(acceptanceCase, artifactMode, prepared);
  const seoRoute = hostedGuestSeoRoute(
    acceptanceCase,
    artifactMode,
    prepared,
    process.env.MATRX_HOSTED_SEO_CASE_SCOPE ?? 'full',
    process.env.MATRX_HOSTED_SEO_METADATA_FIXTURE ?? 'none',
    process.env.MATRX_HOSTED_SEO_INTERRUPT_AFTER_TARGET ?? 'none',
    process.env.MATRX_HOSTED_SEO_RESOURCE_DIAGNOSTIC ?? '0',
  );
  const scrapeSelection = scrapeRoute ? scrapeNativeSelection(process.env) : null;
  if (
    acceptanceCase === 'prepare-stale-results' ||
    acceptanceCase.startsWith('showcase-') ||
    acceptanceCase === 'records-readonly-admin'
  )
    assert.equal(kind, 'ci_development_test', 'Native case requires exact CI development receipt');
  if (acceptanceCase === 'profile-admin' || acceptanceCase === 'profile-member') {
    await runProfile(prepared, acceptanceCase);
    return;
  }
  const memberLinkPath = join(dirname(relocatedReceipt), 'member-magic-link-private.json');
  const adminCredentialsPath = join(runtimeDir, 'prepare-admin-credentials-private.json');
  const approvedAdminOrganizationPath = join(
    runtimeDir,
    'approved-admin-organization-private.json',
  );
  const showcaseRoute = hostedShowcaseRoute(
    acceptanceCase,
    prepared,
    {
      temp: process.env.RUNNER_TEMP,
      runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
    },
    process.env.MATRX_D47_RESPONSE_ORDER || 'current-first',
    process.env.MATRX_D47_PUBLIC_RACE_PREFLIGHT === '1',
  );
  const needsApprovedAdminOrganization =
    Boolean(showcaseRoute) || (scrapeRoute && scrapeSelection.mode === 'admin');
  let adminCredentialsCreated = false;
  if (
    acceptanceCase === 'member-chat' ||
    (scrapeRoute && scrapeSelection.mode === 'member') ||
    acceptanceCase === 'settings-persistence-member' ||
    acceptanceCase === 'desktop-settings-member' ||
    acceptanceCase === 'visibility-census-member'
  ) {
    assert.ok(process.env.MATRX_HOSTED_MEMBER_LINK_JSON, 'member link secret required');
    await writeFile(memberLinkPath, process.env.MATRX_HOSTED_MEMBER_LINK_JSON, {
      mode: 0o600,
      flag: 'wx',
    });
  }
  if (
    acceptanceCase === 'prepare-stale-results' ||
    showcaseRoute ||
    (scrapeRoute && scrapeSelection.mode === 'admin') ||
    acceptanceCase === 'settings-persistence-admin' ||
    acceptanceCase === 'audit-key-admin' ||
    acceptanceCase === 'desktop-settings-admin' ||
    acceptanceCase === 'visibility-census-admin'
  ) {
    assert.ok(process.env.MATRX_HOSTED_ADMIN_CREDENTIALS_JSON, 'Prepare admin secret required');
    const parsed = JSON.parse(process.env.MATRX_HOSTED_ADMIN_CREDENTIALS_JSON);
    assert.equal(parsed.email, 'admin@admin.com', 'Prepare admin identity required');
    assert.ok(
      typeof parsed.password === 'string' && parsed.password,
      'Prepare admin password required',
    );
    await writeFile(adminCredentialsPath, JSON.stringify(parsed), { mode: 0o600, flag: 'wx' });
    adminCredentialsCreated = true;
  }
  if (needsApprovedAdminOrganization)
    await stageProfileOrganizationConfig(approvedAdminOrganizationPath, process.env);
  const childEnv = {
    ...process.env,
    // Acceptance must consume the same runtime this wrapper just verified.
    MATRX_PLAYWRIGHT_MODULE: join(packageDir, 'index.mjs'),
    ...(['showcase-d47-admin', 'showcase-d47-public-admin'].includes(acceptanceCase)
      ? { MATRX_TYPESCRIPT_MODULE: hostedTypeScriptPath }
      : {}),
    MATRX_GUEST_CHAT_EXTENSION_DIR: extensionDir,
    MATRX_SCRAPE_EXTENSION_DIR: extensionDir,
    MATRX_SCRAPE_RECEIPT: relocatedReceipt,
    MATRX_SCRAPE_ARTIFACT_CHANNEL: scrapeRoute?.channel,
    MATRX_SCRAPE_AUTH_MODE: scrapeSelection?.mode,
    MATRX_SCRAPE_WIDTH_MODE: scrapeSelection?.widthMode,
    MATRX_SCRAPE_RELOAD_OPEN_DIAGNOSTIC: scrapeReloadDiagnostic,
    ...(seoRoute?.env ?? {}),
    ...(needsApprovedAdminOrganization
      ? { MATRX_APPROVED_ADMIN_ORGANIZATION_FILE: approvedAdminOrganizationPath }
      : {}),
    ...(showcaseRoute?.env ?? { MATRX_SHOWCASE_STALE_BOUNDARY: undefined }),
    ...(scrapeRoute?.channel === 'development'
      ? {
          MATRX_SCRAPE_CI_SOURCE_SHA: prepared.sourceSha,
          MATRX_SCRAPE_CI_RUN_ID: String(prepared.runId),
          MATRX_SCRAPE_CI_ARTIFACT_ID: String(prepared.artifactId),
        }
      : {}),
    MATRX_REVIEWER_EXTENSION_DIR: extensionDir,
    MATRX_REVIEWER_RELEASE_RECEIPT: relocatedReceipt,
    ...(acceptanceCase.startsWith('settings-persistence')
      ? {
          MATRX_D87_EXTENSION_DIR: extensionDir,
          MATRX_D87_RECEIPT: relocatedReceipt,
          MATRX_D87_AUTH_MODE:
            acceptanceCase === 'settings-persistence-admin'
              ? 'admin'
              : acceptanceCase === 'settings-persistence-member'
                ? 'member'
                : 'guest',
        }
      : {}),
    ...(acceptanceCase.startsWith('desktop-settings-')
      ? {
          MATRX_DESKTOP_SETTINGS_EXTENSION_DIR: extensionDir,
          MATRX_DESKTOP_SETTINGS_RECEIPT: relocatedReceipt,
          ...desktopArtifactSelectionEnv(prepared),
          MATRX_DESKTOP_SETTINGS_AUTH_MODE: acceptanceCase.slice('desktop-settings-'.length),
          MATRX_DESKTOP_SETTINGS_CASE: desktopCase,
        }
      : {}),
    ...(acceptanceCase.startsWith('visibility-census-')
      ? {
          MATRX_CENSUS_ROLE: acceptanceCase.slice('visibility-census-'.length),
          MATRX_CENSUS_EXTENSION_DIR: extensionDir,
          MATRX_CENSUS_RECEIPT: relocatedReceipt,
          MATRX_CENSUS_OUTPUT: join(repo, 'test-results', `${acceptanceCase}.json`),
          MATRX_CENSUS_SOURCE_SHA: prepared.sourceSha,
          MATRX_CENSUS_CI_RUN_ID: String(prepared.runId),
          MATRX_CENSUS_ARTIFACT_ID: String(prepared.artifactId),
        }
      : {}),
    ...(acceptanceCase === 'member-chat' ||
    (scrapeRoute && scrapeSelection.mode === 'member') ||
    acceptanceCase === 'settings-persistence-member' ||
    acceptanceCase === 'desktop-settings-member' ||
    acceptanceCase === 'visibility-census-member'
      ? { MATRX_REVIEWER_MAGIC_LINK_FILE: memberLinkPath }
      : {}),
    ...(acceptanceCase === 'prepare-stale-results' ||
    showcaseRoute ||
    (scrapeRoute && scrapeSelection.mode === 'admin') ||
    acceptanceCase === 'settings-persistence-admin' ||
    acceptanceCase === 'audit-key-admin' ||
    acceptanceCase === 'desktop-settings-admin' ||
    acceptanceCase === 'visibility-census-admin'
      ? {
          MATRX_PREPARE_EXTENSION_DIR: extensionDir,
          MATRX_PREPARE_RECEIPT: relocatedReceipt,
          MATRX_PREPARE_ADMIN_CREDENTIALS_FILE: adminCredentialsPath,
          ...(acceptanceCase === 'audit-key-admin'
            ? {
                MATRX_AUDIT_EXTENSION_DIR: extensionDir,
                MATRX_AUDIT_RECEIPT: relocatedReceipt,
                ...auditArtifactSelectionEnv(prepared),
              }
            : {}),
        }
      : {}),
    ...(acceptanceCase === 'settings-controls' || acceptanceCase === 'settings-theme-rendering'
      ? {
          SETTINGS_DEV_EXTENSION_DIR: extensionDir,
          SETTINGS_DEV_BUILD_RECEIPT: relocatedReceipt,
        }
      : {}),
    ...(acceptanceCase === 'guest-data'
      ? {
          MATRX_DATA_EXTENSION_DIR: extensionDir,
          MATRX_DATA_RECEIPT: relocatedReceipt,
          MATRX_DATA_CI_RECEIPT: guestDataCiReceiptPath,
          MATRX_DATA_CI_SOURCE_SHA: prepared.sourceSha,
          MATRX_DATA_CI_RUN_ID: String(prepared.runId),
          MATRX_DATA_CI_ARTIFACT_ID: String(prepared.artifactId),
        }
      : {}),
    ...(kind === 'ci_development_test'
      ? { MATRX_GUEST_CHAT_DEV_RECEIPT: relocatedReceipt }
      : { MATRX_GUEST_CHAT_RELEASE_RECEIPT: relocatedReceipt }),
  };
  childEnv.MATRX_HOSTED_MEMBER_LINK_JSON = undefined;
  childEnv.MATRX_HOSTED_ADMIN_CREDENTIALS_JSON = undefined;
  childEnv.MATRX_HOSTED_PROFILE_ORGANIZATION_JSON = undefined;
  childEnv.MATRX_REVIEWER_CREDENTIALS_FILE = undefined;
  try {
    const child = spawn(
      process.execPath,
      [
        join(
          repo,
          acceptanceCase === 'settings-controls' || acceptanceCase === 'settings-theme-rendering'
            ? 'tests/browser/settings-local-controls-acceptance.mjs'
            : acceptanceCase === 'guest-data'
              ? 'tests/browser/data-guest-native-acceptance.mjs'
              : seoRoute
                ? seoRoute.driver
                : scrapeRoute
                  ? scrapeRoute.driver
                  : acceptanceCase.startsWith('visibility-census-')
                    ? 'tests/browser/takeover-visible-census.mjs'
                    : acceptanceCase.startsWith('desktop-settings-')
                      ? 'tests/browser/settings-desktop-native-acceptance.mjs'
                      : acceptanceCase === 'audit-key-admin'
                        ? 'tests/browser/audit-key-native-acceptance.mjs'
                        : acceptanceCase.startsWith('settings-persistence')
                          ? 'tests/browser/settings-d87-native-acceptance.mjs'
                          : showcaseRoute
                            ? showcaseRoute.driver
                            : acceptanceCase === 'prepare-stale-results'
                              ? 'tests/browser/prepare-stale-result-native-acceptance.mjs'
                              : acceptanceCase === 'member-chat'
                                ? 'tests/browser/reviewer-chat-store-acceptance.mjs'
                                : 'tests/browser/guest-chat-store-acceptance.mjs',
        ),
      ],
      {
        cwd: repo,
        stdio: 'inherit',
        env: childEnv,
      },
    );
    const result = await new Promise((resolveRun, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolveRun({ code, signal }));
    });
    assert.equal(
      result.code,
      0,
      `native side-panel acceptance exited ${result.code ?? result.signal}`,
    );
  } finally {
    if (
      acceptanceCase === 'member-chat' ||
      (scrapeRoute && scrapeSelection.mode === 'member') ||
      acceptanceCase === 'settings-persistence-member' ||
      acceptanceCase === 'desktop-settings-member'
    )
      await unlink(memberLinkPath);
    if (adminCredentialsCreated) await unlink(adminCredentialsPath);
    if (needsApprovedAdminOrganization) await unlink(approvedAdminOrganizationPath);
  }
}

// Each phase runs under its own fresh resource admission on the same host.
// Setup has no product verdict, and acceptance never installs dependencies.
const phase = process.env.MATRX_HOSTED_PHASE ?? 'acceptance';
assert.ok(
  ['preflight', 'package', 'browser', 'acceptance', 'startup-diagnostic'].includes(phase),
  'invalid hosted phase',
);
const requestedPublishedStoreCrx = process.env.MATRX_HOSTED_PUBLISHED_STORE_CRX;
if (requestedPublishedStoreCrx)
  await requirePublishedStoreCrxTarget(
    requestedPublishedStoreCrx,
    join(repo, 'config/chrome-web-store-approved-baseline.json'),
  );
// Hosted Profile has no durable recovery outside this disposable runner.
// Refuse every direct phase entry before credentials, runtime, or browser setup.
if (process.env.MATRX_HOSTED_ACCEPTANCE_CASE?.startsWith('profile-'))
  throw new Error('hosted_profile_durable_recovery_unavailable');
if (phase === 'preflight') {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'hosted_preflight_runner_required');
  hostedScrapeReloadDiagnostic(
    process.env.MATRX_HOSTED_ACCEPTANCE_CASE,
    process.env.MATRX_SCRAPE_RELOAD_OPEN_DIAGNOSTIC ?? '0',
  );
  hostedSeoMetadataFixture(
    process.env.MATRX_HOSTED_ACCEPTANCE_CASE,
    process.env.MATRX_HOSTED_SEO_CASE_SCOPE ?? 'full',
    process.env.MATRX_HOSTED_SEO_METADATA_FIXTURE ?? 'none',
  );
  hostedSeoResourceDiagnostic(
    process.env.MATRX_HOSTED_ACCEPTANCE_CASE,
    process.env.MATRX_HOSTED_SEO_CASE_SCOPE ?? 'full',
    process.env.MATRX_HOSTED_SEO_METADATA_FIXTURE ?? 'none',
    process.env.MATRX_HOSTED_SEO_RESOURCE_DIAGNOSTIC ?? '0',
  );
  hostedSeoInterruptTarget(
    process.env.MATRX_HOSTED_ACCEPTANCE_CASE,
    process.env.MATRX_HOSTED_SEO_CASE_SCOPE ?? 'full',
    process.env.MATRX_HOSTED_SEO_METADATA_FIXTURE ?? 'none',
    process.env.MATRX_HOSTED_SEO_RESOURCE_DIAGNOSTIC ?? '0',
    process.env.MATRX_HOSTED_SEO_INTERRUPT_AFTER_TARGET ?? 'none',
  );
  hostedDesktopSettingsCase(
    process.env.MATRX_HOSTED_ACCEPTANCE_CASE,
    process.env.MATRX_HOSTED_DESKTOP_SETTINGS_CASE,
  );
  if (process.env.MATRX_HOSTED_ACCEPTANCE_CASE?.startsWith('guest-scrape'))
    scrapeNativeSelection(process.env);
  requireHostedAcceptanceCredential(process.env.MATRX_HOSTED_ACCEPTANCE_CASE, process.env);
  console.log('HOSTED_CREDENTIAL_PREFLIGHT_READY');
  process.exit(0);
}
if (phase === 'acceptance')
  requireHostedAcceptanceCredential(
    process.env.MATRX_HOSTED_ACCEPTANCE_CASE ?? 'guest-chat',
    process.env,
  );
if (phase === 'acceptance')
  hostedSeoResourceDiagnostic(
    process.env.MATRX_HOSTED_ACCEPTANCE_CASE,
    process.env.MATRX_HOSTED_SEO_CASE_SCOPE ?? 'full',
    process.env.MATRX_HOSTED_SEO_METADATA_FIXTURE ?? 'none',
    process.env.MATRX_HOSTED_SEO_RESOURCE_DIAGNOSTIC ?? '0',
  );
if (phase === 'acceptance')
  hostedSeoInterruptTarget(
    process.env.MATRX_HOSTED_ACCEPTANCE_CASE,
    process.env.MATRX_HOSTED_SEO_CASE_SCOPE ?? 'full',
    process.env.MATRX_HOSTED_SEO_METADATA_FIXTURE ?? 'none',
    process.env.MATRX_HOSTED_SEO_RESOURCE_DIAGNOSTIC ?? '0',
    process.env.MATRX_HOSTED_SEO_INTERRUPT_AFTER_TARGET ?? 'none',
  );
assert.ok(process.env.MATRX_RESOURCE_OWNER, 'hosted phase requires owned resource permit');
const runtimeDir = resolve(process.env.MATRX_HOSTED_BROWSER_RUNTIME_DIR ?? '');
assert.ok(process.env.MATRX_HOSTED_BROWSER_RUNTIME_DIR && process.env.PLAYWRIGHT_BROWSERS_PATH);
const packageDir = join(runtimeDir, 'node_modules/playwright-core');
if (phase === 'package') {
  const packages = ['playwright-core@1.56.1'];
  if (
    ['showcase-d47-admin', 'showcase-d47-public-admin'].includes(
      process.env.MATRX_HOSTED_ACCEPTANCE_CASE,
    )
  )
    packages.push(await lockedHostedTypeScript(repo));
  const installed = await ownedProcess('npm', [
    'install',
    '--prefix',
    runtimeDir,
    '--no-save',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    ...packages,
  ]);
  assert.equal(installed.code, 0, 'pinned Playwright core install failed');
}
const runtimePackage = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
assert.equal(runtimePackage.version, '1.56.1', 'runtime version mismatch');
const hostedTypeScriptPath = join(runtimeDir, 'node_modules/typescript/lib/typescript.js');
if (
  ['showcase-d47-admin', 'showcase-d47-public-admin'].includes(
    process.env.MATRX_HOSTED_ACCEPTANCE_CASE,
  )
) {
  const expected = await lockedHostedTypeScript(repo);
  const installed = JSON.parse(
    await readFile(join(runtimeDir, 'node_modules/typescript/package.json'), 'utf8'),
  );
  assert.equal(
    `typescript@npm:${installed.name}@${installed.version}`,
    expected,
    'hosted_typescript_version_mismatch',
  );
  await access(hostedTypeScriptPath);
}
if (phase === 'package') {
  if (
    ['showcase-d47-admin', 'showcase-d47-public-admin'].includes(
      process.env.MATRX_HOSTED_ACCEPTANCE_CASE,
    )
  ) {
    const checked = await ownedProcess(
      process.execPath,
      [
        join(
          repo,
          process.env.MATRX_HOSTED_ACCEPTANCE_CASE === 'showcase-d47-admin'
            ? 'tests/browser/showcase-d47-document-lifecycle.mjs'
            : 'tests/browser/showcase-d47-public-initial-load.mjs',
        ),
      ],
      {
        cwd: repo,
        env: {
          ...process.env,
          MATRX_TYPESCRIPT_MODULE: hostedTypeScriptPath,
          MATRX_D47_IMPORT_PREFLIGHT: '1',
        },
      },
    );
    assert.equal(checked.code, 0, 'hosted_d47_driver_import_failed');
  }
  console.log('HOSTED_PACKAGE_READY', runtimePackage.version);
  process.exit(0);
}
if (phase === 'browser') {
  const browser = await ownedProcess(join(runtimeDir, 'node_modules/.bin/playwright-core'), [
    'install',
    'chromium',
    '--no-shell',
  ]);
  assert.equal(browser.code, 0, 'bundled Chromium install failed');
}
const { chromium } = await import(pathToFileURL(join(packageDir, 'index.mjs')));
await access(chromium.executablePath());
// Playwright writes this only after a complete extraction. Never reuse a partial download.
const browsers = JSON.parse(await readFile(join(packageDir, 'browsers.json'), 'utf8'));
const revision = browsers.browsers.find((browser) => browser.name === 'chromium').revision;
await access(
  join(process.env.PLAYWRIGHT_BROWSERS_PATH, `chromium-${revision}`, 'INSTALLATION_COMPLETE'),
);
console.log('HOSTED_BROWSER_READY', revision, phase);
if (phase === 'browser') process.exit(0);

const artifactDirArg = process.env.MATRX_HOSTED_RELEASE_ARTIFACT_DIR;
const outputDirArg = process.env.MATRX_HOSTED_GUEST_OUTPUT_DIR;
const expectedSha = process.env.MATRX_HOSTED_RELEASE_SHA;
const devRunId = process.env.MATRX_HOSTED_DEV_RUN_ID;
const devArtifactId = process.env.MATRX_HOSTED_DEV_ARTIFACT_ID;
const publishedStoreCrx = Boolean(requestedPublishedStoreCrx);
const releaseMode = Boolean(artifactDirArg && expectedSha && !devRunId && !devArtifactId);
const developmentMode = Boolean(!artifactDirArg && !expectedSha && devRunId && devArtifactId);
if (
  !outputDirArg ||
  [releaseMode, developmentMode, publishedStoreCrx].filter(Boolean).length !== 1
) {
  throw new Error('hosted_guest_configuration_missing');
}
const outputDir = resolve(outputDirArg);
await mkdir(outputDir, { recursive: true });
const prepared = releaseMode
  ? await prepareHostedReleaseArtifact(
      resolve(artifactDirArg),
      outputDir,
      expectedSha,
      process.env.MATRX_HOSTED_ACCEPTANCE_CASE ?? 'guest-chat',
    )
  : developmentMode
    ? await prepareDevelopment(devRunId, devArtifactId)
    : await preparePublishedStoreCrx(outputDir);
if (phase === 'startup-diagnostic') {
  assert.equal(developmentMode, true, 'startup_diagnostic_development_only');
  assert.equal(process.env.MATRX_HOSTED_ACCEPTANCE_CASE, 'startup-resource-diagnostic');
  await runHostedStartupIntervalDiagnostic({
    executable: chromium.executablePath(),
    extensionDir: prepared.extensionDir,
    relocatedReceipt: prepared.relocatedReceipt,
    sourceSha: prepared.sourceSha,
    runId: prepared.runId,
    artifactId: prepared.artifactId,
  });
  process.exit(0);
}
await run(prepared, releaseMode ? 'release' : developmentMode ? 'development' : 'published-crx');
