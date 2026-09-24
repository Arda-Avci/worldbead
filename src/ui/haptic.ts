/** Thin wrapper around the Vibration API, gated by a settings toggle the game controls. */

const PATTERNS: Record<'light' | 'medium' | 'heavy', number | number[]> = {
  light: 10,
  medium: 22,
  heavy: [16, 30, 16],
};

let enabled = true;

/** Call from `onSettingsChanged` (or on load) to mirror the player's haptics toggle. */
export function setHapticsEnabled(v: boolean): void {
  enabled = v;
}

/** Fire a short vibration. No-ops silently when disabled or unsupported (desktop, iOS Safari). */
export function haptic(kind: 'light' | 'medium' | 'heavy'): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    /* unsupported */
  }
}
