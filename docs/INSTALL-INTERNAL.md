# HashMeet Desktop — Internal Install Guide

This is an **unsigned internal build** for HashMicro staff. You will see security
warnings on first launch — this is expected. Follow the steps below.

## Download

Grab the latest installer from the [Releases page](https://github.com/HashMicro/hashmeet-desktop/releases).

| Your OS | Download |
| --- | --- |
| macOS (Intel or Apple Silicon) | `HashMeet-<version>-universal.dmg` |
| Windows 10 / 11 (64-bit) | `HashMeet-<version>-x64.exe` |

## macOS — first launch

Because the build is **not yet code-signed by Apple**, Gatekeeper will refuse
to open it on the first try. One-time bypass:

1. Open the `.dmg` and drag **HashMeet** to your Applications folder.
2. Open **Applications**, **right-click** (or Control-click) **HashMeet**,
   choose **Open**.
3. macOS will say `"HashMeet" cannot be opened because it is from an unidentified developer`.
   Click **Cancel** (yes, Cancel — this is the workaround).
4. Open **System Settings → Privacy & Security**. Scroll to the **Security**
   section. You'll see a message: `"HashMeet" was blocked from use because it is not from an identified developer.`
5. Click **Open Anyway** next to that message. Authenticate with your password
   or Touch ID. The app will launch.

You only need to do this **once**. Future launches and auto-updates work normally.

If you don't see the "Open Anyway" prompt, run this in Terminal once:

```bash
xattr -dr com.apple.quarantine /Applications/HashMeet.app
```

## Windows — first launch

Because the build is **not yet code-signed**, Microsoft SmartScreen will
warn you. One-time bypass:

1. Run `HashMeet-<version>-x64.exe`.
2. SmartScreen will show: `Windows protected your PC`.
3. Click **More info** (small link, easy to miss).
4. Click **Run anyway**.
5. Follow the installer.

After install, future launches and auto-updates work normally without prompts.

## Auto-updates

The app checks GitHub Releases on every launch and downloads new versions in
the background. When an update is ready, you'll be prompted to restart.

## Reporting issues

If the app crashes, the toolbar lags, the mic stops working, or anything else
feels wrong, please report it in the **#hashmeet-desktop-dogfood** channel with:

- OS + version (e.g. macOS 14.3, Windows 11 23H2)
- HashMeet Desktop version (Help → About, or check the installer filename)
- What you were doing when it broke
- Whether the same thing happens in a regular browser tab on `https://meet.hashmicro.com`

The whole point of this internal build is to find out whether running outside
the browser actually fixes the lag/mic/crash complaints — your feedback decides
whether we move forward to a signed public release.

## Why is it unsigned?

Code-signing certificates cost money (Apple Developer ID $99/yr, Windows OV
cert $200–400/yr) and we don't want to spend that until we know the desktop
app is the right answer. Once internal dogfood proves the stability gains, we
buy the certs and the warnings disappear.
