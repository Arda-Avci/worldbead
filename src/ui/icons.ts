/**
 * Inline SVG icon library for WorldBead's UI. Every icon is a self-contained
 * `<svg>` string sized on a 24x24 grid so it scales cleanly at any button size.
 * Icons are decorative by default (aria-hidden) — the interactive element that
 * hosts them is responsible for its own aria-label.
 */

type IconName =
  | 'stardust'
  | 'probe'
  | 'swap'
  | 'gear'
  | 'lock'
  | 'star'
  | 'starOutline'
  | 'meteor'
  | 'prism'
  | 'solarFlare'
  | 'comet'
  | 'sound'
  | 'soundOff'
  | 'music'
  | 'musicOff'
  | 'haptics'
  | 'hapticsOff'
  | 'close'
  | 'check'
  | 'hand'
  | 'chevron'
  | 'ship';

function svg(inner: string, viewBox = '0 0 24 24'): string {
  // stroke-width defaults to 0 at the root so shapes that don't set their own
  // stroke-width (solid fills) never pick up a stray 1px outline from the
  // inherited `stroke="currentColor"` below; paths that draw an outline set
  // their own stroke-width, which overrides this default for that element.
  return `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false" stroke="currentColor" stroke-width="0">${inner}</svg>`;
}

const ICONS: Record<IconName, string> = {
  stardust: svg(
    '<path d="M12 2.5c.6 3.4 1.2 5.4 2.4 6.6 1.2 1.2 3.2 1.8 6.6 2.4-3.4.6-5.4 1.2-6.6 2.4-1.2 1.2-1.8 3.2-2.4 6.6-.6-3.4-1.2-5.4-2.4-6.6-1.2-1.2-3.2-1.8-6.6-2.4 3.4-.6 5.4-1.2 6.6-2.4 1.2-1.2 1.8-3.2 2.4-6.6z"/>' +
      '<circle cx="19.5" cy="19" r="1.3"/><circle cx="4.6" cy="5.2" r="1"/>',
  ),
  probe: svg(
    '<path d="M12 3c1.6 2.6 2.6 5.2 2.6 8 0 1.7-.5 3-1.1 4.2l1.9 4.4a.9.9 0 0 1-1.2 1.2l-1.9-1a3.6 3.6 0 0 1-4.6 0l-1.9 1a.9.9 0 0 1-1.2-1.2l1.9-4.4A8.6 8.6 0 0 1 5.4 11c0-2.8 1-5.4 2.6-8" fill="none" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="12" cy="10.6" r="2.1"/>',
  ),
  swap: svg(
    '<path d="M6 8h10l-2.4-2.4a1 1 0 1 1 1.4-1.4l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 0 1-1.4-1.4L16 10H6a1 1 0 0 1 0-2z"/>' +
      '<path d="M18 16H8l2.4 2.4a1 1 0 1 1-1.4 1.4l-4-4a1 1 0 0 1 0-1.4l4-4a1 1 0 1 1 1.4 1.4L8 14h10a1 1 0 0 1 0 2z"/>',
  ),
  gear: svg(
    '<path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z" fill="none" stroke-width="1.7"/>' +
      '<path d="M12 2.6c.5 0 1 .3 1.1.9l.3 1.6c.6.2 1.2.4 1.7.7l1.4-.9c.5-.3 1.1-.2 1.4.2l1 1c.4.4.5 1 .2 1.4l-.9 1.4c.3.5.5 1.1.7 1.7l1.6.3c.5.1.9.6.9 1.1v1.4c0 .5-.4 1-.9 1.1l-1.6.3a7.3 7.3 0 0 1-.7 1.7l.9 1.4c.3.5.2 1.1-.2 1.4l-1 1c-.4.4-1 .5-1.4.2l-1.4-.9c-.5.3-1.1.5-1.7.7l-.3 1.6c-.1.5-.6.9-1.1.9h-1.4c-.5 0-1-.4-1.1-.9l-.3-1.6a7.3 7.3 0 0 1-1.7-.7l-1.4.9c-.5.3-1.1.2-1.4-.2l-1-1c-.4-.4-.5-1-.2-1.4l.9-1.4a7.3 7.3 0 0 1-.7-1.7l-1.6-.3c-.5-.1-.9-.6-.9-1.1v-1.4c0-.5.4-1 .9-1.1l1.6-.3c.2-.6.4-1.2.7-1.7l-.9-1.4c-.3-.5-.2-1.1.2-1.4l1-1c.4-.4 1-.5 1.4-.2l1.4.9c.5-.3 1.1-.5 1.7-.7l.3-1.6c.1-.5.6-.9 1.1-.9z" fill="none" stroke-width="1.3" stroke-linejoin="round"/>',
  ),
  lock: svg(
    '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2" fill="currentColor"/>' +
      '<path d="M8 10.5V8a4 4 0 1 1 8 0v2.5" fill="none" stroke-width="1.7"/>' +
      '<circle cx="12" cy="15" r="1.4" fill="#0b0f1e"/>',
  ),
  star: svg('<path d="M12 2.6l2.7 6 6.5.6-4.9 4.4 1.5 6.4L12 16.8l-5.8 3.2 1.5-6.4-4.9-4.4 6.5-.6z"/>'),
  starOutline: svg(
    '<path d="M12 2.6l2.7 6 6.5.6-4.9 4.4 1.5 6.4L12 16.8l-5.8 3.2 1.5-6.4-4.9-4.4 6.5-.6z" fill="none" stroke-width="1.4" stroke-linejoin="round"/>',
  ),
  meteor: svg(
    '<path d="M20.5 3.5c-4.4.4-9 2-12.3 5.3S3.9 16.1 3.5 20.5c4.4-.4 9-2 12.3-5.3s4.9-7.3 5.3-12.3z" fill="none" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="9.2" cy="14.8" r="2.6"/>' +
      '<path d="M14 5.5l2 2M17 8.5l1.6 1.6" stroke-width="1.4" stroke-linecap="round"/>',
  ),
  prism: svg(
    '<path d="M12 3.5l8 13.2H4z" fill="none" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M8.2 12.4h7.6M12 3.5v13.2" stroke-width="1" opacity="0.7"/>' +
      '<path d="M4.5 19.5h3M9 19.5h3M13.5 19.5h3M18 19.5h1.5" stroke-width="1.6" stroke-linecap="round"/>',
  ),
  solarFlare: svg(
    '<circle cx="12" cy="12" r="4.4"/>' +
      '<g stroke-width="1.8" stroke-linecap="round">' +
      '<path d="M12 2.2v3.4M12 18.4v3.4M21.8 12h-3.4M5.6 12H2.2"/>' +
      '<path d="M18.6 5.4l-2.4 2.4M7.8 16.2l-2.4 2.4M18.6 18.6l-2.4-2.4M7.8 7.8L5.4 5.4"/>' +
      '</g>',
  ),
  comet: svg(
    '<circle cx="16.5" cy="7.5" r="3.1"/>' +
      '<path d="M14.6 9.4 3.5 20.5" stroke-width="2.2" stroke-linecap="round" opacity="0.85"/>' +
      '<path d="M12.2 11.8 7 17" stroke-width="1.3" stroke-linecap="round" opacity="0.5"/>',
  ),
  sound: svg(
    '<path d="M4 9.5h3.4L12 6v12l-4.6-3.5H4z"/>' +
      '<path d="M16 8.5a5 5 0 0 1 0 7M18.6 6a8.6 8.6 0 0 1 0 12" fill="none" stroke-width="1.7" stroke-linecap="round"/>',
  ),
  soundOff: svg(
    '<path d="M4 9.5h3.4L12 6v12l-4.6-3.5H4z"/>' +
      '<path d="M16.5 9.5l4.5 5M21 9.5l-4.5 5" stroke-width="1.8" stroke-linecap="round"/>',
  ),
  music: svg(
    '<circle cx="7.2" cy="18" r="2.4"/><circle cx="16.8" cy="16" r="2.4"/>' +
      '<path d="M9.6 18V6.6L19.2 4.6V16" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  musicOff: svg(
    '<circle cx="7.2" cy="18" r="2.4"/><circle cx="16.8" cy="16" r="2.4"/>' +
      '<path d="M9.6 18V6.6L19.2 4.6V16" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>' +
      '<path d="M3.5 3.5l17 17" stroke-width="1.8" stroke-linecap="round"/>',
  ),
  haptics: svg(
    '<rect x="7" y="2.5" width="10" height="19" rx="2.2" fill="none" stroke-width="1.6"/>' +
      '<path d="M2.6 9v6M21.4 9v6M4.8 7v10M19.2 7v10" stroke-width="1.5" stroke-linecap="round" opacity="0.8"/>',
  ),
  hapticsOff: svg(
    '<rect x="7" y="2.5" width="10" height="19" rx="2.2" fill="none" stroke-width="1.6" opacity="0.5"/>' +
      '<path d="M3.5 3.5l17 17" stroke-width="1.8" stroke-linecap="round"/>',
  ),
  close: svg('<path d="M6 6l12 12M18 6L6 18" stroke-width="2" stroke-linecap="round"/>'),
  check: svg('<path d="M4.5 12.5l4.8 4.8L19.5 6.5" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  hand: svg(
    '<path d="M9.5 12.5V5.2a1.4 1.4 0 0 1 2.8 0v6" fill="none" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M12.3 11.3V4.4a1.4 1.4 0 0 1 2.8 0v7" fill="none" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M15.1 11.7V6.2a1.4 1.4 0 0 1 2.8 0v9.3" fill="none" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M6.7 14.8V10a1.4 1.4 0 0 1 2.8 0v3.3" fill="none" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M6.7 14.8c0 4 2.6 6.7 6.4 6.7 3.7 0 6.6-2 6.6-6V10.1" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  chevron: svg('<path d="M9 6l6 6-6 6" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  ship: svg(
    '<path d="M2.5 14.5c1.8 2.2 5.4 3.6 9.5 3.6s7.7-1.4 9.5-3.6c-1.8-1.1-5.4-1.8-9.5-1.8s-7.7.7-9.5 1.8z"/>' +
      '<path d="M9 12.8c0-2.6 1.3-4.6 3-4.6s3 2 3 4.6" fill="none" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle cx="12" cy="16" r="1.3" fill="#0b0f1e"/>',
  ),
};

export function icon(name: IconName): string {
  return ICONS[name];
}

export type { IconName };
