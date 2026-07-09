# Linux Screen-Share Troubleshooting

HashMeet Desktop uses Electron, Chromium WebRTC, PipeWire, and the desktop
portal stack for Linux screen sharing. Failures are usually portal or compositor
specific, not HashMeet web app feature gaps.

## Required Components

Install PipeWire and one portal backend matching the session:

```bash
# GNOME or generic GTK portal
sudo apt install pipewire xdg-desktop-portal xdg-desktop-portal-gtk

# KDE portal
sudo apt install pipewire xdg-desktop-portal xdg-desktop-portal-kde

# Arch/CachyOS Hyprland
sudo pacman -S pipewire xdg-desktop-portal xdg-desktop-portal-hyprland
```

Only one desktop-specific portal backend should own the session. Multiple
competing backends can cause blank pickers or blank capture streams.

## Quick Checks

```bash
echo "$XDG_SESSION_TYPE"
systemctl --user status pipewire xdg-desktop-portal
systemctl --user status xdg-desktop-portal-hyprland
```

For GNOME or KDE, replace the Hyprland service with the matching portal
backend.

## Common Symptoms

- Portal selector appears, then sharing does not start:
  restart the portal services and try again.
- Blank black selector or capture window on Wayland:
  verify the compositor-specific portal is installed and active.
- AppImage does not start:
  install the FUSE compatibility package for the distribution.
- Local deb packaging fails with `libcrypt.so.1` on Arch/CachyOS:
  install `libxcrypt-compat` and rerun `npm run dist -- --linux --publish never`.
- Sharing works in a browser but not desktop:
  run with `HASHMEET_DESKTOP_DIAGNOSTICS=true` and use
  **Help -> Copy Diagnostics** after reproducing.

## Restart Portal Services

```bash
systemctl --user restart pipewire xdg-desktop-portal
systemctl --user restart xdg-desktop-portal-hyprland
```

Log out and back in if the session still uses the wrong portal backend.

## Diagnostic Run

```bash
HASHMEET_DESKTOP_DIAGNOSTICS=true ./HashMeet-<version>-x64.AppImage
```

After reproducing, use **Help -> Copy Diagnostics**. The copied JSON should be
attached to the internal report with the Linux distribution, desktop
environment or compositor, and whether the same share works in Chrome.
