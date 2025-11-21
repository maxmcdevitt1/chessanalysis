import React, { useState } from 'react';

const Controls = ({ onUpload, onPrev, onNext, onAnalyze, canAnalyze, isAnalyzing, progress }) => {
    
    // State for managing the Paste PGN box visibility
    const [pasteMode, setPasteMode] = useState(false);
    const [pgnText, setPgnText] = useState("");

    // --- 1. File Upload Handler ---
    const handleFile = (e) => {
        const file = e.target.files[0];
        
        // DEBUG: Confirm file selection
        console.log("File selected:", file ? file.name : "None"); 
        
        if (file) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                // DEBUG: Confirm file content read
                console.log("File content loaded. Starting upload process..."); 
                onUpload(evt.target.result);
            };
            reader.readAsText(file);
        }
    };

    // --- 2. Paste PGN Handler ---
    const handlePasteLoad = () => {
        if (pgnText.trim()) {
            onUpload(pgnText);
            setPgnText(""); // Clear after loading
            setPasteMode(false); // Close the menu
        }
    };

    // Calculate progress percentage defensively
    // This addresses the "Cannot read properties of undefined (reading 'total')" error
    const progressPercent = (progress && progress.total && progress.total > 0) 
        ? Math.round((progress.current / progress.total) * 100) 
        : 0;

    return (
        <div className="controls-container">
            
            {/* --- INPUT SECTION (File Upload or Paste) --- */}
            <div className="input-group">
                {!pasteMode ? (
                    <>
                        <label className="file-upload-btn">
                            Upload PGN File
                            <input type="file" accept=".pgn" onChange={handleFile} style={{ display: 'none' }} />
                        </label>
                        <button className="text-btn" onClick={() => setPasteMode(true)}>
                            or Paste Text
                        </button>
                    </>
                ) : (
                    <div className="paste-area">
                        <textarea 
                            placeholder="Paste moves here (e.g. 1. e4 e5...)"
                            value={pgnText}
                            onChange={(e) => setPgnText(e.target.value)}
                        />
                        <div className="paste-actions">
                            <button onClick={handlePasteLoad} className="confirm-btn">Load</button>
                            <button onClick={() => setPasteMode(false)} className="cancel-btn">Cancel</button>
                        </div>
                    </div>
                )}
            </div>

            {/* --- NAVIGATION --- */}
            <div className="nav-buttons">
                <button onClick={onPrev}>&lt; Prev</button>
                <button onClick={onNext}>Next &gt;</button>
            </div>
            
            {/* --- ANALYSIS BUTTON --- */}
            <button 
                className="analyze-btn" 
                onClick={onAnalyze}
                disabled={!canAnalyze || isAnalyzing}
            >
                {isAnalyzing 
                    ? `Analyzing... ${progressPercent}%` 
                    : "Run Stockfish Analysis"}
            </button>
        </div>
    );
};

export default Controls;
