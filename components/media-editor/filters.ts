/**
 * Curated colour-preset filters, applied GPU-side via a Skia ColorMatrix (a 4x5
 * row-major matrix) — the matrix runs on the GPU as part of the image paint, never on
 * the JS thread. Values in the 5th column are the bias term (normalised 0..1).
 */
export type FilterPreset = {
  id: string;
  label: string;
  /** null = no filter (identity). */
  matrix: number[] | null;
};

// Luminance-preserving saturation boost (Rec. 709 coefficients).
const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;
function saturation(s: number): number[] {
  const inv = 1 - s;
  return [
    inv * LR + s, inv * LG, inv * LB, 0, 0,
    inv * LR, inv * LG + s, inv * LB, 0, 0,
    inv * LR, inv * LG, inv * LB + s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

export const FILTERS: FilterPreset[] = [
  { id: 'none', label: 'Original', matrix: null },
  {
    id: 'mono',
    label: 'Mono',
    matrix: [
      0.33, 0.33, 0.33, 0, 0,
      0.33, 0.33, 0.33, 0, 0,
      0.33, 0.33, 0.33, 0, 0,
      0, 0, 0, 1, 0,
    ],
  },
  {
    id: 'noir',
    label: 'Noir',
    matrix: [
      0.43, 0.43, 0.43, 0, -0.15,
      0.43, 0.43, 0.43, 0, -0.15,
      0.43, 0.43, 0.43, 0, -0.15,
      0, 0, 0, 1, 0,
    ],
  },
  {
    id: 'warm',
    label: 'Warm',
    matrix: [
      1.1, 0, 0, 0, 0.02,
      0, 1.02, 0, 0, 0,
      0, 0, 0.9, 0, 0,
      0, 0, 0, 1, 0,
    ],
  },
  {
    id: 'cool',
    label: 'Cool',
    matrix: [
      0.9, 0, 0, 0, 0,
      0, 1.0, 0, 0, 0,
      0, 0, 1.1, 0, 0.02,
      0, 0, 0, 1, 0,
    ],
  },
  { id: 'vivid', label: 'Vivid', matrix: saturation(1.35) },
  {
    id: 'fade',
    label: 'Fade',
    matrix: [
      0.8, 0, 0, 0, 0.1,
      0, 0.8, 0, 0, 0.1,
      0, 0, 0.8, 0, 0.1,
      0, 0, 0, 1, 0,
    ],
  },
  {
    id: 'sepia',
    label: 'Sepia',
    matrix: [
      0.393, 0.769, 0.189, 0, 0,
      0.349, 0.686, 0.168, 0, 0,
      0.272, 0.534, 0.131, 0, 0,
      0, 0, 0, 1, 0,
    ],
  },
];

export function filterById(id: string): FilterPreset {
  return FILTERS.find((f) => f.id === id) ?? FILTERS[0];
}
