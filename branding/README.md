# Branding

All logos, icons and installer pictures of **Apna Billing** (client app, emerald) and **Apna Billing Admin**
(your admin app, indigo). Everything here is made by one script from the current app icons, or from pictures you
paste into `source/` (for example from Gemini):

```
python scripts/build-branding.py
```

Then look at `preview.png` to check the result.

Colours: client emerald `#34D399` / `#10B981` / `#059669` / `#064E3B` / `#022C22`;
admin indigo `#818CF8` / `#6366F1` / `#3730A3` / `#1E1B4B` / `#0C0A24`.

## Originals you can paste (all optional)

| File in `source/` | Aspect ratio to choose in Gemini | What it is |
|---|---|---|
| `app-icon.png` | 1 : 1 (square) | Client icon tile on a plain white background |
| `admin-icon.png` | 1 : 1 | Admin icon tile on a plain white background |
| `sidebar-art.png` | 9 : 16 (tall) | Background art for the client installer's side panel, **no text** |
| `admin-sidebar-art.png` | 9 : 16 | The same for the admin installer |

Gemini cannot give exact pixel sizes, so choose the aspect ratio and the largest size it offers. The script crops
and resizes. It always draws the name, tagline and icon itself, so they stay sharp; that is why the
background art must have no text.

## Made by the script (do not edit by hand)

| File | Size | Used for |
|---|---|---|
| `app-icon/<app>.png` | 1024 × 1024 | Master icon (transparent corners) |
| `installer/<app>/installer-icon.ico` | 16–256 (incl. 20, 40, 96) | Icon of `Setup.exe` |
| `installer/<app>/sidebar-492x942.bmp` | 492 × 942 | Welcome and finish pages, 3× of the classic 164 × 314. Installer Studio makes every display scaling (100–300 %) from it |
| `installer/<app>/sidebar-328x628.bmp` | 328 × 628 | Same, 2× (Tauri's own setup) |
| `installer/<app>/sidebar-164x314.bmp` | 164 × 314 | Same, classic size |
| `installer/<app>/header-450x171.bmp` | 450 × 171 | Top right of the inner pages, 3× of 150 × 57 (Installer Studio) |
| `installer/<app>/header-300x114.bmp` | 300 × 114 | Same, 2× |
| `installer/<app>/header-150x57.bmp` | 150 × 57 | Same, classic size |
| `installer/<app>/wizard-small-*.bmp` | 55 × 58, 110 × 116 | Small picture for Inno Setup installers |
| `installer/<app>/banner-493x58.bmp`, `dialog-493x312.bmp` | | For an `.msi` installer |
| `logo/<app>-logo-dark.png`, `-logo-light.png` | 2400 × 800 | Logo with name and tagline |
| `logo/<app>-symbol.png` | 512 × 512 | Icon alone |
| `marketing/<app>-share-1200x630.png` | 1200 × 630 | WhatsApp / Facebook / link preview picture |

## Where the pictures are used

Both installers are made with Installer Studio from `deploy/installer-studio/Apna Billing.isproj` and
`Apna Billing Admin.isproj`, which use `installer/apna-billing/` and `installer/apna-billing-admin/`
(`npm run build` and `npm run build:admin-app` fill these paths in, using the 3× sidebar and header). Installer
Studio puts each picture into the setup at 100, 125, 150, 175, 200, 250 and 300 % and, when the setup opens, draws
the one that fits the PC's display scaling, so the pictures are sharp everywhere. Tauri's own setup
(`tauri/src-tauri/tauri.conf.json`, `bundle.windows.nsis`) uses the same pictures; it is built but not given out.

## After changing an icon

1. `python scripts/build-branding.py`
2. Rebuild the app's own Windows icons:
   client `cd tauri` then `npx tauri icon ../branding/app-icon/apna-billing.png`;
   admin `cd admin-tauri` then `npx tauri icon ../branding/app-icon/apna-billing-admin.png`.
3. Build again (`npm run build`, `npm run build:admin-app`).
