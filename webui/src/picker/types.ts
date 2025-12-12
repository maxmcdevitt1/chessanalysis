import type { BandId } from '../config/picker';
import type { EngineInfo } from '../engine/types';
import type { Color, UciMove } from '../types/chess';

export type SideToMoveCP = { cp: number };
export type WhitePovCP = { cp: number };

export type EngineCand = {
  move: UciMove;
  score: SideToMoveCP;
  pv?: UciMove[];
};

export type PickerCand = EngineCand & {
  drop: number;
};

export type PickedMove = {
  uci: UciMove;
  reason: string;
  meta: PickMeta;
};

export type PickMeta = {
  seed?: number | string;
  band: BandId;
  historyLength: number;
  msBudget: number;
  multipv: number;
  k: number;
  maxDrop: number;
  dropRelaxations: number[];
  multipvBumps: number[];
  timeExtensions: number[];
  usedBook: boolean;
  candidatePool: Array<{ move: UciMove; cp: number; drop: number }>;
  evalDrops: Array<{ move: UciMove; drop: number }>;
  temperature: number;
  usedImperfection?: string;
  bookLine?: { eco: string; name: string; variation?: string };
};

export type AnalysisInfo = {
  sideToMove: Color;
  infos: EngineInfo[];
};
