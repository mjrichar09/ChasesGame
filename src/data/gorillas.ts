/**
 * The roster: eight gorillas, each with their own junk kart.
 *
 * Purely cosmetic — every kart drives the same — so this is all looks and
 * personality. The renderer builds both gorilla and kart from these numbers.
 */

export type Accessory = 'crown' | 'bandana' | 'goggles' | 'hardhat' | 'flower' | 'shades' | 'headphones' | 'none';
/** Each gorilla's signature celebration (see render/celebrate.ts). */
export type Celebration = 'chestPound' | 'windmill' | 'clap' | 'wave' | 'jump' | 'scratch' | 'fingerGuns' | 'flex';
export type KartStyle = 'logRaft' | 'barrel' | 'crate' | 'bamboo' | 'canoe' | 'tire' | 'bathtub' | 'stone';

export interface Gorilla {
  id: string;
  name: string;
  tagline: string;
  /** Fur, darker fur (back/limbs), and skin (face, chest, hands). */
  fur: number;
  furDark: number;
  skin: number;
  /** Silver saddle across the back. */
  silverback: boolean;
  /** Overall size and how chunky the shoulders/arms are. */
  size: number;
  bulk: number;
  accessory: Accessory;
  /** Main accessory colour. */
  accent: number;
  kart: KartStyle;
  celebration: Celebration;
  /** Kart paint / trim. */
  kartColor: number;
  kartTrim: number;
}

export const GORILLAS: readonly Gorilla[] = [
  {
    id: 'big-boris',
    name: 'Big Boris',
    tagline: 'Silverback. Built the kart from his own bed.',
    fur: 0x3b3a3d,
    furDark: 0x232226,
    skin: 0x4a3f3a,
    silverback: true,
    size: 1.12,
    bulk: 1.25,
    accessory: 'crown',
    accent: 0xf2c14e,
    kart: 'logRaft',
    celebration: 'chestPound',
    kartColor: 0x8a5a33,
    kartTrim: 0x5b8c3a,
  },
  {
    id: 'koko-loco',
    name: 'Koko Loco',
    tagline: 'Has never once used the brake.',
    fur: 0x5a3e2b,
    furDark: 0x3b2819,
    skin: 0x8c6b55,
    silverback: false,
    size: 0.95,
    bulk: 0.95,
    accessory: 'bandana',
    accent: 0xe0412f,
    kart: 'barrel',
    celebration: 'windmill',
    kartColor: 0xa0642d,
    kartTrim: 0x2f2f33,
  },
  {
    id: 'professor-tumbles',
    name: 'Professor Tumbles',
    tagline: 'Physics is more of a suggestion.',
    fur: 0x6b6158,
    furDark: 0x4a423b,
    skin: 0x9c8473,
    silverback: true,
    size: 1.0,
    bulk: 0.9,
    accessory: 'goggles',
    accent: 0x58b6c9,
    kart: 'crate',
    celebration: 'clap',
    kartColor: 0xc9a06a,
    kartTrim: 0x3c6e9e,
  },
  {
    id: 'mama-mango',
    name: 'Mama Mango',
    tagline: 'Feeds the whole troop. Takes no prisoners.',
    fur: 0x2e2a2b,
    furDark: 0x1d1a1b,
    skin: 0x5e4a44,
    silverback: false,
    size: 1.02,
    bulk: 1.05,
    accessory: 'flower',
    accent: 0xff7fb0,
    kart: 'bathtub',
    celebration: 'wave',
    kartColor: 0xf3efe6,
    kartTrim: 0xf29f3c,
  },
  {
    id: 'tiny-tank',
    name: 'Tiny Tank',
    tagline: 'Smallest in the troop. Loudest, too.',
    fur: 0x4b3a33,
    furDark: 0x30241f,
    skin: 0x8a6e60,
    silverback: false,
    size: 0.82,
    bulk: 0.85,
    accessory: 'hardhat',
    accent: 0xffcc1f,
    kart: 'tire',
    celebration: 'jump',
    kartColor: 0x2b2b2e,
    kartTrim: 0xffcc1f,
  },
  {
    id: 'dj-banana',
    name: 'DJ Banana',
    tagline: 'Drops beats. And peels.',
    fur: 0x3a2f3f,
    furDark: 0x251e29,
    skin: 0x6e5a66,
    silverback: false,
    size: 0.98,
    bulk: 1.0,
    accessory: 'headphones',
    accent: 0x9b5cf6,
    kart: 'canoe',
    celebration: 'scratch',
    kartColor: 0x2d8f7b,
    kartTrim: 0xf7e04b,
  },
  {
    id: 'smooth-steve',
    name: 'Smooth Steve',
    tagline: 'Too cool to look where he is going.',
    fur: 0x7a5a3a,
    furDark: 0x553e27,
    skin: 0xa58368,
    silverback: false,
    size: 1.0,
    bulk: 1.0,
    accessory: 'shades',
    accent: 0x1b1b1f,
    kart: 'bamboo',
    celebration: 'fingerGuns',
    kartColor: 0xb7c65a,
    kartTrim: 0x7a4b2a,
  },
  {
    id: 'granite-gus',
    name: 'Granite Gus',
    tagline: 'The kart is a rock. So is Gus.',
    fur: 0x51504c,
    furDark: 0x363532,
    skin: 0x6d665e,
    silverback: true,
    size: 1.08,
    bulk: 1.15,
    accessory: 'none',
    accent: 0x8f8a80,
    kart: 'stone',
    celebration: 'flex',
    kartColor: 0x9a968c,
    kartTrim: 0x6b8f4e,
  },
];
