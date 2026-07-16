# HashMeet Desktop Internal Install Guide

This guide is for signed internal production builds distributed to HashMicro
staff before wider rollout.

## Download

Grab the latest release from
`https://github.com/HashMicro/hashmeet-desktop/releases`.

| Your OS | Download |
| --- | --- |
| macOS Intel or Apple Silicon | `HashMeet-<version>-universal.dmg` |
| Windows 10 or 11 64-bit | `HashMeet-<version>-x64.exe` |
| Linux x64 | `HashMeet-<version>-x64.AppImage` or `HashMeet-<version>-x64.deb` |

## macOS

1. Open the `.dmg`.
2. Drag **HashMeet** to **Applications**.
3. Open **HashMeet** from Applications.
4. Allow camera, microphone, and screen recording permissions when prompted.

A signed and notarized build should not require Gatekeeper bypass steps. If
macOS says the app cannot be opened because the developer cannot be verified,
stop testing that build and report the installer filename.

## Windows

1. Run `HashMeet-<version>-x64.exe`.
2. Follow the installer.
3. Allow camera, microphone, and screen capture permissions when prompted by
   Windows or the browser engine.

A signed build should not require **More info -> Run anyway**. If SmartScreen
still blocks the installer, report the installer filename and screenshot; a new
certificate may need reputation warm-up.

## Linux

For Debian or Ubuntu:

```bash
sudo apt install ./HashMeet-<version>-x64.deb
```

For AppImage:

```bash
chmod +x HashMeet-<version>-x64.AppImage
./HashMeet-<version>-x64.AppImage
```

Linux screen sharing depends on PipeWire and a working desktop portal. Install
the portal backend for your desktop environment, for example:

```bash
# Debian or Ubuntu GNOME/KDE examples
sudo apt install pipewire xdg-desktop-portal xdg-desktop-portal-gtk

# Arch/CachyOS Hyprland example
sudo pacman -S pipewire xdg-desktop-portal xdg-desktop-portal-hyprland
```

Some AppImage systems also need FUSE compatibility, such as `libfuse2` on
Ubuntu-based distributions.

## Auto-updates

The app checks GitHub Releases on launch. When an update is ready, restart the
app from the update prompt and confirm the version changed. HashMeet defers the
restart prompt until after an active meeting ends; **Help -> Restart to update**
and the tray show the ready state in the meantime.

## Reporting Issues

Use **Help -> Copy Diagnostics** and include:

- OS and version.
- HashMeet Desktop version.
- Whether the same issue happens in a regular browser at
  `https://meet.hashmicro.com`.
- The exact action that failed, especially for camera, microphone, screen
  sharing, toolbar, tray, deeplink, or update issues.

Diagnostics are redacted by the app, but do not paste screenshots containing
private meeting content into public issue trackers.
