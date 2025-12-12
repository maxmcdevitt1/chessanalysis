// webui/src/App.tsx
import { useCallback, useEffect, useMemo as useM, useState, useRef } from 'react';
import { createEngineAdapter } from './engine/engineAdapter';
import type { EngineAnalysis } from './engine/types';
import { useCoach } from './hooks/useCoach';

import BoardPane from './BoardPane';
import SidebarPane from './SidebarPane';
import KeyboardNav from './KeyboardNav';
import { useMatchClock } from './hooks/useMatchClock';
import { useGameState } from './hooks/useGameState';
import { useBotReply } from './hooks/useBotReply';
import { useSettings, type Settings } from './hooks/useSettings';
import { useToasts } from './hooks/useToasts';
import type { PushToastArgs, ToastVariant } from './hooks/useToasts';
import { ToastStack } from './components/ToastStack';
import { useEngineAnalysis } from './hooks/useEngineAnalysis';
import { useBatchAnalysis } from './hooks/useBatchAnalysis';
import { useOpeningDetection } from './hooks/useOpeningDetection';
import { useAnalysisController } from './hooks/useAnalysisController';
import { useEngineReply } from './hooks/useEngineReply';
import { useEngineStrength } from './hooks/useEngineStrength';
import MovesTable from './components/MovesTable';
import type { MoveEval } from './types/moveEval';
import { lastScoreCp } from './utils/evalScoring';
import { useBestArrow, useEvalDisplayCp } from './hooks/useBoardDerived';
import { usePgnImport } from './hooks/usePgnImport';
import { useOpeningBookMoves } from './hooks/useOpeningBookMoves';
import { usePlayerControls } from './hooks/usePlayerControls';
import { useReviewAndCoach } from './hooks/useReviewAndCoach';
import { panicEngine } from './bridge';

const MOVES_PANEL_WIDTH = 320;

/* ----------------------------- metrics helpers --------------------------- */

function useErrorToast(
  error: string | null,
  pushToast: (args: PushToastArgs) => number,
  label: string,
  variant: ToastVariant = 'error'
) {
  const lastRef = useRef<string | null>(null);
  useEffect(() => {
    if (!error) {
      lastRef.current = null;
      return;
    }
    if (lastRef.current === error) return;
    lastRef.current = error;
    const prefix = label ? `${label}: ` : '';
    pushToast({ message: `${prefix}${error}`, variant });
  }, [error, pushToast, label, variant]);
}

/* -------------------------------- component ------------------------------ */

export default function App() {
  const { settings, update: updateSettings } = useSettings();
  const {
    moves: movesUci,
    fen,
    ply,
    autoReply,
    setAutoReply: setAutoReplyState,
    gameOver,
    setGameOver: setGameOverState,
    applyMove,
    jumpToPly,
    reset: resetGameState,
    loadMoves,
    game,
  } = useGameState({ initialAutoReply: settings.autoReply });

  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [moveEvals, setMoveEvals] = useState<MoveEval[]>([]);
  const { notes: coachNotes, isRunning: coachBusy, error: coachError, run: runCoach } = useCoach();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [engineError, setEngineError] = useState<string | null>(null);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const handleSettingsChange = useCallback((patch: Partial<Settings>) => {
    updateSettings(patch);
    if (Object.prototype.hasOwnProperty.call(patch, 'disableGpu')) {
      const next = patch.disableGpu === true;
      pushToast({
        message: next
          ? 'GPU acceleration will be disabled after you restart.'
          : 'GPU acceleration restored (takes effect after restart).',
        variant: 'warning',
      });
    }
  }, [updateSettings, pushToast]);

  const setAutoReply = useCallback((next: boolean) => {
    setAutoReplyState(next);
    updateSettings({ autoReply: next });
  }, [setAutoReplyState, updateSettings]);

  // engine + auto-reply state
  const engine = useM(() => createEngineAdapter(), []);
  useEffect(() => () => engine.dispose(), [engine]);
  const { pickMove, isPicking, error: pickerError } = useBotReply({ engine });
  const engineBusy = isPicking;
  const {
    timeControlMinutes,
    setTimeControlMinutes,
    clockMs,
    clockRunning,
    matchStarted,
    startClock,
    pauseClock,
    resetClocksToStart,
    markMatchNotStarted,
    beginMatch,
    resignMatch,
  } = useMatchClock({ game, gameOver, setGameOver: setGameOverState, setAutoReply });

  // user-configurable options
  const {
    engineBand,
    setEngineBand,
    engineTargetElo,
    engineTargetLabel,
    engineTargetRange,
  } = useEngineStrength({
    band: settings.band,
    onChange: (next) => updateSettings({ band: next }),
  });
  const showEvalGraph = settings.showEvalGraph;
  const toggleEvalGraph = useCallback(() => {
    updateSettings({ showEvalGraph: !settings.showEvalGraph });
  }, [settings.showEvalGraph, updateSettings]);
  const [suspendEval, setSuspendEval] = useState(false);

  const applyMoveWithTrim = useCallback((uci: string) => {
    const ok = applyMove(uci);
    if (ok) {
      setMoveEvals((prev) => prev.slice(0, Math.max(0, ply)));
    }
    return ok;
  }, [applyMove, ply]);

  const resetEvaluations = useCallback(() => setMoveEvals([]), []);

  const isGameOver = !!gameOver;

  const { engineMove, markUserMoved } = useEngineReply({
    engineBand,
    movesUci,
    ply,
    fenFallback: fen,
    game,
    pickMove,
    engineBusy,
    autoReply,
    gameOver: isGameOver,
    clockRunning,
    startClock,
    applyMoveWithTrim,
    setEngineError,
    pushToast,
    setSuspendEval,
  });

  const {
    onUserDrop,
    onApplyBookMove,
    onOfferDraw,
    onBeginMatch,
    onResign,
    onNewGame,
  } = usePlayerControls({
    applyMoveWithTrim,
    markUserMoved,
    clockRunning,
    startClock,
    pauseClock,
    setGameOver: setGameOverState,
    setAutoReply,
    gameOver,
    beginMatch,
    resignMatch,
    resetGameState,
    resetClocksToStart,
    markMatchNotStarted,
    setMoveEvals,
    onUserMove: stopAnalyze,
  });

  const { loadPgnText, loadPgnFile } = usePgnImport({
    loadMoves,
    resetEvaluations,
    markMatchNotStarted,
    notify: pushToast,
  });

  const {
    analysis: liveAnalysis,
    isLoading: evalPending,
    error: evalError,
  } = useEngineAnalysis({
    engine,
    fen,
    elo: engineTargetElo,
    enabled: !suspendEval,
    multipv: settings.liveMultipv,
  });
  const batchAnalysis = useBatchAnalysis({ engine });
  const {
    analyzePgn,
    analyzePgnFast,
    stopAnalyze,
    analyzing,
    progress,
  } = useAnalysisController({
    engine,
    movesUci,
    engineBand,
    setMoveEvals,
    batchAnalysis,
    notify: pushToast,
    setSuspendEval,
  });
  const openingDetection = useOpeningDetection({ engine, movesUci });
  const batchError = batchAnalysis.error;
  const openingError = openingDetection.error;
  const openingText = openingDetection.label;
  const bookMask = openingDetection.bookMask;
  const bookDepth = openingDetection.bookDepth;
  const bookReady = openingDetection.bookReady;
  const evalCp = useM(() => {
    if (!liveAnalysis || !liveAnalysis.infos?.length) return null;
    const cp = lastScoreCp(liveAnalysis.infos as any);
    if (cp == null) return null;
    const side = liveAnalysis.sideToMove ?? 'w';
    return side === 'w' ? cp : -cp;
  }, [liveAnalysis]);

  useErrorToast(evalError, pushToast, 'Live analysis unavailable', 'warning');
  useErrorToast(batchError, pushToast, 'Fast analysis failed');
  useErrorToast(openingError, pushToast, 'Opening detection unavailable', 'warning');
  useErrorToast(coachError, pushToast, 'Coach unavailable', 'warning');
  useErrorToast(pickerError, pushToast, 'Engine picker unavailable');

  const currentMoveEval = useM(
    () => (ply > 0 ? moveEvals[ply - 1] ?? null : null),
    [moveEvals, ply]
  );

  const bookCandidateMoves = useOpeningBookMoves({ movesUci, ply, fen });
  const bookUci = bookReady ? bookCandidateMoves : [];

  const engineSettingsSlice = useM(
    () => ({
      engineThreads: settings.engineThreads,
      engineHashMb: settings.engineHashMb,
      liveMultipv: settings.liveMultipv,
      disableGpu: settings.disableGpu,
    }),
    [settings.engineThreads, settings.engineHashMb, settings.liveMultipv, settings.disableGpu]
  );

  /* central move application handled via useGameState */

  /* ------------------------ engine / auto reply --------------------------- */

  /* ------------------ review (accuracy / avg CPL) ------------------------ */

  const { review, evalSeries, notesForPly, onGenerateNotes } = useReviewAndCoach({
    moveEvals,
    movesUci,
    ply,
    coachNotes,
    coachBusy,
    runCoach,
    openingText: openingText || null,
  });

  const handlePanic = useCallback(async () => {
    try {
      stopAnalyze();
      batchAnalysis.cancel();
      engine?.cancelAll?.();
      setSuspendEval(true);
      await panicEngine();
      pushToast({ message: 'Engine stopped.', variant: 'warning' });
    } catch (err: any) {
      pushToast({
        message: err?.message ? `Unable to stop engine: ${err.message}` : 'Unable to stop engine.',
        variant: 'error',
      });
    } finally {
      setSuspendEval(false);
    }
  }, [stopAnalyze, batchAnalysis, engine, pushToast, setSuspendEval]);

  // (No textarea-based coach text here anymore; list is rendered via CoachMoveList)

  // best-move arrow
  const bestArrow = useBestArrow(ply, moveEvals);
  const evalDisplayCp = useEvalDisplayCp(evalCp, currentMoveEval ?? null, moveEvals);

  // Only show per-move badges when the current move has an analysis tag.
  const hasAnalysis = !!(currentMoveEval && currentMoveEval.tag);
  return (
    <>
      <div className="app-shell">
        <KeyboardNav
          ply={ply}
          movesUciLength={movesUci.length}
          onRebuildTo={jumpToPly}
        />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${MOVES_PANEL_WIDTH}px 1fr ${sidebarOpen ? 480 : 28}px`,
            gridTemplateRows: '1fr',
            alignItems: 'stretch',
            gap: 12,
            padding: 12,
            height: '100vh',
            boxSizing: 'border-box',
            minHeight: 0,
          }}
        >
        <div style={{ width: MOVES_PANEL_WIDTH }}>
          <MovesTable
            moves={moveEvals}
            bookMask={bookMask}
            bookDepth={bookDepth}
            onJump={jumpToPly}
            currentPly={ply}
            height={typeof window !== 'undefined' ? Math.max(200, window.innerHeight - 220) : undefined}
          />
        </div>

        <BoardPane
          // core state
          fen={fen}
          orientation={orientation}
          onOrientationChange={setOrientation}
          evalCp={evalDisplayCp}
          evalPending={evalPending}

          // series + current move for icons/graph
          currentMoveEval={ply > 0 ? (moveEvals[ply - 1] ?? null) : null}
          evalSeries={evalSeries}
          showEvalGraph={showEvalGraph}
          onToggleEvalGraph={toggleEvalGraph}
          hasAnalysis={hasAnalysis}

          // moves + nav
          movesUci={movesUci}
          ply={ply}
          onRebuildTo={jumpToPly}

          // engine controls
          engineBusy={engineBusy}
          autoReply={autoReply}
          setAutoReply={setAutoReply}
          onEngineMove={engineMove}
          onOfferDraw={onOfferDraw}
          gameOver={gameOver}
          onBeginMatch={onBeginMatch}
          onResign={onResign}
          timeControlMinutes={timeControlMinutes}
          onTimeControlChange={setTimeControlMinutes}
          clockMs={clockMs}
          clockRunning={clockRunning}
          matchStarted={matchStarted}
          engineError={engineError}

          // user actions
          onUserDrop={onUserDrop}
          onNewGame={onNewGame}

          // visuals
          bestArrow={bestArrow}
          bookMask={bookMask}
          currentPly={ply}
          lastMove={ply > 0 && movesUci[ply - 1] ? { from: movesUci[ply - 1].slice(0,2), to: movesUci[ply - 1].slice(2,4) } : null}

          // player display around board
          whiteName="White"
          blackName="Black"
          whiteAcc={review?.whiteAcc ?? null}
          blackAcc={review?.blackAcc ?? null}
          whiteEstElo={review?.estEloWhite ?? null}
          blackEstElo={review?.estEloBlack ?? null}
          engineTargetElo={engineTargetElo}
          engineTargetLabel={engineTargetLabel}
          engineTargetRange={engineTargetRange}
        />

        <SidebarPane
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          currentEval={currentMoveEval ?? undefined}
          openingText={openingText}
          gameEloWhite={review?.estEloWhite ?? null}
          gameEloBlack={review?.estEloBlack ?? null}
          movesUci={movesUci}
          openingInfo={openingText || null}
          whiteAcc={review?.whiteAcc ?? null}
          blackAcc={review?.blackAcc ?? null}
          avgCplW={review?.avgCplW ?? null}
          avgCplB={review?.avgCplB ?? null}
          ply={ply}
          bookUci={bookUci}
          analyzing={analyzing}
          progress={progress}
          review={review}
          moveEvals={moveEvals}
          bookDepth={bookDepth}
          bookMask={bookMask}
          onRebuildTo={jumpToPly}
          onAnalyze={analyzePgn}
          onAnalyzeFast={analyzePgnFast}
          onStopAnalyze={stopAnalyze}
          onLoadPgnText={loadPgnText}
          onLoadPgnFile={loadPgnFile}
          onApplyBookMove={onApplyBookMove}
          engineBand={engineBand}
          onEngineBandChange={setEngineBand}
          activeCoachNotes={notesForPly}
          coachNotes={coachNotes}
          currentPly={ply}
          onJumpToPly={jumpToPly}
          onGenerateNotes={onGenerateNotes}
          coachBusy={coachBusy}
          coachError={coachError}
          showMoves={false}
          liveEvalCp={evalDisplayCp}
          evalPending={evalPending}
          engineSettings={engineSettingsSlice}
          onSettingsChange={handleSettingsChange}
          onPanic={handlePanic}
        />
        </div>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
