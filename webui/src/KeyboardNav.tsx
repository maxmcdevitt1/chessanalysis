// webui/src/KeyboardNav.tsx
import React from 'react';
import { useGlobalArrowNav } from './hooks/useGlobalArrowNav';
type Props = { ply: number; movesUciLength: number; onRebuildTo: (ply: number) => void; enabled?: boolean; };
export default function KeyboardNav({ ply, movesUciLength, onRebuildTo, enabled = true }: Props) {
  useGlobalArrowNav({ ply, total: movesUciLength, onRebuildTo, enabled });
  return null;
}
