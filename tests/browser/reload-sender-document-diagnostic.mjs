import { randomUUID } from 'node:crypto';

// Diagnostic only: hold extension/artifact/gesture path constant and replace
// the owned sender document before its first post-reload open request.
export async function prepareReloadSenderDocument(page, evidence) {
  if (!evidence.refresh_requested) return;
  const marker = randomUUID();
  const previousUrl = await page.evaluate((value) => {
    globalThis.__matrxReloadSenderDocument = value;
    return location.href;
  }, marker);
  await page.reload({ waitUntil: 'domcontentloaded' });
  evidence.refresh_completed = true;
  const observed = await page.evaluate(
    ({ marker, previousUrl }) => ({
      new_document_observed: globalThis.__matrxReloadSenderDocument !== marker,
      same_url_observed: location.href === previousUrl,
    }),
    { marker, previousUrl },
  );
  evidence.new_document_observed = observed.new_document_observed === true;
  evidence.same_url_observed = observed.same_url_observed === true;
  if (!evidence.new_document_observed || !evidence.same_url_observed)
    throw new Error('native_reload_sender_document_refresh_unverified');
}
