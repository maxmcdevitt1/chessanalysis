import { useCallback, useEffect, useRef, useState } from 'react';

// Define the analysis depth (how many plies Stockfish searches)
const ANALYSIS_DEPTH = 18; 

/**
 * useStockfish
 * Manages the Stockfish web worker for deep analysis of multiple FENs.
 */
export default function useStockfish(workerUrl = '/stockfish.worker.js') {
  const workerRef = useRef(null);
  const mountedRef = useRef(false);
  const [analyzedData, setAnalyzedData] = useState({}); // Stores { fen: { eval, bestMove, ... } }
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ total: 0, current: 0 });

  // Queue of FENs to be analyzed
  const analysisQueueRef = useRef([]); 
  // Ref to store the current FEN being analyzed
  const currentFenRef = useRef(null); 
  
  // --- Worker Messaging ---
  const send = useCallback((command) => {
    if (workerRef.current) {
      workerRef.current.postMessage(command);
    }
  }, []);

  const processNextInQueue = useCallback(() => {
    if (analysisQueueRef.current.length > 0) {
      const nextFen = analysisQueueRef.current.shift();
      currentFenRef.current = nextFen;
      
      // UCI command: set position and start search
      send(`position fen ${nextFen}`);
      send(`go depth ${ANALYSIS_DEPTH}`);
    } else {
      // Queue is empty: analysis complete
      setIsAnalyzing(false);
      currentFenRef.current = null;
      send('stop'); 
      console.log("Analysis completed for all FENs in the queue.");
    }
  }, [send]);

  // --- Worker Setup ---

  useEffect(() => {
    mountedRef.current = true;
    try {
      const w = new Worker(workerUrl);
      workerRef.current = w;

      w.onmessage = (e) => {
        const message = e && e.data;
        const currentFen = currentFenRef.current;

        if (typeof message === 'string') {
            const parts = message.split(' ');
            
            // 1. Process 'info' lines to extract score and best move
            if (parts[0] === 'info' && currentFen) {
                // Find and extract score (cp or mate)
                let score = { type: 'cp', value: 0 };
                let bestMove = null;

                const cpIndex = parts.indexOf('cp');
                if (cpIndex !== -1) {
                    score = { type: 'cp', value: parseInt(parts[cpIndex + 1], 10) };
                } else {
                    const mateIndex = parts.indexOf('mate');
                    if (mateIndex !== -1) {
                        score = { type: 'mate', value: parseInt(parts[mateIndex + 1], 10) };
                    }
                }
                
                // Find and extract best move
                const pvIndex = parts.indexOf('pv');
                if (pvIndex !== -1 && parts.length > pvIndex + 1) {
                    bestMove = parts[pvIndex + 1]; // UCI format (e.g., 'g1f3')
                }
                
                // Only update analysis data on the *deepest* result we get (or whenever a bestMove is found)
                if (score.type !== 'cp' || parts.includes('depth')) {
                    setAnalyzedData(prevData => {
                        const existing = prevData[currentFen] || {};
                        const newDepth = parseInt(parts[parts.indexOf('depth') + 1] || '0', 10);

                        // Only store if it's the final depth result OR an improvement
                        if (!existing.depth || newDepth >= existing.depth) {
                            return {
                                ...prevData,
                                [currentFen]: {
                                    ...existing,
                                    eval: score,
                                    bestMove: bestMove || existing.bestMove,
                                    depth: newDepth,
                                    // Add best line for future use if needed
                                    pv: parts.slice(pvIndex + 1).join(' ') 
                                }
                            };
                        }
                        return prevData;
                    });
                }
            }

            // 2. Process 'bestmove' line (signals end of search for the current FEN)
            if (parts[0] === 'bestmove' && currentFen) {
                // Update progress after bestmove is received
                setProgress(prev => ({ ...prev, current: prev.current + 1 }));
                
                // Move to the next FEN in the queue
                processNextInQueue();
            }
        }
      };

      // Initial UCI commands
      send('uci');
      send('setoption name Threads value 1'); // Keep threads low for worker stability
      send('setoption name Hash value 128'); // Reasonable hash size
      send('isready');

    } catch (e) {
      console.error("Failed to initialize Stockfish worker:", e);
      setIsAnalyzing(false);
    }

    return () => {
      // Terminate worker on unmount
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  // --- External Control Functions ---

  const startAnalysis = useCallback((fenArray) => {
    if (isAnalyzing || !workerRef.current) return;
    
    // Filter out FENs that have already been fully analyzed at the target depth
    const fensToAnalyze = fenArray.filter(fen => {
        const data = analyzedData[fen];
        return !data || data.depth < ANALYSIS_DEPTH;
    });

    if (fensToAnalyze.length === 0) {
        console.log("All positions already analyzed.");
        return;
    }

    setIsAnalyzing(true);
    setProgress({ total: fensToAnalyze.length, current: 0 });
    
    // Clear the current queue and load the new list
    analysisQueueRef.current = fensToAnalyze; 
    
    // Start the analysis process
    processNextInQueue();

  }, [isAnalyzing, analyzedData, processNextInQueue]);


  return {
    analyzedData,
    isAnalyzing,
    progress,
    startAnalysis,
    // Add other controls if needed (e.g., setOptions, stopAnalysis)
  };
}
