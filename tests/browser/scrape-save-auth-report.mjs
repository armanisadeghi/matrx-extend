import { mkdir, writeFile } from 'node:fs/promises';
import { memberAuthFailureReport } from './settings-member-auth-diagnostic.mjs';

export function recordScrapeMemberAuthFailure(report, error) {
  report.auth_failure = memberAuthFailureReport(error, report.auth_stage);
}

export function safeScrapeSaveFailureCode(error) {
  const candidate = String(error?.message ?? 'native_acceptance_error').split(/[:\n]/, 1)[0];
  return /^[a-z][a-z0-9_-]{1,100}$/.test(candidate) ? candidate : 'native_acceptance_error';
}

export function recordScrapeSaveFailure(report, error) {
  report.status = 'fail';
  report.failure_stage = report.stage;
  report.error_code = safeScrapeSaveFailureCode(error);
  return `SCRAPE_SAVE_NATIVE_ACCEPTANCE_FAILED ${report.stage} ${report.error_code}\n`;
}

export async function writeScrapeSaveReport(report, outputDir = 'test-results') {
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    `${outputDir}/scrape-save-native-acceptance.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
}
