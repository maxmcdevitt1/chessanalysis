const LABEL_BINS = [
  { max: 60, label: 'equal' },
  { max: 150, label: 'slight edge for' },
  { max: 300, label: 'clear edge for' },
  { max: 600, label: 'winning for' },
  { max: Infinity, label: 'decisive for' },
];

export function evalLabelFromWhiteCp(cp: number | null | undefined): string | null {
  if (cp == null || !Number.isFinite(cp)) return null;
  const abs = Math.abs(cp);
  if (abs < LABEL_BINS[0].max) return 'equal';
  const side = cp >= 0 ? 'White' : 'Black';
  const bucket = LABEL_BINS.find((bin) => abs < bin.max) ?? LABEL_BINS[LABEL_BINS.length - 1];
  return `${bucket.label} ${side}`;
}
