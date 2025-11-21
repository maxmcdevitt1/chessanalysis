// Variable to hold the Stockfish engine instance
let engine;

// Load the necessary Stockfish JS file
// Note: This relies on 'stockfish.js' being in the same directory (public/)
self.importScripts('stockfish.js');

// Function to initialize the Stockfish engine
function initEngine() {
    // Stockfish exposes itself globally when stockfish.js is imported
    if (typeof Stockfish === 'function') {
        engine = Stockfish();
        engine.onmessage = handleEngineMessage;
        // --- CRUCIAL: Set the number of threads ---
        // We use Math.max(2, ...) to ensure at least 2 threads are used, 
        // or one less than your total available cores.
        const threads = Math.max(2, navigator.hardwareConcurrency - 1); 
        engine.postMessage('setoption name Threads value ' + threads);
        console.log(`Stockfish initialized with ${threads} threads.`);
        // ------------------------------------------
        console.log("Stockfish engine initialized.");
    } else {
        console.error("Stockfish factory function not found.");
    }
}

// Handler for messages coming FROM the Stockfish engine
function handleEngineMessage(data) {
    // Forward the engine's text output back to the main thread
    self.postMessage({
        type: 'ENGINE_OUTPUT',
        content: data
    });
}

// Handler for messages coming FROM the main thread (your React app)
self.onmessage = (e) => {
    const { command, data } = e.data;

    switch (command) {
        case 'INIT':
            initEngine();
            break;

        case 'ANALYZE_POSITION':
            if (engine) {
                // 1. Set the FEN
                engine.postMessage('position fen ' + data.fen);
                
                // 2. Start analysis (using a fixed depth for stability)
                engine.postMessage('go depth ' + data.depth);
            }
            break;
            
        case 'TERMINATE':
            if (engine) {
                // Cleanup (though usually terminated by main thread)
                engine.terminate();
                engine = null;
            }
            break;
            
        case 'SET_OPTION':
            // Example: To set threads or hash size
            if (engine) {
                engine.postMessage(`setoption name ${data.name} value ${data.value}`);
            }
            break;

        default:
            console.warn(`Unknown worker command: ${command}`);
            break;
    }
};

// Initial setup to run immediately upon worker creation
// (This is redundant if 'INIT' command is sent, but ensures initial state)
// initEngine();