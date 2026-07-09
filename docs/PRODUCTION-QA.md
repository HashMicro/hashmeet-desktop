# HashMeet Desktop Production QA

Run this checklist before marking a desktop release production-ready.

## Build And Install

- CI completed for macOS, Windows, and Linux.
- Release artifacts exist for:
  - `HashMeet-<version>-universal.dmg`
  - `HashMeet-<version>-universal.zip`
  - `HashMeet-<version>-x64.exe`
  - `HashMeet-<version>-x64.AppImage`
  - `HashMeet-<version>-x64.deb`
- Update metadata exists for macOS, Windows, and Linux.
- macOS build is signed and notarized.
- Windows installer is signed.
- Linux AppImage starts and deb package installs cleanly.

## Smoke Checks

- App opens `https://meet.hashmicro.com` in production build.
- `HASHMEET_DESKTOP_SERVER_URL` is ignored in packaged mode unless
  `HASHMEET_DESKTOP_ALLOW_SERVER_OVERRIDE=true` or
  `--allow-server-override` is used.
- Login, dashboard, create meeting, and join meeting work.
- Camera and microphone permission prompts work.
- Screen sharing starts after source selection.
- Floating screen-share toolbar renders content and its controls work.
- Toolbar does not cover the meeting header or overlap its own controls.
- Closing the main window hides to tray; Quit exits the app.
- `hashmeet://meeting/<meeting-id>` opens the target meeting.
- Unsupported `hashmeet://` routes are rejected.
- External HTTP and HTTPS links open in the system browser.
- Non-web external protocols are not opened from the renderer.
- Help -> Copy Diagnostics copies a redacted JSON bundle.

## Platform Matrix

- Windows 10 x64.
- Windows 11 x64.
- macOS Apple Silicon.
- macOS Intel or Rosetta validation for universal build.
- Ubuntu or Fedora GNOME Wayland.
- KDE Wayland.
- Linux X11.
- Hyprland or Sway Wayland best-effort validation.

## Update Test

1. Install the previous signed release.
2. Launch and sign in.
3. Publish the new test release.
4. Confirm the app detects the update.
5. Restart from the update prompt.
6. Confirm the installed version changed and meetings still work.

## Acceptance Criteria

- All primary platform checks pass.
- Screen sharing works on Windows, macOS, Linux X11, and at least one major
  Linux Wayland desktop.
- Hyprland/Sway behavior is documented if portal-specific issues remain.
- Auto-update succeeds from one signed release to the next.
- Copied diagnostics contain no cookies, auth tokens, URL queries/fragments, or
  unredacted home-directory paths.
