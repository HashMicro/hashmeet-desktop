# HashMeet Desktop Engineering Notes

## Runtime Shape

HashMeet Desktop is an Electron shell around the live HashMeet Laravel app. It
does not ship a separate React welcome renderer. The sibling `../hashmeet`
project owns meeting and Jitsi behavior; this repository owns native windows,
permissions, screen capture, media diagnostics, tray/menu behavior, deeplinks,
updates, and packaging.

Key entry points:

- `main.js`: main window, platform integration, capture, diagnostics, and IPC.
- `app/preload/preload.js`: backward-compatible `window.jitsiNodeAPI` bridge.
- `picker/`: native source picker.
- `toolbar/`: always-on-top screen-share controls.
- `media-check/`: isolated microphone, speaker, camera, and permission tests.
- `lib/`: pure policy helpers covered by Node tests.

## Commands

```bash
npm install
npm start
npm run verify
npm run dist -- --linux --publish never
```

`npm run verify` runs syntax checks, Node tests, ESLint, and the production
webpack bundle. `npm start` builds the main/preload bundle, watches it, and runs
Electron against the configured HashMeet server.

## Boundaries

- Keep the desktop bridge backward-compatible with the live web application.
- Validate remote IPC by exact HTTP(S) origin and validate local-window IPC by
  its owning `webContents`.
- Keep picker, toolbar, media-check, and offline windows local and CSP-restricted.
- Windows is the only Electron platform where system-audio loopback is exposed.
- Wayland source selection belongs to PipeWire and the desktop portal.
- Sender-level bitrate/FPS adaptation belongs inside the deployed Jitsi iframe,
  not in this cross-origin Electron wrapper.

## Release Validation

Follow `docs/PRODUCTION-QA.md`. Media behavior must be exercised on Windows,
macOS, Linux X11, and at least one major Wayland desktop; syntax/build checks do
not validate real microphone, speaker, camera, or portal behavior.
