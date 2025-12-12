import type { Color, UciMove } from '../types/chess';

export type EvalScore =
  | { type: 'cp'; value: number }
  | { type: 'mate'; value: number };

export type EngineInfo = {
  move: UciMove;
  multipv: number;
  depth?: number;
  nodes?: number;
  pv?: UciMove[];
  score: EvalScore;
};

export type EngineAnalysis = {
  sideToMove: Color;
  infos: EngineInfo[];
};

export type AnalyseRequest = {
  fen: string;
  multipv: number;
  movetime?: number;
  depth?: number;
  nodes?: number;
  signal?: AbortSignal;
};

export type ReviewFastRequest = {
  movesUci: string[];
  signal?: AbortSignal;
  elo?: number;
  options?: Record<string, unknown>;
};

export type ReviewFastEntry = {
  idx: number;
  bestMove: UciMove | null;
  score: EvalScore | null;
};

export type OpeningDetectionRequest = {
  movesUci: string[];
  signal?: AbortSignal;
};

export type OpeningDetection = {
  eco: string;
  name: string;
  variation?: string;
  plyDepth: number;
} | null;

export interface EngineAdapter {
  analyse(args: AnalyseRequest): Promise<EngineAnalysis>;
  reviewFast(args: ReviewFastRequest): Promise<ReviewFastEntry[]>;
  identifyOpening(args: OpeningDetectionRequest): Promise<OpeningDetection>;
  cancelAll?(): void;
  dispose(): void;
}
