import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Class guard: deleting a whole Vault login (`removeVaultItem`) is a
 * server-side SOFT delete (`delete_credential_item` in
 * aidream/packages/matrx-orm/matrx_orm/secrets_battery/items.py — "Soft-delete
 * the item, all its fields, and drop its grants... ciphertext is recoverable
 * until purge") with a real restore path exposed to the user at
 * matrx-frontend's /trash page (`features/trash/VaultTrashRestoreDialog.tsx`).
 * The extension itself has no restore control, so the honest sentence is the
 * same hedge already used by `HighlightView.tsx` for the same shape (soft
 * delete, restorable elsewhere, not from the extension): "cannot be undone
 * from the extension" — never a flat, false "This cannot be undone."
 *
 * Removing a single FIELD (`removeVaultField`) is a genuinely different case:
 * `delete_credential_field` soft-deletes the row but records no recovery
 * manifest, and the Trash page only lists whole credential items (by
 * `fields_count`, not individual fields) — there is no restore path for a
 * lone field, so its flat "This cannot be undone." stays honest and this
 * guard must not flag it.
 */

const SOURCE = readFileSync(join(__dirname, '../VaultView.tsx'), 'utf8');

describe('Vault delete confirm honesty (VaultView.tsx)', () => {
  it('never claims the whole-login delete flatly cannot be undone', () => {
    // The old, false wording ended the sentence right after "shared with."
    expect(SOURCE).not.toMatch(/for everyone it is shared with\. This cannot be undone\.`/);
  });

  it('names the extension-only scope and the Trash restore path for the login delete', () => {
    expect(SOURCE).toMatch(/This cannot be undone from the extension/);
    expect(SOURCE).toMatch(/restored from the AI Matrx Trash/);
  });

  it('leaves the single-field delete (no restore path exists) as a real cannot-be-undone', () => {
    expect(SOURCE).toMatch(/for everyone this login is shared with\. This cannot be undone\./);
  });
});
