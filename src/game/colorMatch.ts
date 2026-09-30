/**
 * Perceptual "same color" test for probe vs. bead. Palettes are built so different classes stay
 * visibly apart, but near-white classes (pale outer layers, clouds) can differ by only a few
 * hex steps while looking identical — the player taps a bead that matches the probe by eye and
 * an exact-hex compare rejects it. Two colors closer than `SAME_COLOR_DELTA_E` (CIE76) count as one.
 */
export const SAME_COLOR_DELTA_E = 5;

function lab(hex: number): [number, number, number] {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const r = lin(((hex >> 16) & 255) / 255), g = lin(((hex >> 8) & 255) / 255), b = lin((hex & 255) / 255);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function colorsMatch(a: number, b: number): boolean {
  if (a === b) return true;
  const la = lab(a), lb = lab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]) < SAME_COLOR_DELTA_E;
}
