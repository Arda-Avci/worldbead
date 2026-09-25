/**
 * WorldBead localization. Turkish is the default when the device's language
 * starts with 'tr' (see `detectLang` below), English otherwise — per the
 * owner's request, no i18n library and no in-game language switcher.
 * All user-facing strings live here (or, for the small set of strings that
 * need runtime interpolation, as functions here) so every UI/tutorial/fact
 * string has exactly one place to translate.
 */
import type { PlanetId } from '../game/planets';
import type { PowerId } from '../game/unlocks';

export type Lang = 'en' | 'tr';

/**
 * Detects the device's language, not just the browser's reported single
 * locale: `navigator.languages[0]` (Capacitor's WebView reflects the
 * phone/OS language setting there) is preferred, falling back to
 * `navigator.language` when `languages` is unavailable. English otherwise —
 * no hard-coded English string exists outside this fallback.
 */
function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'en';
  const primary = navigator.languages?.[0] ?? navigator.language;
  return primary?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export const LANG: Lang = detectLang();

function pick<T>(en: T, tr: T): T {
  return LANG === 'tr' ? tr : en;
}

export const PLANET_NAMES: Record<PlanetId, string> = {
  earth: pick('Earth', 'Dünya'),
  moon: pick('Moon', 'Ay'),
  venus: pick('Venus', 'Venüs'),
  mars: pick('Mars', 'Mars'),
  jupiter: pick('Jupiter', 'Jüpiter'),
};

export const POWER_NAMES: Record<PowerId, string> = {
  meteor: pick('Meteor', 'Meteor'),
  prism: pick('Prism', 'Prizma'),
  solarFlare: pick('Solar Flare', 'Güneş Patlaması'),
  comet: pick('Comet', 'Kuyruklu Yıldız'),
};

export const S = {
  // ---------------------------------------------------------------- HUD
  level: (n: number) => pick(`Level ${n}`, `Seviye ${n}`),
  loading: (planet: string) => pick(`Loading ${planet}`, `${planet} yükleniyor`),
  settingsAria: pick('Settings', 'Ayarlar'),
  currentProbeAria: pick('Current probe', 'Aktif mermi'),
  swapProbeAria: pick('Swap probe', 'Mermileri değiştir'),
  planetProgressAria: pick('Planet progress', 'Gezegen ilerlemesi'),
  lockedLevel: (n: number) => pick(`Lv ${n}`, `Sv ${n}`),
  nextPlanetIn: (planet: string, levels: number) =>
    pick(`Next planet: ${planet} — ${levels} level${levels === 1 ? '' : 's'}`, `Sıradaki gezegen: ${planet} — ${levels} seviye`),

  // ------------------------------------------------------------- toasts
  purchased: pick('Purchased!', 'Satın alındı!'),
  notEnoughStardust: pick('Not enough stardust', 'Yeterli yıldız tozu yok'),
  bonusPower: (name: string) => pick(`Bonus power: ${name}!`, `Bonus güç: ${name}!`),
  megaPop: (n: number) => pick(`MEGA POP ×${n}`, `MEGA POP ×${n}`),

  // ------------------------------------------------------ level complete
  levelComplete: pick('Level Complete', 'Seviye Tamamlandı'),
  planetComplete: pick('Planet Complete', 'Gezegen Tamamlandı'),
  didYouKnow: pick('Did you know?', 'Biliyor muydunuz?'),
  nextStop: (planet: string) => pick(`Next stop: `, `Sıradaki durak: `) + planet,
  continueLabel: pick('Continue', 'Devam Et'),
  nextLevel: pick('Next Level', 'Sonraki Seviye'),

  // -------------------------------------------------------- level failed
  outOfProbes: pick('Out of Probes', 'Mermi Kalmadı'),
  beadsLeft: pick('Beads left', 'Kalan boncuk'),
  retry: pick('Retry', 'Tekrar Dene'),

  // ------------------------------------------------------------- unlocks
  welcomeTo: (planet: string) => pick(`Welcome to ${planet}`, `${planet}'e hoş geldin`),
  tryIt: pick('Try it', 'Dene'),
  unlockName: {
    swap: pick('Swap Unlocked', 'Değiştirme Açıldı'),
    meteor: pick('Meteor Unlocked', 'Meteor Açıldı'),
    prism: pick('Prism Unlocked', 'Prizma Açıldı'),
    solarFlare: pick('Solar Flare Unlocked', 'Güneş Patlaması Açıldı'),
    comet: pick('Comet Unlocked', 'Kuyruklu Yıldız Açıldı'),
    cloudLayer: pick('Cloud Layer', 'Bulut Katmanı'),
    newLayer: pick('New Layer', 'Yeni Katman'),
    autoSpin: pick('The World Turns', 'Dünya Dönüyor'),
    cloudDrift: pick('Drifting Clouds', 'Sürüklenen Bulutlar'),
  },
  unlockDescription: {
    swap: pick('Swap your current and next probe colors.', 'Aktif ve sıradaki mermi renklerini değiştir.'),
    meteor: pick('Pops every bead within a radius of the impact point, any color.', 'Çarpma noktasının çevresindeki tüm boncukları, renk fark etmeksizin patlatır.'),
    prism: pick('Your next probe matches any color.', 'Sıradaki mermin her renge uyar.'),
    solarFlare: pick('Pops all visible-hemisphere beads of the current probe color.', 'Görünen yarımküredeki aktif mermi renkli tüm boncukları patlatır.'),
    comet: pick('Pops a band along a great circle chosen by a swipe.', 'Kaydırarak seçtiğin bir çember boyunca bir bant patlatır.'),
    cloudLayer: pick('Clouds now cover the surface. Pop through them to reach the beads beneath.', 'Artık bulutlar yüzeyi kaplıyor. Altındaki boncuklara ulaşmak için onları patlat.'),
    newLayer: pick('The globe now has an extra outer layer. Clear it to reach the finer beads underneath.', 'Küre artık ekstra bir dış katmana sahip. Altındaki daha ince boncuklara ulaşmak için onu temizle.'),
    autoSpin: pick('The globe now keeps turning on its own. Dragging still works — just push through it.', 'Küre artık kendi kendine dönmeye başladı. Sürüklemek hâlâ işe yarar — sadece biraz daha zorlanacaksın.'),
    cloudDrift: pick('These clouds now drift on their own, sliding over the beads and blocking shots until they move on — or you pop them.', 'Bu bulutlar artık kendi kendine sürükleniyor, boncukların üzerinde kayıyor ve geçene ya da onları patlatana kadar atışları engelliyor.'),
  },

  // ------------------------------------------------------------ tutorial
  tutorial: {
    fire: pick('Tap the glowing region to pop it.', 'Parlayan bölgeye dokunarak patlat.'),
    rotate: pick('Drag to rotate the world.', 'Dünyayı döndürmek için sürükle.'),
    swap: pick('Tap swap to switch probes.', 'Mermileri değiştirmek için değiştir düğmesine dokun.'),
    meteorArm: pick('Tap Meteor to arm it.', 'Meteoru hazırlamak için dokun.'),
    meteorUse: pick('Tap the globe to strike.', 'Vurmak için gezegene dokun.'),
    prismArm: pick('Tap Prism to arm it.', 'Prizmayı hazırlamak için dokun.'),
    prismUse: pick('Now pop any region.', 'Şimdi istediğin bir bölgeyi patlat.'),
    solarFlareUse: pick('Tap Solar Flare.', 'Güneş Patlamasına dokun.'),
    cloudLayer: pick('Clouds now cover the surface. Pop a cloud region.', 'Artık bulutlar yüzeyi kaplıyor. Bir bulut bölgesini patlat.'),
    newLayer: pick('Pop the outer layer first to reach what is underneath.', 'Altındakine ulaşmak için önce dış katmanı patlat.'),
    autoSpin: pick('Drag to rotate the world — even while it turns on its own.', 'Kendi kendine dönerken bile dünyayı döndürmek için sürükle.'),
    cometArm: pick('Tap Comet to arm it.', 'Kuyruklu yıldızı hazırlamak için dokun.'),
    cometUse: pick('Swipe across the world.', 'Dünyanın üzerinde kaydır.'),
    cloudDrift: pick('Wait for a gap, or pop through the drifting clouds.', 'Bir boşluk bekle ya da sürüklenen bulutları patlatarak geç.'),
  },
  spinTiltNotice: pick('The world can now spin on tilted axes, not just side to side.', 'Dünya artık sadece yatay değil, eğik eksenlerde de dönebiliyor.'),
  spinReverseNotice: pick('The world may now reverse direction as it spins.', 'Dünya artık dönerken yön değiştirebiliyor.'),

  // -------------------------------------------------------------- settings
  settingsTitle: pick('Settings', 'Ayarlar'),
  sound: pick('Sound', 'Ses'),
  music: pick('Music', 'Müzik'),
  haptics: pick('Haptics', 'Titreşim'),
  replayIntro: pick('Replay intro', 'Girişi tekrar oynat'),
  closeSettingsAria: pick('Close settings', 'Ayarları kapat'),
  credits: pick(
    'Planet textures © Solar System Scope (solarsystemscope.com), CC BY 4.0, based on NASA imagery.',
    'Gezegen dokuları © Solar System Scope (solarsystemscope.com), CC BY 4.0, NASA görüntülerine dayanmaktadır.',
  ),

  // ----------------------------------------------------------------- intro
  titleBeat1: pick('4.5 billion years in the making.', '4,5 milyar yılda oluştu.'),
  titleBeat2: pick('Every world is made of countless pieces.', 'Her dünya sayısız parçadan oluşur.'),
  logoSub: pick('Pop the Planets', 'Gezegenleri Patlat'),
  tapToBegin: pick('Tap to begin', 'Başlamak için dokun'),
  skip: pick('Skip', 'Geç'),
} as const;
