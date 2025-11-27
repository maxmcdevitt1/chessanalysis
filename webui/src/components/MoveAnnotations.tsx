import React from 'react';

type Tag = 'Book'|'Best'|'Good'|'Inaccuracy'|'Mistake'|'Blunder';
const glyph: Record<Tag,string> = {
  Book: '⛰',
  Best: '✓',
  Good: '•',
  Inaccuracy: '?!',
  Mistake: '?',
  Blunder: '??'
};

export type MoveAnnotationsProps = {
  lastMove?: { from: string; to: string };
  tag?: Tag;
};

export function MoveAnnotations({lastMove, tag}: MoveAnnotationsProps) {
  if (!lastMove || !tag) return null;
  return (
    <div aria-label=\"move-annotation\" className=\"absolute pointer-events-none select-none\">
      <span style={{ fontSize: 18, fontWeight: 700 }}>{glyph[tag]}</span>
    </div>
  );
}
