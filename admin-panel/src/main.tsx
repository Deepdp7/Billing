import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts ship with the panel (no wait for Google Fonts at start)
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/outfit/latin-600.css';
import '@fontsource/outfit/latin-700.css';
import '@fontsource/outfit/latin-800.css';
import './index.css';
import { App } from './App';
import { ThemeProvider } from './theme';
import { DialogHost } from './components/dialogs';
import { DesktopFrame } from './components/TitleBar';
import { isDesktopApp } from './lib/desktop';
import { disableTooltips } from './lib/noTooltips';
import { installFullscreenKey } from './lib/windowState';
import { installUiScale } from './lib/uiScale';
import { applyPerformanceMode } from './lib/performance';

if (isDesktopApp()) document.documentElement.classList.add('tauri-shell');
disableTooltips();
installFullscreenKey();
installUiScale();
applyPerformanceMode();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <DesktopFrame>
        <App />
      </DesktopFrame>
    </ThemeProvider>
    <DialogHost />
  </StrictMode>,
);
