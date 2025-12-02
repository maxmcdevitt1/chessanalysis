// webui/src/TagBadges.tsx
import React from 'react';
import { Tag } from './types';

type Props = { size?: number };

export function BestBadge({ size = 24 }: Props) {
  return (
    <svg viewBox="0 0 30 30" width={size} height={size} aria-label="Best move">
      <circle cx="15" cy="15" r="14" fill="#34a853"/>
      <polygon fill="#ffffff" points="15,5 18,12 26,12 19.5,17 22,25 15,20 8,25 10.5,17 4,12 12,12"/>
    </svg>
  );
}

export function GoodBadge({ size = 24 }: Props) {
  return (
    <svg viewBox="0 0 30 30" width={size} height={size} aria-label="Good move">
      <circle cx="15" cy="15" r="14" fill="#4aa3df"/>
      <rect x="14" y="7" width="2" height="12" fill="#ffffff"/>
      <circle cx="15" cy="22" r="2" fill="#ffffff"/>
    </svg>
  );
}

export function MistakeBadge({ size = 24 }: Props) {
  return (
    <svg viewBox="0 0 30 30" width={size} height={size} aria-label="Mistake">
      <circle cx="15" cy="15" r="14" fill="#f4c430"/>
      <path d="M15 8c-2.8 0-5 1.9-5 4h3c0-1 .9-2 2-2s2 1 2 2c0 2-3 2.5-3 5h3c0-2.2 3-3 3-6 0-2.7-2.2-5-5-5z" fill="#b38300"/>
      <circle cx="15" cy="22" r="2" fill="#b38300"/>
    </svg>
  );
}

export function BlunderBadge({ size = 24 }: Props) {
  return (
    <svg viewBox="0 0 30 30" width={size} height={size} aria-label="Blunder">
      <rect x="10" y="6" width="2" height="15" fill="#d93025"/>
      <rect x="18" y="6" width="2" height="15" fill="#d93025"/>
      <circle cx="11" cy="24" r="2" fill="#d93025"/>
      <circle cx="19" cy="24" r="2" fill="#d93025"/>
    </svg>
  );
}

export function BookBadge({ size = 24 }: Props) {
  return (
    <svg viewBox="0 0 30 30" width={size} height={size} aria-label="Book move">
      <rect x="6" y="5" width="18" height="20" rx="2" ry="2" fill="#a56a38"/>
      <rect x="6" y="20" width="18" height="4" fill="#ecd8b5"/>
    </svg>
  );
}

/** Some UIs call this “Brilliant” or “Genius”. Export both aliases. */
export function BrilliantBadge({ size = 24 }: Props) {
  // reuse Best styling; tweak color if you like
  return <BestBadge size={size} />;
}
export const GeniusBadge = BrilliantBadge;

/** Optional helper if you want a single component by tag string */
export function BadgeForTag({
  tag,
  size = 24,
}: { tag?: Tag | null; size?: number }) {
  if (!tag) return null;
  switch (tag) {
    case 'Best': return <BestBadge size={size} />;
    case 'Good': return <GoodBadge size={size} />;
    case 'Mistake': return <MistakeBadge size={size} />;
    case 'Blunder': return <BlunderBadge size={size} />;
    case 'Book': return <BookBadge size={size} />;
    case 'Brilliant':
    case 'Genius': return <BrilliantBadge size={size} />;
    default: return null;
  }
}

/** Single entry point for tag badges */
export function TagBadge({ tag, size = 24 }: { tag?: Tag | null; size?: number }) {
  return <BadgeForTag tag={tag} size={size} />;
}
