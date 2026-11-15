; Apna Billing installer hooks (bundle > windows > nsis > installerHooks in tauri.conf.json).
; Customer data lives in %APPDATA%\ApnaBilling and is never touched by install, update or uninstall.

!macro NSIS_HOOK_PREINSTALL
  ; Stop a local engine left running so its files can be replaced.
  nsExec::Exec 'taskkill /F /IM apna-billing-engine.exe'
  Pop $0
  ; Versions before 1.2 installed a Node.js runtime with the server's JavaScript and node_modules in "app".
  RMDir /r "$INSTDIR\app"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM apna-billing-engine.exe'
  Pop $0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  RMDir /r "$INSTDIR\engine"
  RMDir /r "$INSTDIR\app"
!macroend
