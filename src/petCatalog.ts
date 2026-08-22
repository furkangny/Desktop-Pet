import type { PetId, PetManifest, PetSize } from './types';

export const PET_MANIFESTS: Record<PetId, PetManifest> = {
  'tiny-robot': {
    id: 'tiny-robot',
    displayName: 'Tiny Robot',
    description: 'Meraklı, ekran yüzlü küçük robot dost.',
    spriteVersionNumber: 2,
    spritesheetPath: '/pets/tiny-robot/spritesheet.webp',
    cellWidth: 192,
    cellHeight: 208,
    columns: 8,
    rows: 11,
    voiceProfile: 'droid'
  },
  'tiny-astronaut': {
    id: 'tiny-astronaut',
    displayName: 'Tiny Astronaut',
    description: 'Masaüstünü keşfeden minik uzay yolcusu.',
    spriteVersionNumber: 2,
    spritesheetPath: '/pets/tiny-astronaut/spritesheet.webp?v=3',
    cellWidth: 192,
    cellHeight: 208,
    columns: 8,
    rows: 11,
    voiceProfile: 'droid'
  },
  'pixel-cat': {
    id: 'pixel-cat',
    displayName: 'Pixel Cat',
    description: 'Yumuşak ifadeli, meraklı koyu renkli pixel dost.',
    spriteVersionNumber: 2,
    spritesheetPath: '/pets/pixel-cat/spritesheet.webp?v=3',
    cellWidth: 192,
    cellHeight: 208,
    columns: 8,
    rows: 11,
    voiceProfile: 'cat'
  }
};

export const PET_PIXEL_SIZE: Record<PetSize, number> = {
  tiny: 64,
  small: 88,
  medium: 120,
  large: 160
};

export const PET_WINDOW_SIZE: Record<PetSize, number> = {
  tiny: 80,
  small: 104,
  medium: 140,
  large: 180
};
