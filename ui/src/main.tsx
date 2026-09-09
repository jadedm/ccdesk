import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/newsreader';
import '@fontsource-variable/newsreader/wght-italic.css';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import App from './App.tsx';
import { loadPrefs } from './prefs.ts';

// Apply the stored theme before the first paint so a dark-theme user never sees a light frame.
document.documentElement.dataset.theme = loadPrefs().theme;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
