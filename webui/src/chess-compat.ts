// webui/src/chess-compat.ts
// Compatible wrapper for chess.js ESM (v1.x) and avoids relying on a default export.
// It works in dev and production builds without Rollup warnings.

import * as ChessJS from 'chess.js';

// Prefer the named export (v1.x). Fall back to the module object if needed.
// NOTE: we intentionally do NOT read `.default` to avoid the Rollup error:
// "default is not exported by node_modules/chess.js/dist/esm/chess.js"
const ChessCtor: any = (ChessJS as any).Chess ?? (ChessJS as any);

export const Chess: any = ChessCtor;

// Loose types so we don't bind to version-specific typings.
export type Square = string;
export type MoveLike = {
  from: Square;
  to: Square;
  san?: string;
  promotion?: string;
  [k: string]: any;
};

