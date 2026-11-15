import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startSync } from './data/sync';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startSync();

// Offline support: after the first visit the app opens without internet.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Offline mode not available', e));
  });
}

// Ask the browser not to clear our saved orders when space runs low.
void navigator.storage?.persist?.();
