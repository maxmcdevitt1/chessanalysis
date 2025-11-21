// src/hooks/useStockfish.js
// Overwrite the existing file with this content.

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useStockfish
 * Lightweight hook to manage a Stockfish web worker with safe lifecycle handling.
 *
 * Exposes:
 *  - send(commandOrObject)
 *  - startAnalysis(fenOrMoves)
 *  - stopAnalysis()
 *  - setOptions({ threads, hash, skill })
 *  - terminate()
 *
 * The hook returns an object { send, startAnalysis, stopAnalysis, setOptions, terminate, lastMessage, status }
 */

export default function useStockfish(workerUrl = '/stockfish.worker.js') {
  const workerRef = useRef(null);
  const mountedRef = useRef(false);
  const [lastMessage, setLastMessage] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | running | error

  // initialize the worker
  useEffect(() => {
    mountedRef.current = true;
    try {
      // prefer explicit path (public folder). Adjust if your build serves worker elsewhere.
      const w = new Worker(workerUrl);
      workerRef.current = w;

      w.onmessage = (e) => {
        try {
          const data = e && e.data;
          // handle structured messages (our worker uses { type, data } format)
          if (data && typeof data === 'object' && data.type) {
            if (data.type === 'engine') {
              // engine forward
              setLastMessage((_) => data.data);
            } else if (data.type === 'error') {
              setStatus('error');
              setLastMessage(data);
            } else {
              // other informational messages
              setLastMessage(data);
            }
          } else {
            // fallback: accept string messages
            setLastMessage(data);
          }
        } catch (err) {
          // avoid crash on malformed messages
          console.error('useStockfish: malformed worker message', err);
          setStatus('error');
          setLastMessage({ type: 'error', message: String(err) });
        }
      };

      w.onerror = (err) => {
        console.error('Stockfish worker error', err);
        setStatus('error');
        setLastMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
      };

      setStatus('idle');
    } catch (err) {
      console.error('Failed to create stockfish worker', err);
      setStatus('error');
      setLastMessage({ type: 'error', message: err && err.message });
    }

    return () => {
      mountedRef.current = false;
      if (workerRef.current) {
        try {
          // ask worker to terminate gracefully if it supports that message shape
          try {
            workerRef.current.postMessage({ action: 'terminate' });
          } catch (e) { /* ignore */ }
          workerRef.current.terminate();
        } catch (err) {
          // ignore termination errors
        } finally {
          workerRef.current = null;
        }
      }
    };
    // NOTE: workerUrl is intentionally omitted from deps so hook acts like singleton per mount.
    // If you change workerUrl dynamically, you should re-initialize by remounting the hook consumer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback((cmd) => {
    if (!workerRef.current) {
      console.warn('useStockfish: send called but worker is not initialized');
      return;
    }
    try {
      workerRef.current.postMessage(cmd);
    } catch (err) {
      console.error('useStockfish send failed', err);
      setStatus('error');
      setLastMessage({ type: 'error', message: err && err.message });
    }
  }, []);

  const setOptions = useCallback((opts = {}) => {
    // Normalize options and send supported setoption commands
    if (!workerRef.current) return;
    const { threads, hash, skill } = opts;
    if (typeof threads === 'number') {
      send(`setoption name Threads value ${Math.max(1, Math.floor(threads))}`);
    }
    if (typeof hash === 'number') {
      send(`setoption name Hash value ${Math.max(1, Math.floor(hash))}`);
    }
    if (typeof skill === 'number') {
      send(`setoption name Skill Level value ${Math.max(0, Math.min(20, Math.floor(skill)))}`);
    }
  }, [send]);

  const startAnalysis = useCallback((positionOrFen) => {
    if (!workerRef.current) return;
    // two forms: direct fen or "position startpos moves e2e4 e7e5"
    try {
      setStatus('running');
      if (typeof positionOrFen === 'string') {
        if (positionOrFen.toLowerCase().startsWith('position') || positionOrFen.includes(' ')) {
          // assume full uci position command
          send(positionOrFen);
        } else {
          // assume fen
          send(`position fen ${positionOrFen}`);
        }
        // kick off search
        send('go infinite');
      }
    } catch (err) {
      console.error('startAnalysis failed', err);
      setStatus('error');
      setLastMessage({ type: 'error', message: err && err.message });
    }
  }, [send]);

  const stopAnalysis = useCallback(() => {
    if (!workerRef.current) return;
    try {
      send('stop');
      setStatus('idle');
    } catch (err) {
      console.error('stopAnalysis failed', err);
      setStatus('error');
      setLastMessage({ type: 'error', message: err && err.message });
    }
  }, [send]);

  const terminate = useCallback(() => {
    if (!workerRef.current) return;
    try {
      try { workerRef.current.postMessage({ action: 'terminate' }); } catch (_) {}
      workerRef.current.terminate();
    } catch (err) {
      console.error('terminate failed', err);
    } finally {
      workerRef.current = null;
      setStatus('idle');
    }
  }, []);

  return {
    send,
    startAnalysis,
    stopAnalysis,
    setOptions,
    terminate,
    lastMessage,
    status,
  };
}

