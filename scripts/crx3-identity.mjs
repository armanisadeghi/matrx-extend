import { createHash } from 'node:crypto';

function fields(bytes) {
  let cursor = 0;
  function varint() {
    let value = 0;
    let shift = 0;
    while (cursor < bytes.length && shift <= 28) {
      const byte = bytes[cursor++];
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return value;
      shift += 7;
    }
    throw new Error('crx3_varint_invalid');
  }
  const result = [];
  while (cursor < bytes.length) {
    const tag = varint();
    const wire = tag & 7;
    if (wire !== 2) throw new Error('crx3_header_wire_refused');
    const length = varint();
    if (length <= 0 || cursor + length > bytes.length)
      throw new Error('crx3_header_length_refused');
    result.push({ number: Math.floor(tag / 8), bytes: bytes.subarray(cursor, cursor + length) });
    cursor += length;
  }
  return result;
}

export function extensionIdFromPublicKey(key) {
  const hex = createHash('sha256').update(key).digest('hex').slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join('');
}

export function matchingCrx3RsaKey(crx, expectedId) {
  if (crx.toString('ascii', 0, 4) !== 'Cr24' || crx.readUInt32LE(4) !== 3)
    throw new Error('crx3_magic_or_version_refused');
  const headerLength = crx.readUInt32LE(8);
  if (headerLength < 1 || 12 + headerLength >= crx.length)
    throw new Error('crx3_header_length_refused');
  const header = crx.subarray(12, 12 + headerLength);
  const proofs = fields(header).filter(({ number }) => number === 2);
  const matching = proofs
    .map(({ bytes }) => fields(bytes).find(({ number }) => number === 1)?.bytes)
    .filter((key) => key && extensionIdFromPublicKey(key) === expectedId);
  if (matching.length !== 1) throw new Error('crx3_expected_signing_key_refused');
  return matching[0];
}
