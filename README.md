# HashMeet Desktop

HashMeet Desktop is the Electron shell for the HashMeet Laravel web app. The
desktop app loads the live web UI directly, so feature parity comes from the
`hashmeet` project while this repo owns native desktop behavior.

## What This App Owns

- Window chrome, app menu, tray hide/show, and quit behavior.
- Camera, microphone, screen-share, and desktop media integration.
- Native screen-share picker and always-on-top sharing toolbar.
- `hashmeet://` deeplink handling, for example
  `hashmeet://meeting/<meeting-id>`.
- External link handling, auto-updates, icons, and packaged installers.

The Laravel web app remains the source of truth for login, dashboard, meetings,
recordings, transcripts, snippets, Zoom fallback, lobby, profile, and admin
screens.

## Requirements

- Node.js 22 or newer.
- npm.
- A running HashMeet web app. For local development, run the sibling
  `../hashmeet` project on `http://localhost:8888`.

Linux development may also need native packages used by Electron and icons:

```bash
sudo apt install libx11-dev zlib1g-dev libpng-dev libxtst-dev libfuse2
```

For Linux screen sharing, the runtime system also needs PipeWire and a working
desktop portal. On Arch/CachyOS/Hyprland, install and enable packages such as
`pipewire`, `xdg-desktop-portal`, and `xdg-desktop-portal-hyprland`.

On Arch/CachyOS, local deb packaging with electron-builder may also need
`libxcrypt-compat` because the bundled `fpm` binary loads `libcrypt.so.1`.

## Run Locally

Start the web app first:

```bash
cd /home/grandonk/Work-Hashmicro/hashmeet-project/hashmeet
composer install
npm install
[ -f .env ] || cp .env.example .env
grep -q '^APP_KEY=base64:' .env || php artisan key:generate
php artisan migrate --seed
npm run dev
```

In another terminal, serve Laravel on the URL expected by the local desktop
configuration:

```bash
cd /home/grandonk/Work-Hashmicro/hashmeet-project/hashmeet
php artisan serve --host=127.0.0.1 --port=8888
```

If you are working on recordings, transcripts, summaries, or queued mail, also
run a worker:

```bash
cd /home/grandonk/Work-Hashmicro/hashmeet-project/hashmeet
php artisan queue:work
```

Install and run the desktop app:

```bash
cd /home/grandonk/Work-Hashmicro/hashmeet-project/hashmeet-desktop
npm install
HASHMEET_DESKTOP_SERVER_URL=http://localhost:8888 npm start
```

On Windows PowerShell:

```powershell
cd C:\path\to\hashmeet-project\hashmeet-desktop
npm install
$env:HASHMEET_DESKTOP_SERVER_URL="http://localhost:8888"
npm start
```

To open DevTools automatically during development:

```bash
SHOW_DEV_TOOLS=true HASHMEET_DESKTOP_SERVER_URL=http://localhost:8888 npm start
```

If `HASHMEET_DESKTOP_SERVER_URL` is not set, the app loads
`https://meet.hashmicro.com`.

Packaged production builds always load `https://meet.hashmicro.com` by default.
`HASHMEET_DESKTOP_SERVER_URL` is ignored in packaged mode unless the build is
started with `HASHMEET_DESKTOP_ALLOW_SERVER_OVERRIDE=true` or
`--allow-server-override` for an explicit test run.

## Development Checks

```bash
npm run check:syntax
npm run build
npm run smoke
npm run verify
```

The `npm run lint` target exists, but this repo currently has inherited lint
violations in `main.js` and `scripts/build-icons.js`; treat it as a cleanup
target before making it required in CI.

Build installers locally:

```bash
npm run dist
npm run dist -- --linux --publish never
```

## Desktop Parity Checklist

- Web app loads the expected environment URL.
- Login and dashboard work in the desktop window.
- A meeting can be created and joined.
- Camera and microphone permission prompts work.
- Screen sharing opens the native picker.
- The native floating toolbar can pause/resume sharing, mute/unmute, and stop
  sharing.
- Closing the main window hides to tray; Quit exits the app.
- `hashmeet://meeting/<meeting-id>` opens the configured HashMeet server.
- External web links open in the system browser.
- Copy Diagnostics works and does not include auth tokens, cookies, URL query
  strings, URL fragments, or unredacted home-directory paths.

## Packaging Notes

Installer metadata lives in `package.json` under the `build` key.

Release builds are produced by `.github/workflows/release.yml` on version tags
such as `v0.1.7`. The workflow packages:

- macOS universal `dmg` and `zip`.
- Windows x64 `nsis` installer.
- Linux x64 `AppImage` and `deb`.

The workflow publishes update metadata for `electron-updater` when running on a
tag. Configure these repository secrets before treating a release as production
ready:

- `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`

Production QA steps are in `docs/PRODUCTION-QA.md`. Internal signed install
instructions are in `docs/INSTALL-INTERNAL.md`. Linux screen-share
troubleshooting is in `docs/LINUX-TROUBLESHOOTING.md`.
