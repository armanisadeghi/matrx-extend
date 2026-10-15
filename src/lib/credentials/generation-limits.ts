import type { PanelActionAdmission } from '@/features/vault/usePanelAdmission';
import { resolveKnob } from '@/lib/config/knob-resolve';
import type { CredentialGenerationLimits } from '@ai-matrx/kit/credential-generator';

export const VAULT_GENERATOR_FEATURE = 'vault.generator';
export const MAX_PASSWORD_LENGTH_KEY = 'max_password_length';
export const MAX_PASSPHRASE_WORDS_KEY = 'max_passphrase_words';

const MIN_PASSWORD_LENGTH = 24;
const MAX_PASSWORD_LENGTH = 65_536;
const MIN_PASSPHRASE_WORDS = 6;
const MAX_PASSPHRASE_WORDS = 4_096;

export type GeneratedCredentialLimitsResult =
  | { ok: true; limits: CredentialGenerationLimits }
  | { ok: false; reason: 'configuration_unavailable' | 'admission_lost' };

/**
 * The feature knobs are the sole source for the generator's ceilings. Keeping
 * this resolver separate from the panel makes an unreadable or malformed
 * organization configuration an honest refusal instead of an implicit policy.
 */
export async function resolveGeneratedCredentialLimits(
  actor: { userId: string; organizationId: string } | null,
  admission: PanelActionAdmission,
): Promise<GeneratedCredentialLimitsResult> {
  if (!actor || !admission.current()) return { ok: false, reason: 'admission_lost' };

  const resolved = await admission.run(async () => {
    const [password, passphrase] = await Promise.all([
      resolveKnob({
        feature: VAULT_GENERATOR_FEATURE,
        key: MAX_PASSWORD_LENGTH_KEY,
        organizationId: actor.organizationId,
        userId: actor.userId,
      }),
      resolveKnob({
        feature: VAULT_GENERATOR_FEATURE,
        key: MAX_PASSPHRASE_WORDS_KEY,
        organizationId: actor.organizationId,
        userId: actor.userId,
      }),
    ]);
    if (!admission.current() || password.error || passphrase.error) return null;
    if (
      !isWholeIntegerIn(password.data, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH) ||
      !isWholeIntegerIn(passphrase.data, MIN_PASSPHRASE_WORDS, MAX_PASSPHRASE_WORDS)
    )
      return null;
    return {
      maxPasswordLength: password.data,
      maxPassphraseWords: passphrase.data,
    };
  });

  if (!admission.current()) return { ok: false, reason: 'admission_lost' };
  return resolved
    ? { ok: true, limits: resolved }
    : { ok: false, reason: 'configuration_unavailable' };
}

function isWholeIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
