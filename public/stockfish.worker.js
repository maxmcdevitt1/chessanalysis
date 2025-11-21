// public/stockfish.worker.js
// Replace the existing worker file with this content.
// This file expects a "stockfish.js" (or wasm) loader available in the same folder.
// It sets a safe cap on threads and forwards messages between the engine and the main thread.

(function () {
  'use strict';

  // Small helper to post structured messages
  function safePost(obj) {
    try {
      postMessage(obj);
    } catch (err) {
      // if we can't post, there's nothing we can do; swallow to avoid worker crash
    }
  }

  // Attempt to import stockfish engine script if present.
  // If your distribution ships a different path, change the importScripts path accordingly.
  try {
    // if the repo has a combined worker (e.g., Emscripten output), importScripts may be unnecessary.
    // Keep this call safe — if stockfish.js is not present, we'll continue but will error gracefully.
    importScripts('stockfish.js');
  } catch (e) {
    // not fatal here; we'll try to detect engine creation below
  }

  // Engine instance — some Stockfish builds expose a global function STOCKFISH()
  // Others provide a 'self.Module' style. We try common forms.
  var engine = null;
  try {
    if (typeof STOCKFISH === 'function') {
      engine = STOCKFISH();
    } else if (typeof self.STOCKFISH === 'function') {
      engine = self.STOCKFISH();
    } else if (typeof self.Module !== 'undefined' && typeof self.Module.ccall !== 'undefined') {
      // Fallbacks for other builds could go here if necessary.
      // For now, we attempt to use a generic wrapper if present:
      if (typeof self.stockfish === 'function') engine = self.stockfish();
    }
  } catch (err) {
    safePost({ type: 'error', message: 'Engine init failed: ' + (err && err.message) });
    engine = null;
  }

  // Compute safe thread count
  (function setSafeThreads() {
    try {
      var hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
      // Conservative cap: don't allocate more than 4 threads, leave one core for UI: threads = hw - 1
      var threads = Math.max(1, Math.min(4, (hw | 0) - 1));
      if (!threads || typeof threads !== 'number') threads = 1;
      if (engine && typeof engine.postMessage === 'function') {
        engine.postMessage('setoption name Threads value ' + threads);
      } else {
        // If engine isn't available, still notify the main thread about the recommended thread count.
        safePost({ type: 'info', message: 'recommendedThreads', threads: threads });
      }
    } catch (err) {
      // non-fatal; continue
      safePost({ type: 'warn', message: 'thread cap computation failed: ' + (err && err.message) });
    }
  })();

  // If engine exists and exposes onmessage handler, forward engine outputs to main thread.
  if (engine && typeof engine.onmessage === 'function') {
    engine.onmessage = function (event) {
      try {
        // Forward raw text lines as structured messages
        safePost({ type: 'engine', data: event.data });
      } catch (err) {
        safePost({ type: 'error', message: 'Failed forwarding engine message: ' + (err && err.message) });
      }
    };
  }

  // Worker receives commands from main thread and forwards them to the engine.
  onmessage = function (e) {
    try {
      var msg = e && e.data;
      if (!engine) {
        // no engine available — return structured error so main thread can react
        safePost({ type: 'error', message: 'No engine available in worker to handle message', original: msg });
        return;
      }
      // Basic validation — only allow string commands or simple objects with "cmd"
      if (typeof msg === 'string') {
        engine.postMessage(msg);
      } else if (msg && typeof msg === 'object') {
        if (msg.cmd && typeof msg.cmd === 'string') {
          engine.postMessage(msg.cmd);
        } else if (msg.action === 'terminate') {
          // optional: allow main thread to ask worker to free engine resources
          try {
            if (engine && typeof engine.terminate === 'function') {
              engine.terminate();
            }
          } catch (err) {
            // ignore
          }
          safePost({ type: 'terminated' });
        } else {
          // unknown object shape — forward as JSON if engine accepts it (some builds do not)
          try {
            engine.postMessage(msg);
          } catch (err) {
            safePost({ type: 'error', message: 'Unsupported message shape for engine', original: msg });
          }
        }
      } else {
        safePost({ type: 'error', message: 'Unsupported message type to worker', value: msg });
      }
    } catch (err) {
      safePost({ type: 'error', message: 'Worker onmessage error: ' + (err && err.message) });
    }
  };

  // optional: run a basic engine init command for UCI engines
  try {
    if (engine && typeof engine.postMessage === 'function') {
      engine.postMessage('uci');
    }
  } catch (err) {
    safePost({ type: 'warn', message: 'Failed to send initial uci: ' + (err && err.message) });
  }
})();

