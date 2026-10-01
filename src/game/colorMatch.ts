/**
 * Perceptual "same color" test for probe vs. bead. Palettes are built so different classes stay
 * visibly apart, but near-white classes (pale outer layers, clouds) can differ by only a few
 * hex steps while looking identical — the player taps a bead that matches the probe by eye and
 * an exact-hex compare rejects it. Two colors closer than `SAME_COLOR_DELTA_E` (CIE76) count as one.
 */
export const SAME_COLOR_DELTA_E = 5;
/**
 * Pale colors (both Lab L above `PALE_L`) are lit almost to white on the glossy beads and are
 * indistinguishable by eye at much larger distances (measured live: ffffff vs d7dee8 = ΔE 13,
 * f0e7d4 vs e1cdb1 = ΔE 11), so they get a wider window.
 */
export const PALE_DELTA_E = 15;
const PALE_L = 78;

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
  const limit = la[0] > PALE_L && lb[0] > PALE_L ? PALE_DELTA_E : SAME_COLOR_DELTA_E;
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]) < limit;
}
