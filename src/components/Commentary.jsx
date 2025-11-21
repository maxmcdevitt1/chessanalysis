import React, { memo } from 'react';
import PropTypes from 'prop-types';

// Memoized to avoid rerendering on every engine tick
const Commentary = memo(({ data }) => {
    if (!data) {
        return (
            <div className="commentary-placeholder">
                Make a move to see analysis
            </div>
        );
    }

    // Defensive normalization
    const {
        color = '#888',
        title = 'No title',
        classification = 'Unclassified',
        text = '',
        score = '—',
        bestMove = '…'
    } = data;

    return (
        <div className="commentary-card" style={{ borderLeft: `5px solid ${color}` }}>
            <h3>{title}</h3>
            <h4 style={{ color }}>{classification}</h4>
            <p>{text}</p>
            <hr />
            <div className="stats">
                <p>Eval: <strong>{score}</strong></p>
                <p>Best Line: <strong>{bestMove}</strong></p>
            </div>
        </div>
    );
});

Commentary.propTypes = {
    data: PropTypes.shape({
        color: PropTypes.string,
        title: PropTypes.string,
        classification: PropTypes.string,
        text: PropTypes.string,
        score: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        bestMove: PropTypes.string
    })
};

export default Commentary;
