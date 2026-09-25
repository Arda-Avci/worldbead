/** Real, verifiable, NASA-level facts shown on the win/fact card, per GDD §4/§5. */
import type { PlanetId } from './planets';
import { LANG } from '../ui/strings';

const FACTS_EN: Record<PlanetId, string[]> = {
  earth: [
    'Earth is the third planet from the Sun and the only known world with liquid water on its surface.',
    "Earth's equatorial radius is about 6,371 km.",
    'A day on Earth (one full rotation) is 24 hours.',
    'Earth orbits the Sun once every 365.25 days.',
    'About 71% of the surface is covered by ocean.',
    'Earth has one natural satellite: the Moon.',
    'The atmosphere is roughly 78% nitrogen and 21% oxygen.',
    'Average surface gravity is 9.8 m/s².',
    "Earth's average distance from the Sun is about 150 million km (1 AU).",
    'Average global surface temperature is about 15°C (59°F).',
    "Earth's core is mostly solid iron surrounded by a liquid outer core of iron and nickel.",
  ],
  moon: [
    "The Moon is Earth's only natural satellite.",
    'The Moon has no significant atmosphere.',
    'Its radius is about 1,737 km, roughly a quarter of Earth\'s.',
    'It takes about 27.3 days to orbit Earth once.',
    "The Moon is tidally locked, so the same side always faces Earth.",
    'Surface gravity is about 1.6 m/s², roughly one-sixth of Earth\'s.',
    'Daytime temperatures can reach about 127°C, and nighttime lows about -173°C.',
    'The Moon is about 384,400 km from Earth on average.',
    "The dark plains visible from Earth are called maria, ancient basaltic lava flows.",
    'Twelve astronauts have walked on the Moon, during the Apollo missions of 1969-1972.',
    "The Moon is slowly drifting away from Earth, by about 3.8 cm per year.",
  ],
  venus: [
    'Venus is the second planet from the Sun.',
    "Venus is the hottest planet in the Solar System, with a surface temperature around 465°C.",
    "A thick atmosphere of carbon dioxide traps heat in a runaway greenhouse effect.",
    "Surface pressure is about 92 times that of Earth, similar to the deep ocean.",
    "Venus rotates backwards (retrograde) compared to most other planets.",
    'A single Venusian day (one rotation) lasts longer than its year: about 243 Earth days.',
    "Venus's radius is about 6,052 km, close to Earth's size.",
    "It orbits the Sun once every 225 Earth days.",
    'Venus has no moons.',
    "The clouds are made of sulfuric acid droplets.",
    "Venus is the brightest natural object in Earth's night sky after the Moon.",
  ],
  mars: [
    'Mars is the fourth planet from the Sun, known as the Red Planet.',
    'Its reddish color comes from iron oxide (rust) covering much of the surface.',
    "Mars has a radius of about 3,390 km, roughly half of Earth's.",
    'A day on Mars (a "sol") is about 24 hours 37 minutes, close to Earth\'s.',
    'A Martian year lasts about 687 Earth days.',
    'Mars has two small moons, Phobos and Deimos.',
    "Surface gravity is about 3.7 m/s², about 38% of Earth's.",
    'Mars is home to Olympus Mons, the tallest known volcano in the Solar System.',
    "The atmosphere is thin and mostly carbon dioxide.",
    'Average surface temperature is about -63°C.',
    'Mars has polar ice caps made of water ice and frozen carbon dioxide.',
  ],
  jupiter: [
    'Jupiter is the fifth planet from the Sun and the largest in the Solar System.',
    'Its equatorial radius is about 69,911 km — more than 11 times Earth\'s.',
    'A day on Jupiter is the shortest of any planet: about 9 hours 56 minutes.',
    'Jupiter orbits the Sun once every 11.86 Earth years.',
    'It is a gas giant made mostly of hydrogen and helium, with no solid surface.',
    'The Great Red Spot is a giant storm larger than Earth that has raged for centuries.',
    'Jupiter has at least 95 known moons, including the four large Galilean moons.',
    'Its banded appearance comes from fast winds and clouds at different latitudes and altitudes.',
  ],
};

const FACTS_TR: Record<PlanetId, string[]> = {
  earth: [
    'Dünya, Güneş\'ten üçüncü gezegendir ve yüzeyinde sıvı su bulunduğu bilinen tek dünyadır.',
    'Dünya\'nın ekvator yarıçapı yaklaşık 6.371 km\'dir.',
    'Dünya\'da bir gün (tam bir dönüş) 24 saattir.',
    'Dünya, Güneş çevresinde her 365,25 günde bir tur atar.',
    'Yüzeyin yaklaşık %71\'i okyanuslarla kaplıdır.',
    'Dünya\'nın bir doğal uydusu vardır: Ay.',
    'Atmosferin yaklaşık %78\'i azot, %21\'i oksijendir.',
    'Ortalama yüzey yerçekimi 9,8 m/s²\'dir.',
    'Dünya\'nın Güneş\'e ortalama uzaklığı yaklaşık 150 milyon km\'dir (1 AB).',
    'Küresel ortalama yüzey sıcaklığı yaklaşık 15°C\'dir.',
    'Dünya\'nın çekirdeği çoğunlukla katı demirden oluşur ve etrafını demir-nikel karışımı sıvı bir dış çekirdek sarar.',
  ],
  moon: [
    'Ay, Dünya\'nın tek doğal uydusudur.',
    'Ay\'ın önemli bir atmosferi yoktur.',
    'Yarıçapı yaklaşık 1.737 km\'dir, Dünya\'nınkinin yaklaşık dörtte biri kadardır.',
    'Dünya çevresinde bir tur atması yaklaşık 27,3 gün sürer.',
    'Ay, gel-git kilitlenmesi nedeniyle her zaman aynı yüzünü Dünya\'ya döner.',
    'Yüzey yerçekimi yaklaşık 1,6 m/s²\'dir, Dünya\'nınkinin yaklaşık altıda biri kadardır.',
    'Gündüz sıcaklıkları yaklaşık 127°C\'ye ulaşabilirken, gece sıcaklıkları yaklaşık -173°C\'ye düşebilir.',
    'Ay, Dünya\'dan ortalama 384.400 km uzaklıktadır.',
    'Dünya\'dan görülen koyu ovalara "mare" denir; bunlar eski bazalt lav akıntılarıdır.',
    '1969-1972 yılları arasındaki Apollo görevlerinde on iki astronot Ay\'da yürüdü.',
    'Ay, Dünya\'dan yılda yaklaşık 3,8 cm uzaklaşarak yavaşça kaymaktadır.',
  ],
  venus: [
    'Venüs, Güneş\'ten ikinci gezegendir.',
    'Venüs, yaklaşık 465°C\'lik yüzey sıcaklığıyla Güneş Sistemi\'ndeki en sıcak gezegendir.',
    'Kalın bir karbondioksit atmosferi, kontrolden çıkmış bir sera etkisiyle ısıyı hapseder.',
    'Yüzey basıncı, derin okyanuslara benzer şekilde Dünya\'nınkinin yaklaşık 92 katıdır.',
    'Venüs, diğer çoğu gezegenin aksine ters yönde (retrograd) döner.',
    'Tek bir Venüs günü (bir dönüş), kendi yılından daha uzun sürer: yaklaşık 243 Dünya günü.',
    'Venüs\'ün yarıçapı yaklaşık 6.052 km\'dir, Dünya\'nın boyutuna yakındır.',
    'Güneş çevresinde her 225 Dünya gününde bir tur atar.',
    'Venüs\'ün hiç uydusu yoktur.',
    'Bulutlar sülfürik asit damlacıklarından oluşur.',
    'Venüs, Ay\'dan sonra Dünya\'nın gece gökyüzündeki en parlak doğal cisimdir.',
  ],
  mars: [
    'Mars, Güneş\'ten dördüncü gezegendir ve Kızıl Gezegen olarak bilinir.',
    'Kızıl rengi, yüzeyin büyük kısmını kaplayan demir oksitten (pas) gelir.',
    'Mars\'ın yarıçapı yaklaşık 3.390 km\'dir, Dünya\'nınkinin yaklaşık yarısı kadardır.',
    'Mars\'ta bir gün ("sol"), Dünya\'nınkine yakın şekilde yaklaşık 24 saat 37 dakikadır.',
    'Bir Mars yılı yaklaşık 687 Dünya günü sürer.',
    'Mars\'ın Phobos ve Deimos adında iki küçük uydusu vardır.',
    'Yüzey yerçekimi yaklaşık 3,7 m/s²\'dir, Dünya\'nınkinin yaklaşık %38\'i kadardır.',
    'Mars, Güneş Sistemi\'ndeki bilinen en yüksek yanardağ olan Olympus Mons\'a ev sahipliği yapar.',
    'Atmosferi incedir ve çoğunlukla karbondioksitten oluşur.',
    'Ortalama yüzey sıcaklığı yaklaşık -63°C\'dir.',
    'Mars\'ın su buzu ve donmuş karbondioksitten oluşan kutup buzulları vardır.',
  ],
  jupiter: [
    'Jüpiter, Güneş\'ten beşinci gezegendir ve Güneş Sistemi\'ndeki en büyük gezegendir.',
    'Ekvator yarıçapı yaklaşık 69.911 km\'dir; Dünya\'nınkinin 11 katından fazladır.',
    'Jüpiter\'de bir gün, tüm gezegenler arasında en kısasıdır: yaklaşık 9 saat 56 dakika.',
    'Jüpiter, Güneş çevresinde her 11,86 Dünya yılında bir tur atar.',
    'Katı bir yüzeyi olmayan, çoğunlukla hidrojen ve helyumdan oluşan bir gaz devidir.',
    'Büyük Kırmızı Leke, Dünya\'dan daha büyük ve yüzyıllardır süren dev bir fırtınadır.',
    'Jüpiter\'in, dört büyük Galile uydusu dahil olmak üzere en az 95 bilinen uydusu vardır.',
    'Bantlı görünümü, farklı enlem ve yüksekliklerdeki hızlı rüzgarlardan ve bulutlardan kaynaklanır.',
  ],
};

export const FACTS: Record<PlanetId, string[]> = LANG === 'tr' ? FACTS_TR : FACTS_EN;

/**
 * Broader space facts (Sun, stars, galaxies, black holes, the Solar System as
 * a whole) — item #18c: the "Did you know?" card should draw from the whole
 * universe, not only the current planet, mixed in with that planet's own facts.
 */
const GENERAL_FACTS_EN: string[] = [
  'The Sun contains about 99.8% of the Solar System\'s total mass.',
  'Light from the Sun takes about 8 minutes and 20 seconds to reach Earth.',
  'The Sun is a middle-aged star, about 4.6 billion years old, roughly halfway through its life.',
  'There are eight recognized planets in the Solar System, plus dwarf planets like Pluto.',
  'The Milky Way galaxy contains an estimated 100-400 billion stars.',
  'A black hole\'s gravity is so strong that not even light can escape past its event horizon.',
  'The nearest star to the Sun, Proxima Centauri, is about 4.24 light-years away.',
  'Neutron stars can spin hundreds of times per second and are as dense as an atomic nucleus.',
  'The observable universe is estimated to be about 93 billion light-years across.',
  'Saturn\'s rings are made mostly of ice particles, with a smaller amount of rocky debris and dust.',
  'A light-year is the distance light travels in one year: about 9.46 trillion km.',
  'The largest known star, UY Scuti, is over 1,700 times the radius of the Sun.',
];

const GENERAL_FACTS_TR: string[] = [
  'Güneş, Güneş Sistemi\'nin toplam kütlesinin yaklaşık %99,8\'ini oluşturur.',
  'Güneş\'ten gelen ışığın Dünya\'ya ulaşması yaklaşık 8 dakika 20 saniye sürer.',
  'Güneş, yaklaşık 4,6 milyar yaşında, yaşamının ortasına yakın orta yaşlı bir yıldızdır.',
  'Güneş Sistemi\'nde sekiz gezegen ve Plüton gibi cüce gezegenler bulunur.',
  'Samanyolu galaksisinde tahminen 100-400 milyar yıldız bulunur.',
  'Bir kara deliğin yerçekimi o kadar güçlüdür ki olay ufkunun ötesinden ışık bile kaçamaz.',
  'Güneş\'e en yakın yıldız olan Proxima Centauri yaklaşık 4,24 ışık yılı uzaklıktadır.',
  'Nötron yıldızları saniyede yüzlerce kez dönebilir ve bir atom çekirdeği kadar yoğundur.',
  'Gözlemlenebilir evrenin çapının yaklaşık 93 milyar ışık yılı olduğu tahmin edilmektedir.',
  'Satürn\'ün halkaları çoğunlukla buz parçacıklarından, az miktarda kayaç ve tozdan oluşur.',
  'Bir ışık yılı, ışığın bir yılda aldığı mesafedir: yaklaşık 9,46 trilyon km.',
  'Bilinen en büyük yıldız UY Scuti, Güneş\'in yarıçapının 1.700 katından daha büyüktür.',
];

export const GENERAL_FACTS: string[] = LANG === 'tr' ? GENERAL_FACTS_TR : GENERAL_FACTS_EN;

/** A random fact for `planet`, mixing in general space facts about half the time (item #18c). */
export function randomFactFor(planet: PlanetId): string {
  const pool = Math.random() < 0.5 ? GENERAL_FACTS : FACTS[planet];
  return pool[Math.floor(Math.random() * pool.length)];
}
