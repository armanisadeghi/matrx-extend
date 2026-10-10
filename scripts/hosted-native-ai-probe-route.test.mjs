import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostedAcceptanceRoute } from './hosted-acceptance-route.mjs';
import { hostedNativeAiProbeRoute } from './hosted-native-ai-probe-route.mjs';
import { requireHostedAcceptanceCredential } from './hosted-profile-route.mjs';

const prepared = {
  kind: 'ci_development_test',
  sourceSha: 'a'.repeat(40),
  runId: 38053849002,
  artifactId: 123456,
  extensionDir: '/private/artifact/chrome-mv3',
  relocatedReceipt: '/private/artifact/local-dev-receipt.json',
};

test('native AI probe routes only an exact CI artifact to the diagnostic driver', () => {
  assert.equal(
    hostedAcceptanceRoute('native-ai-member-probe', 'development', prepared).acceptanceCase,
    'native-ai-member-probe',
  );
  const route = hostedNativeAiProbeRoute('native-ai-member-probe', prepared);
  assert.equal(route.driver, 'tests/browser/native-ai-member-probe.mjs');
  assert.deepEqual(route.env, {
    MATRX_NATIVE_AI_EXTENSION_DIR: prepared.extensionDir,
    MATRX_NATIVE_AI_RECEIPT: prepared.relocatedReceipt,
    MATRX_NATIVE_AI_SOURCE_SHA: prepared.sourceSha,
    MATRX_NATIVE_AI_CI_RUN_ID: String(prepared.runId),
    MATRX_NATIVE_AI_CI_ARTIFACT_ID: String(prepared.artifactId),
  });
  for (const changed of [
    { kind: 'published_store_zip_adapted' },
    { sourceSha: 'invalid' },
    { runId: 0 },
    { artifactId: null },
    { extensionDir: 'relative/path' },
    { relocatedReceipt: 'relative/path' },
  ])
    assert.throws(() =>
      hostedNativeAiProbeRoute('native-ai-member-probe', { ...prepared, ...changed }),
    );
  assert.throws(
    () => hostedNativeAiProbeRoute('guest-chat', prepared),
    /native_ai_probe_case_refused/,
  );
});

test('native AI member probe refuses missing or invalid member credential before browser setup', () => {
  assert.throws(
    () => requireHostedAcceptanceCredential('native-ai-member-probe', {}),
    /hosted_member_link_secret_required/,
  );
  assert.throws(
    () =>
      requireHostedAcceptanceCredential('native-ai-member-probe', {
        MATRX_HOSTED_MEMBER_LINK_JSON: JSON.stringify({
          email: 'admin@admin.com',
          action_link: 'https://www.aimatrx.com/auth/confirm?type=magiclink&token_hash=invalid',
        }),
      }),
    /d87_member_fingerprint_mismatch/,
  );
});
