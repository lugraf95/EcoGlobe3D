import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App } from './components/App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <BrowserRouter>
            <Routes>
                <Route path="/:layerId" element={<App />} />
                <Route path="/" element={<Navigate to="/normal" replace />} />
            </Routes>
        </BrowserRouter>
    </React.StrictMode>,
);