import { useEffect, useRef, useState, useCallback } from 'react';

// Removed ANALYSIS_DEPTH as we now use movetime
const ANALYSIS_TIMEOUT_MS = 5000; // Force-clear job if stuck for 5 seconds

export function useStockfish() {
    const workerRef = useRef(null);
    const [analyzedData, setAnalyzedData] = useState({});
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const analysisQueue = useRef([]);
    const timeoutRef = useRef(null); // Timer for job stability

    
    // Define processNext and advanceQueue using useCallback, but with a temporary structure 
    // to handle the circular dependency error gracefully.
    const processNext = useRef(null); // Use a ref for the function

    // Helper to advance the queue, regardless of result
    const advanceQueue = useCallback(() => {
        clearTimeout(timeoutRef.current); // Clear any running timeout
        analysisQueue.current.shift();
        setProgress(prev => ({ ...prev, current: prev.current + 1 }));
        if (processNext.current) {
            processNext.current(); // Call the function through the ref
        }
    }, []); // Empty dependency array is safe now

    const actualProcessNext = useCallback(() => {
        if (analysisQueue.current.length > 0) {
            const job = analysisQueue.current[0];
            
            // Start a timeout to prevent permanent stall if engine is silent
            timeoutRef.current = setTimeout(() => {
                console.warn(`Analysis timed out for FEN: ${job.fen}. Forcibly advancing queue.`);
                advanceQueue();
            }, ANALYSIS_TIMEOUT_MS);

            // Send command to worker (Using 2000ms movetime for quick, predictable speed)
            workerRef.current.postMessage({
                command: 'ANALYZE_POSITION',
                data: { fen: job.fen, movetime: 2000 }
            });

        } else {
            setIsAnalyzing(false);
            setProgress({ current: 0, total: 0 });
        }
    }, [advanceQueue]); // advanceQueue is the only dependency

    // Assign the actual function to the ref after definition
    processNext.current = actualProcessNext;


    // Handle messages coming FROM the worker
    const handleEngineOutput = useCallback((output) => {
        // 1. Best Move Found (Job Done)
        if (output.startsWith('bestmove')) {
            const bestMove = output.split(' ')[1];
            const currentJob = analysisQueue.current[0];

            if (currentJob) {
                setAnalyzedData(prev => ({
                    ...prev,
                    [currentJob.fen]: {
                        ...prev[currentJob.fen],
                        bestMove: bestMove
                    }
                }));
                advanceQueue(); // Job finished successfully, advance
            }
        }

        // 2. Score Update (During Job)
        const scoreMatch = output.match(/score\s(cp|mate)\s(-?\d+)/);
        if (scoreMatch && analysisQueue.current.length > 0) {
            const type = scoreMatch[1];
            const val = parseInt(scoreMatch[2]);
            const currentFen = analysisQueue.current[0].fen;
            
            setAnalyzedData(prev => ({
                ...prev,
                [currentFen]: {
                    ...prev[currentFen],
                    eval: { type, value: val }
                }
            }));
        }
    }, [advanceQueue]);

    // Initialize Worker
    useEffect(() => {
        workerRef.current = new Worker('/stockfish.worker.js');
        workerRef.current.onmessage = (e) => {
            if (e.data.type === 'ENGINE_OUTPUT') handleEngineOutput(e.data.content);
        };
        workerRef.current.postMessage({ command: 'INIT' });

        return () => {
            clearTimeout(timeoutRef.current);
            workerRef.current.terminate();
        }
    }, [handleEngineOutput]);

    // Public function to start analysis
    const startAnalysis = (fenList) => {
        const fensToAnalyze = fenList.filter(fen => !analyzedData[fen]);
        if (fensToAnalyze.length === 0) return;
        
        setIsAnalyzing(true);
        analysisQueue.current = fensToAnalyze.map(f => ({ fen: f }));
        setProgress({ current: 0, total: fensToAnalyze.length });
        if (processNext.current) {
            processNext.current(); // Call through the ref
        }
    };

    return { analyzedData, isAnalyzing, progress, startAnalysis };
}
