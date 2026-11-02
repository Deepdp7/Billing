import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { ThemeProvider } from './theme';
import { DialogHost } from './components/dialogs';
import { DesktopFrame } from './components/TitleBar';
import { isDesktopApp } from './lib/desktop';

if (isDesktopApp()) document.documentElement.classList.add('tauri-shell');

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
