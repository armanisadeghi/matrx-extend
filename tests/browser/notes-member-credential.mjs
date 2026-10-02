import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export class PrivateCredentialError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PrivateCredentialError';
    this.code = code;
  }
}

export async function readMemberCredential(path, expectedFingerprint) {
  if (!path) throw new PrivateCredentialError('member_credential_path_required');
  if (!/^[a-f0-9]{16}$/.test(expectedFingerprint ?? ''))
    throw new PrivateCredentialError('member_identity_fingerprint_missing');
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid())
      throw new PrivateCredentialError('member_credential_not_private');
    const source = await handle.readFile('utf8');
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new PrivateCredentialError('member_credential_invalid');
    }
    if (
      !parsed ||
      Array.isArray(parsed) ||
      typeof parsed !== 'object' ||
      Object.keys(parsed).sort().join(',') !== 'email,password' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.password !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email) ||
      !parsed.password
    )
      throw new PrivateCredentialError('member_credential_invalid');
    const email = parsed.email.toLowerCase();
    const fingerprint = createHash('sha256').update(email).digest('hex').slice(0, 16);
    if (fingerprint !== expectedFingerprint)
      throw new PrivateCredentialError('member_credential_identity_mismatch');
    return { email: parsed.email, password: parsed.password, fingerprint };
  } catch (error) {
    if (error instanceof PrivateCredentialError) throw error;
    throw new PrivateCredentialError('member_credential_unavailable');
  } finally {
    await handle?.close();
  }
}
