import './LoadingSpinner.scss';

export function LoadingSpinner() {
    return (
        <div className="loading-pill-container">
            <div className="spinner-ring"></div>
            <span>Lade Daten...</span>
        </div>
    );
}
