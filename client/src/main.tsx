import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DialogHost } from './components/ui/dialogs.tsx'
import { DesktopFrame } from './components/layout/TitleBar.tsx'
import { isDesktopApp } from './lib/desktop.ts'

if (isDesktopApp()) {
  document.documentElement.classList.add('tauri-shell')
  // WebView2 otherwise lets two-finger gestures drag the whole page sideways.
  const lockPan = (e: WheelEvent | TouchEvent) => {
    if (e instanceof WheelEvent && Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault()
  }
  window.addEventListener('wheel', lockPan, { passive: false })
  window.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault()
  }, { passive: false })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopFrame>
      <App />
    </DesktopFrame>
    <DialogHost />
  </StrictMode>,
)
