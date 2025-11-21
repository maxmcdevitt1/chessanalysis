import React from 'react';

const Commentary = ({ data }) => {
    if (!data) return <div className="commentary-placeholder">Make a move to see analysis</div>;

    return (
        <div className="commentary-card" style={{ borderLeft: `5px solid ${data.color}` }}>
            <h3>{data.title}</h3>
            <h4 style={{ color: data.color }}>{data.classification}</h4>
            <p>{data.text}</p>
            <hr />
            <div className="stats">
                <p>Eval: <strong>{data.score}</strong></p>
                <p>Best Line: <strong>{data.bestMove || "..."}</strong></p>
            </div>
        </div>
    );
};
export default Commentary;
