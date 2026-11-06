/**
 * Compare two secrets without leaking their length. SHA-256 makes both sides
 * 32 bytes, then a full XOR loop compares them in constant time. Empty values
 * never match. No Node crypto import: Workers and Node both provide SubtleCrypto.
 */
export async function secretsEqual(supplied: string, expected: string | undefined): Promise<boolean> {
  if (!supplied || !expected) return false;
  const encode = new TextEncoder();
  const [leftRaw, rightRaw] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode.encode(supplied)),
    crypto.subtle.digest("SHA-256", encode.encode(expected)),
  ]);
  const left = new Uint8Array(leftRaw);
  const right = new Uint8Array(rightRaw);
  if (left.length !== 32 || right.length !== 32) return false;
  let diff = 0;
  for (let i = 0; i < 32; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}
