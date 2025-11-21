import React, { memo } from 'react';

const EvalBar = memo(({ currentScore }) => {
    // currentScore is in centipawns (e.g., 150 for +1.50)
    // We cap the visual at +5/-5 (500cp) because anything more is just "winning"
    const cap = 500; 
    
    // Clamp the score between -500 and 500. Mate scores (5000/-5000) will hit the cap.
    let score = Math.max(-cap, Math.min(cap, currentScore));
    
    // Calculate percentage for the White bar height (50% is equal)
    const whiteHeight = 50 + (score / cap) * 50;
    
    // Display score for the user (always in pawns, capped for display text)
    let displayScore;
    if (Math.abs(currentScore) >= 4500) {
        displayScore = score > 0 ? '#M' : '-#M'; // Show Mate if score is high enough
    } else {
        const sign = currentScore >= 0 ? '+' : '';
        displayScore = `${sign}${(currentScore / 100).toFixed(1)}`;
    }


    return (
        <div style={styles.container}>
            {/* Black part of the bar (background) */}
            <div style={styles.barBackground}>
                {/* White part of the bar */}
                <div style={{ ...styles.whiteBar, height: `${whiteHeight}%` }} />
                
                {/* The text score */}
                <span style={styles.scoreText}>
                    {displayScore}
                </span>
            </div>
        </div>
    );
});

const styles = {
    container: {
        width: '30px',
        height: '700px', // Match board height
        marginRight: '15px',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '4px',
    },
    barBackground: {
        width: '100%',
        height: '100%',
        backgroundColor: '#404040', // Dark grey (Black's advantage)
        position: 'relative',
        display: 'flex',
        flexDirection: 'column-reverse', // Grow from bottom
        border: '2px solid #555',
        borderRadius: '4px',
        overflow: 'hidden'
    },
    whiteBar: {
        width: '100%',
        backgroundColor: '#ffffff', // White's advantage
        transition: 'height 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)' // Smooth animation
    },
    scoreText: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        color: '#ccc',
        fontWeight: 'bold',
        fontSize: '1rem',
        textShadow: '0 0 5px rgba(0,0,0,0.8)',
        zIndex: 10,
    }
};

export default EvalBar;
