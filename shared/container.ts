const LETTER_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

export type ContainerNumberValidation =
  | { ok: true; normalized: string }
  | { ok: false; reason: "FORMAT" | "CHECK_DIGIT"; normalized: string };

export function normalizeContainerNumber(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export function iso6346CheckDigit(ownerAndSerial: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const ch = ownerAndSerial[i];
    const value = /[A-Z]/.test(ch) ? LETTER_VALUES[ch] : Number(ch);
    sum += value * 2 ** i;
  }
  const rem = sum % 11;
  return rem === 10 ? 0 : rem;
}

export function validateContainerNumber(raw: string): ContainerNumberValidation {
  const normalized = normalizeContainerNumber(raw);
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(normalized)) {
    return { ok: false, reason: "FORMAT", normalized };
  }
  const expected = iso6346CheckDigit(normalized.slice(0, 10));
  const actual = Number(normalized[10]);
  if (expected !== actual) {
    return { ok: false, reason: "CHECK_DIGIT", normalized };
  }
  return { ok: true, normalized };
}
