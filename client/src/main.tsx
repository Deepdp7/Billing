import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts ship with the app (no wait for Google Fonts at start, and they work offline)
import '@fontsource/inter/latin-300.css'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/inter/latin-800.css'
import '@fontsource/outfit/latin-500.css'
import '@fontsource/outfit/latin-600.css'
import '@fontsource/outfit/latin-700.css'
import '@fontsource/outfit/latin-800.css'
import './index.css'
import App from './App.tsx'
import { DialogHost } from './components/ui/dialogs.tsx'
import { DesktopFrame } from './components/layout/TitleBar.tsx'
import { isDesktopApp } from './lib/desktop.ts'
import { installDesktopShield } from './lib/desktopShield.ts'
import { disableTooltips } from './lib/noTooltips.ts'
import { installFullscreenKey } from './lib/windowState.ts'
import { installUiScale } from './lib/uiScale.ts'
import { applyPerformanceMode } from './lib/performance.ts'
import { installScanner } from './lib/scanner.ts'

if (isDesktopApp()) {
  document.documentElement.classList.add('tauri-shell')
  // Block browser/WebView chrome (Ctrl+Shift+R, F5, zoom, DevTools, …).
  // Typing, copy/paste, scroll, and window min/max/close stay enabled.
  installDesktopShield()
}

disableTooltips()
installFullscreenKey()
installUiScale()
applyPerformanceMode()
// Barcode scanners work on every screen, without clicking into a box first
installScanner()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopFrame>
      <App />
    </DesktopFrame>
    <DialogHost />
  </StrictMode>,
)
