import React from 'react';

const EvalBar = ({ currentScore }) => {
    // currentScore is in centipawns (e.g., 150 for +1.50)
    // We cap the visual at +5/-5 (500cp) because anything more is just "winning"
    const cap = 500; 
    
    // Clamp the score between -500 and 500
    let score = Math.max(-cap, Math.min(cap, currentScore));
    
    // Calculate percentage for the White bar height (50% is equal)
    // If score is 0, height is 50%. If score is +500, height is 100%.
    const whiteHeight = 50 + (score / cap) * 50;

    return (
        <div style={styles.container}>
            {/* Black part of the bar (background) */}
            <div style={styles.barBackground}>
                {/* White part of the bar */}
                <div style={{ ...styles.whiteBar, height: `${whiteHeight}%` }} />
                
                {/* The text score */}
                <span style={styles.scoreText}>
                    {score > 0 ? '+' : ''}{(score / 100).toFixed(1)}
                </span>
            </div>
        </div>
    );
};

const styles = {
    container: {
        width: '30px',
        height: '700px', // Match board height
        marginRight: '10px',
        display: 'flex',
        flexDirection: 'column'
    },
    barBackground: {
        width: '100%',
        height: '100%',
        backgroundColor: '#404040', // Dark grey (Black's advantage)
        position: 'relative',
        display: 'flex',
        flexDirection: 'column-reverse', // Grow from bottom
        border: '2px solid #555'
    },
    whiteBar: {
        width: '100%',
        backgroundColor: '#ffffff', // White's advantage
        transition: 'height 0.5s ease-in-out' // Smooth animation
    },
    scoreText: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        color: '#888',
        fontWeight: 'bold',
        fontSize: '12px',
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: '2px 4px',
        borderRadius: '3px'
    }
};

export default EvalBar;
