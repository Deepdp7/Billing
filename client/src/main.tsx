import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DialogHost } from './components/ui/dialogs.tsx'
import { DesktopFrame } from './components/layout/TitleBar.tsx'
import { isDesktopApp } from './lib/desktop.ts'
import { installDesktopShield } from './lib/desktopShield.ts'

if (isDesktopApp()) {
  document.documentElement.classList.add('tauri-shell')
  // Block browser/WebView chrome (Ctrl+Shift+R, F5, zoom, DevTools, …).
  // Typing, copy/paste, scroll, and window min/max/close stay enabled.
  installDesktopShield()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopFrame>
      <App />
    </DesktopFrame>
    <DialogHost />
  </StrictMode>,
)
