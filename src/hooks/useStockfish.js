import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useStockfish
 *
 * Drives a Stockfish web worker to analyze one or more FEN strings. The hook queues
 * requested positions, waits for the engine to return a `bestmove`, and captures the
 * latest evaluation line seen during the search.
 */
export default function useStockfish(workerUrl = '/stockfish.worker.js') {
  const workerRef = useRef(null);

  const queueRef = useRef([]);
  const currentFenRef = useRef(null);
  const currentEvalRef = useRef(null);
  const bestMoveRef = useRef(null);

  const analyzedDataRef = useRef({});
  const [analyzedData, setAnalyzedData] = useState({});

  const isAnalyzingRef = useRef(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const totalRef = useRef(0);
  const completedRef = useRef(0);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  /**
   * Helper: safely post a message to the worker.
   */
  const send = useCallback((cmd) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage(cmd);
  }, []);

  /**
   * Parse a Stockfish info line and cache the latest evaluation and principal variation.
   */
  const handleInfoLine = useCallback((line) => {
    // score cp <value>
    const scoreMatch = line.match(/score\s+(cp|mate)\s+(-?\d+)/);
    if (scoreMatch) {
      const [, type, rawValue] = scoreMatch;
      const value = parseInt(rawValue, 10);
      currentEvalRef.current = type === 'mate' ? { type: 'mate', value } : { type: 'cp', value };
    }

    // Grab the first PV move as the suggested move while searching
    const pvMatch = line.match(/\spv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
    if (pvMatch && !bestMoveRef.current) {
      bestMoveRef.current = pvMatch[1];
    }
  }, []);

  /**
   * Fire analysis for the next FEN in the queue.
   */
  const startNext = useCallback(() => {
    if (queueRef.current.length === 0 || !workerRef.current) {
      isAnalyzingRef.current = false;
      setIsAnalyzing(false);
      setProgress({ current: completedRef.current, total: totalRef.current });
      return;
    }

    isAnalyzingRef.current = true;
    setIsAnalyzing(true);

    const fen = queueRef.current.shift();
    currentFenRef.current = fen;
    currentEvalRef.current = null;
    bestMoveRef.current = null;

    // Tell Stockfish to analyze this position to a reasonable depth
    send('stop');
    send('ucinewgame');
    send(`position fen ${fen}`);
    send('go depth 15');
  }, [send]);

  /**
   * When the engine reports a bestmove, store the analysis result and continue with the queue.
   */
  const finalizeCurrent = useCallback(() => {
    const fen = currentFenRef.current;
    if (!fen) return;

    const evalObj = currentEvalRef.current || { type: 'cp', value: 0 };
    const bestMove = bestMoveRef.current || '';

    setAnalyzedData((prev) => {
      const next = { ...prev, [fen]: { eval: evalObj, bestMove } };
      analyzedDataRef.current = next;
      return next;
    });

    completedRef.current += 1;
    setProgress({ current: completedRef.current, total: totalRef.current });

    // Reset engine state and start the next queued item
    currentFenRef.current = null;
    currentEvalRef.current = null;
    bestMoveRef.current = null;

    // Delay kicking off the next position to give the worker a tick to breathe
    setTimeout(() => {
      if (queueRef.current.length === 0) {
        isAnalyzingRef.current = false;
        setIsAnalyzing(false);
        return;
      }
      startNext();
    }, 0);
  }, [startNext]);

  /**
   * Handle worker messages and route them to the correct parser.
   */
  const handleWorkerMessage = useCallback((event) => {
    const payload = event?.data;
    const line = typeof payload === 'string' ? payload : payload?.data;
    if (!line || typeof line !== 'string') return;

    if (line.startsWith('info')) {
      handleInfoLine(line);
    }

    if (line.startsWith('bestmove')) {
      const match = line.match(/bestmove\s+(\S+)/);
      if (match) {
        bestMoveRef.current = match[1];
      }
      finalizeCurrent();
    }
  }, [finalizeCurrent, handleInfoLine]);

  /**
   * Initialize and tear down the Stockfish worker.
   */
  useEffect(() => {
    const worker = new Worker(workerUrl);
    workerRef.current = worker;

    worker.onmessage = handleWorkerMessage;
    worker.postMessage('uci');

    return () => {
      if (workerRef.current) {
        try {
          workerRef.current.postMessage({ action: 'terminate' });
        } catch (e) {
          // ignore
        }
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [handleWorkerMessage, workerUrl]);

  /**
   * Public API: queue one or more FEN strings for analysis.
   */
  const startAnalysis = useCallback((fenList) => {
    const fens = Array.isArray(fenList) ? fenList : [fenList];
    const unique = fens.filter((fen) => fen && !analyzedDataRef.current[fen]);
    if (unique.length === 0) return;

    const startingFresh = !isAnalyzingRef.current && queueRef.current.length === 0;

    queueRef.current.push(...unique);

    if (startingFresh) {
      completedRef.current = 0;
      totalRef.current = queueRef.current.length;
    } else {
      totalRef.current = completedRef.current + queueRef.current.length;
    }
    setProgress({ current: completedRef.current, total: totalRef.current });

    if (!isAnalyzingRef.current) {
      startNext();
    }
  }, [startNext]);

  /**
   * Public API: stop any ongoing analysis and clear the queue.
   */
  const stopAnalysis = useCallback(() => {
    queueRef.current = [];
    send('stop');
    isAnalyzingRef.current = false;
    setIsAnalyzing(false);
    totalRef.current = completedRef.current;
    setProgress({ current: completedRef.current, total: totalRef.current });
  }, [send]);

  return {
    analyzedData,
    isAnalyzing,
    progress,
    startAnalysis,
    stopAnalysis,
  };
}

