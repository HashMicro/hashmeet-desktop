const {
    initPopupsConfigurationMain,
    getPopupTarget,
    setupPictureInPictureMain,
    setupRemoteControlMain,
    setupPowerMonitorMain,
} = require('@jitsi/electron-sdk');
const {
    BrowserWindow,
    Menu,
    Notification,
    Tray,
    app,
    clipboard,
    desktopCapturer,
    dialog,
    ipcMain,
    screen,
    shell,
    systemPreferences,
} = require('electron');
const contextMenu = require('electron-context-menu');
const debug = require('electron-debug');
const isDev = require('electron-is-dev');
const { autoUpdater } = require('electron-updater');
const windowStateKeeper = require('electron-window-state');
const fs = require('fs');
const path = require('path');
const process = require('process');
const URL = require('url');

const config = require('./app/features/config');
const { openExternalLink } = require('./app/features/utils/openExternalLink');
const { isAllowedLocalhostCertificateURL } = require('./lib/certificate-policy');
const { CHROME_CSS_INSERT_OPTIONS, getChromeLayout } = require('./lib/chrome-layout');
const { createDisplayMediaGrant } = require('./lib/display-media-policy');
const { getScreenShareCapabilities, normalizePermissionStatus } = require('./lib/media-policy');
const { createOriginPolicy, isTrustedIpcSender, normalizeWebOrigin } = require('./lib/origin-policy');
const { PREFERENCE_KEYS, createUserDataPreferenceStore } = require('./lib/preference-store');
const { createToolbarCommandBroker } = require('./lib/toolbar-command-broker');
const {
    classifyDeviceAccessResult,
    getDestructiveNavigationDecision,
    getMediaPermissionTargets,
    getToolbarWindowBounds,
    getTrayPresentation,
    getUpdaterPresentation,
    shouldShowCloseToTrayNotice,
} = require('./lib/ux-policy');
const pkgJson = require('./package.json');

const showDevTools = Boolean(process.env.SHOW_DEV_TOOLS) || process.argv.includes('--show-dev-tools');
const enableDesktopDiagnostics =
    isDev ||
    showDevTools ||
    process.env.HASHMEET_DESKTOP_DIAGNOSTICS === 'true' ||
    process.argv.includes('--diagnostics');

// For enabling remote control, please change the ENABLE_REMOTE_CONTROL flag in
// app/features/conference/components/Conference.js to true as well
const ENABLE_REMOTE_CONTROL = false;

const HASHMEET_SERVER_URL_ENV = 'HASHMEET_DESKTOP_SERVER_URL';
const JITSI_SCREEN_SHARE_GET_SOURCES = 'jitsi-screen-sharing-get-sources';
const defaultServerURL = config.default.defaultServerURL;
const allowServerURLOverride =
    isDev ||
    process.env.HASHMEET_DESKTOP_ALLOW_SERVER_OVERRIDE === 'true' ||
    process.argv.includes('--allow-server-override');

/**
 * Resolves the HashMeet web app URL used by the desktop shell.
 *
 * @returns {string}
 */
function resolveServerURL() {
    const envURL = process.env[HASHMEET_SERVER_URL_ENV];

    if (envURL && !allowServerURLOverride) {
        console.warn(
            `[config] Ignoring ${HASHMEET_SERVER_URL_ENV} in packaged mode. ` +
                'Use development mode or HASHMEET_DESKTOP_ALLOW_SERVER_OVERRIDE=true for test builds.',
        );
    }

    const configuredURL = envURL && allowServerURLOverride ? envURL : defaultServerURL;

    try {
        const url = new URL.URL(configuredURL);

        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error(`Unsupported protocol: ${url.protocol}`);
        }

        url.hash = '';
        url.search = '';

        return url.toString().replace(/\/$/, '');
    } catch (err) {
        console.warn(
            `[config] Invalid ${HASHMEET_SERVER_URL_ENV} "${configuredURL}", ` +
                `falling back to ${defaultServerURL}: ${err.message}`,
        );

        return defaultServerURL;
    }
}

const hashMeetServerURL = resolveServerURL();
let updateState = { status: 'idle' };
let manualUpdateCheckPending = false;
let updatePromptActive = false;
let updatePromptDismissed = false;
let deferredUpdatePrompt = false;
let navigationPromptActive = false;
let preferenceStore = null;
let closeToTrayNotification = null;
let mainWindowHasBeenShown = false;
let pendingProtocolCall = null;
const trustedWebOrigins = new Set([normalizeWebOrigin(hashMeetServerURL)].filter(Boolean));

function getTrustedOriginPolicy() {
    return createOriginPolicy([...trustedWebOrigins]);
}

function isTrustedRemoteIpc(event) {
    return isTrustedIpcSender(event, getTrustedOriginPolicy());
}

function getAppBasePathCandidates() {
    const appPath = app.getAppPath();
    const candidates = [appPath, path.resolve(appPath, '..')];

    if (typeof __dirname === 'string' && path.isAbsolute(__dirname)) {
        candidates.push(__dirname, path.resolve(__dirname, '..'));
    }

    if (isDev) {
        candidates.push(process.cwd());
    }

    return Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
}

function resolveAppAssetPath(...segments) {
    const candidates = getAppBasePathCandidates().map((candidate) => path.resolve(candidate, ...segments));
    const found = candidates.find((candidate) => fs.existsSync(candidate));

    return found || candidates[0];
}

function isPathInside(parentPath, childPath) {
    const relativePath = path.relative(parentPath, childPath);

    return relativePath === '' || (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function getAllowedFileRoots() {
    return getAppBasePathCandidates().filter((candidate) => fs.existsSync(candidate));
}

/**
 * Builds an absolute HashMeet web app URL from a relative path.
 *
 * @param {string} relativePath - Path or room name to append to the server URL.
 * @returns {string}
 */
function buildHashMeetURL(relativePath = '') {
    const cleanPath = String(relativePath).replace(/^\/+/, '');

    return cleanPath ? `${hashMeetServerURL}/${cleanPath}` : hashMeetServerURL;
}

function getMeetingIdFromURL(value) {
    try {
        const parsed = new URL.URL(value);
        const match = parsed.pathname.match(/(?:^|\/)meeting\/([^/]+)\/?$/);

        return match ? decodeURIComponent(match[1]) : null;
    } catch (_error) {
        return null;
    }
}

function showAndFocusMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return false;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    if (!mainWindowHasBeenShown && !mainWindow.isVisible()) {
        return true;
    }
    if (!mainWindow.isVisible()) {
        mainWindow.show();
    }
    mainWindow.focus();

    return true;
}

function syncNativeMenus() {
    if (!app.isReady()) {
        return;
    }
    setApplicationMenu();
    updateTrayMenu();
}

async function confirmDestructiveNavigation(action, targetURL = null) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return false;
    }

    const decision = getDestructiveNavigationDecision({
        action,
        targetMeetingId: getMeetingIdFromURL(targetURL),
        currentMeetingId: getMeetingIdFromURL(mainWindow.webContents.getURL()),
        callState,
    });

    if (!decision.requiresConfirmation) {
        return true;
    }

    if (navigationPromptActive) {
        recordDiagnosticEvent('destructive-navigation-cancelled', {
            action,
            reason: 'confirmation-already-open',
        });

        return false;
    }

    navigationPromptActive = true;

    try {
        const result = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['Cancel', 'Leave & continue'],
            defaultId: 0,
            cancelId: 0,
            title: 'Leave the current meeting?',
            message: 'This action will leave your current meeting.',
            detail: 'Your camera, microphone, and screen share will stop for this meeting.',
            noLink: true,
        });
        const confirmed = result.response === 1;

        recordDiagnosticEvent(confirmed ? 'destructive-navigation-confirmed' : 'destructive-navigation-cancelled', {
            action,
            reason: decision.reason,
        });

        return confirmed;
    } catch (error) {
        recordDiagnosticEvent('destructive-navigation-dialog-error', {
            action,
            message: error.message,
        });

        return false;
    } finally {
        navigationPromptActive = false;
    }
}

async function navigateMainWindow(action, targetURL = null) {
    if (!showAndFocusMainWindow() || !(await confirmDestructiveNavigation(action, targetURL))) {
        return false;
    }

    if (action === 'reload') {
        mainWindow.reload();
    } else if (action === 'force-reload') {
        mainWindow.webContents.reloadIgnoringCache();
    } else if (targetURL) {
        mainWindow.loadURL(targetURL);
    }

    return true;
}

// Fix screen-sharing thumbnails being missing sometimes.
// https://github.com/electron/electron/issues/44504
const disabledFeatures = [
    'ThumbnailCapturerMac:capture_mode/sc_screenshot_manager',
    'ScreenCaptureKitPickerScreen',
    'ScreenCaptureKitStreamPickerSonoma',
];

app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));

// Enable Opus RED field trial.
app.commandLine.appendSwitch('force-fieldtrials', 'WebRTC-Audio-Red-For-Opus/Enabled/');

// Wayland: Enable optional PipeWire support.
if (!app.commandLine.hasSwitch('enable-features')) {
    app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
}

// Prevent Chromium from throttling audio/video when window loses focus.
// Critical for a video-calling app — without these, background calls get
// choppy audio, dropped frames, and delayed timer callbacks.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

async function showUpdateMessage(options) {
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

    if (owner) {
        showAndFocusMainWindow();
    }

    return dialog.showMessageBox(owner, options);
}

async function promptForDownloadedUpdate({ force = false, source = 'automatic' } = {}) {
    const presentation = getUpdaterPresentation({ updateState, callState });

    if (presentation.deferPrompt) {
        if (!deferredUpdatePrompt) {
            recordDiagnosticEvent('update-restart-deferred', {
                version: updateState.version,
                source,
            });
        }
        deferredUpdatePrompt = true;
        syncNativeMenus();

        return false;
    }

    if (!presentation.canRestartNow || updatePromptActive || (!force && updatePromptDismissed)) {
        return false;
    }

    updatePromptActive = true;
    deferredUpdatePrompt = false;

    try {
        const result = await showUpdateMessage({
            type: 'info',
            buttons: ['Later', 'Restart now'],
            defaultId: 1,
            cancelId: 0,
            title: 'HashMeet update ready',
            message: `HashMeet ${updateState.version || 'update'} is ready to install.`,
            detail: 'Restart HashMeet to finish the update.',
            noLink: true,
        });

        if (result.response !== 1) {
            updatePromptDismissed = true;
            recordDiagnosticEvent('update-restart-later', {
                version: updateState.version,
                source,
            });

            return false;
        }

        if (callState.inMeeting) {
            deferredUpdatePrompt = true;
            recordDiagnosticEvent('update-restart-deferred', {
                version: updateState.version,
                source: 'meeting-started-before-restart',
            });

            return false;
        }

        recordDiagnosticEvent('update-restart-requested', {
            version: updateState.version,
            source,
        });
        isQuitting = true;
        autoUpdater.quitAndInstall(false, true);

        return true;
    } catch (error) {
        isQuitting = false;
        recordDiagnosticEvent('update-restart-error', { message: error.message });
        await showUpdateMessage({
            type: 'error',
            buttons: ['OK'],
            title: 'Could not restart HashMeet',
            message: 'The update is downloaded, but HashMeet could not restart.',
            detail: 'Quit and reopen HashMeet to try installing the update again.',
        });

        return false;
    } finally {
        updatePromptActive = false;
        syncNativeMenus();
    }
}

async function checkForDesktopUpdates() {
    if (!app.isPackaged || process.mas) {
        return;
    }

    if (updateState.status === 'downloaded') {
        if (callState.inMeeting) {
            deferredUpdatePrompt = true;
            await showUpdateMessage({
                type: 'info',
                buttons: ['OK'],
                title: 'Update ready after your meeting',
                message: `HashMeet ${updateState.version || 'update'} is ready to install.`,
                detail: 'Your meeting will not be interrupted. HashMeet will ask to restart after you leave.',
            });

            return;
        }
        await promptForDownloadedUpdate({ force: true, source: 'manual' });

        return;
    }

    if (['checking', 'available', 'downloading'].includes(updateState.status)) {
        const presentation = getUpdaterPresentation({ updateState, callState });

        manualUpdateCheckPending = true;
        await showUpdateMessage({
            type: 'info',
            buttons: ['OK'],
            title: 'HashMeet update',
            message: presentation.label,
        });

        return;
    }

    manualUpdateCheckPending = true;
    updateState = { status: 'checking', checkedAt: new Date().toISOString() };
    syncNativeMenus();

    try {
        await autoUpdater.checkForUpdates();
    } catch (error) {
        // electron-updater normally emits `error`; handle providers that only reject.
        if (manualUpdateCheckPending) {
            manualUpdateCheckPending = false;
            updateState = { status: 'error', message: error.message };
            recordDiagnosticEvent('update-error', updateState);
            syncNativeMenus();
            await showUpdateMessage({
                type: 'error',
                buttons: ['OK'],
                title: 'Could not check for updates',
                message: 'HashMeet could not check for updates.',
                detail: 'Check your connection and try again.',
            });
        }
    }
}

autoUpdater.on('checking-for-update', () => {
    updateState = { status: 'checking', checkedAt: new Date().toISOString() };
    recordDiagnosticEvent('update-checking');
    syncNativeMenus();
});
autoUpdater.on('update-available', (info) => {
    updateState = { status: 'available', version: info.version };
    recordDiagnosticEvent('update-available', updateState);
    syncNativeMenus();
});
autoUpdater.on('update-not-available', (info) => {
    updateState = { status: 'current', version: info.version };
    recordDiagnosticEvent('update-not-available', updateState);
    syncNativeMenus();
    if (manualUpdateCheckPending) {
        manualUpdateCheckPending = false;
        showUpdateMessage({
            type: 'info',
            buttons: ['OK'],
            title: 'HashMeet is up to date',
            message: `You are using the latest version of HashMeet (${app.getVersion()}).`,
        });
    }
});
autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent || 0);
    const shouldRefreshMenus = updateState.status !== 'downloading' || updateState.percent !== percent;

    updateState = {
        status: 'downloading',
        percent,
        version: updateState.version,
    };
    if (shouldRefreshMenus) {
        syncNativeMenus();
    }
});
autoUpdater.on('update-downloaded', (info) => {
    updateState = { status: 'downloaded', version: info.version };
    updatePromptDismissed = false;
    recordDiagnosticEvent('update-downloaded', updateState);
    syncNativeMenus();
    promptForDownloadedUpdate({ source: manualUpdateCheckPending ? 'manual' : 'automatic' });
    manualUpdateCheckPending = false;
});
autoUpdater.on('error', (err) => {
    updateState = { status: 'error', message: err.message };
    recordDiagnosticEvent('update-error', updateState);
    syncNativeMenus();
    if (manualUpdateCheckPending) {
        manualUpdateCheckPending = false;
        showUpdateMessage({
            type: 'error',
            buttons: ['OK'],
            title: 'Could not check for updates',
            message: 'HashMeet could not check for updates.',
            detail: 'Check your connection and try again.',
        });
    }
});

// Enable context menu so things like copy and paste work in input fields.
contextMenu({
    showLookUpSelection: false,
    showSearchWithGoogle: false,
    showCopyImage: false,
    showCopyImageAddress: false,
    showSaveImage: false,
    showSaveImageAs: false,
    showInspectElement: enableDesktopDiagnostics,
    showServices: false,
});

// Keep DevTools unavailable in normal packaged builds. They can still be
// enabled explicitly for diagnostics with SHOW_DEV_TOOLS=true or --diagnostics.
if (enableDesktopDiagnostics) {
    debug({
        isEnabled: true,
        showDevTools,
    });
}

/**
 * When in development mode:
 * - Enable automatic reloads
 */
if (isDev) {
    require('electron-reload')(path.join(__dirname, 'build'));
}

/**
 * The window object that will load the iframe with Jitsi Meet.
 * IMPORTANT: Must be defined as global in order to not be garbage collected
 * acidentally.
 */
let mainWindow = null;

let webrtcInternalsWindow = null;

/**
 * The system tray icon. Created once on app ready.
 */
let tray = null;

/**
 * Set to true when the user has chosen Quit (tray menu, app menu, or
 * Cmd+Q). While false, closing the main window hides it to tray instead.
 */
let isQuitting = false;

/**
 * The always-on-top floating toolbar window shown while the user is
 * screen sharing. Created on demand via IPC from the main renderer.
 */
let toolbarWindow = null;
let mediaCheckWindow = null;
let jitsiScreenShareSourceHandlerRegistered = false;
let lastFailedMainURL = null;
let callState = { inMeeting: false, muted: true, sharing: false };
let chromeCSSKey = null;
let chromeCSSGeneration = 0;

const MAX_DIAGNOSTIC_EVENTS = 80;
const diagnosticsEvents = [];
const permissionState = {
    camera: { status: 'unknown' },
    microphone: { status: 'unknown' },
    media: { status: 'unknown' },
    displayCapture: { status: 'unknown' },
    notifications: { status: 'unknown' },
    openExternal: { status: 'blocked' },
};
let lastScreenShareSource = null;
let recoveryScreenActive = false;
let unresponsivePromptActive = false;

/**
 * Add protocol data
 */
const appProtocolSurplus = `${config.default.appProtocolPrefix}://`;

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactLocalPath(value) {
    let text = String(value);
    const localRoots = [process.env.HOME, process.env.USERPROFILE].filter((root) => root && root.length > 3);

    localRoots.forEach((root) => {
        text = text.replace(new RegExp(escapeRegExp(root), 'g'), '~');
    });

    return text;
}

function redactDiagnosticString(value) {
    const text = redactLocalPath(value).replace(
        /((?:authorization|cookie|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi,
        '$1[redacted]',
    );

    try {
        const url = new URL.URL(text);

        url.pathname = url.pathname.replace(/(\/meeting\/)[^/?#]+/i, '$1[redacted]');
        url.search = '';
        url.hash = '';

        return redactLocalPath(url.toString());
    } catch (_) {
        return text.length > 500 ? `${text.substring(0, 500)}...` : text;
    }
}

function sanitizeDiagnosticValue(value, depth = 0) {
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        return redactDiagnosticString(value);
    }

    if (depth > 3) {
        return '[Object]';
    }

    if (Array.isArray(value)) {
        return value.slice(0, 20).map((item) => sanitizeDiagnosticValue(item, depth + 1));
    }

    if (typeof value === 'object') {
        return Object.entries(value)
            .slice(0, 30)
            .reduce((acc, [key, item]) => {
                if (/authorization|cookie|credential|csrf|jwt|password|secret|session|token|xsrf/i.test(key)) {
                    acc[key] = '[redacted]';
                } else {
                    acc[key] = sanitizeDiagnosticValue(item, depth + 1);
                }

                return acc;
            }, {});
    }

    return String(value);
}

function recordDiagnosticEvent(type, payload = {}) {
    const event = {
        at: new Date().toISOString(),
        type: String(type || 'event'),
        payload: sanitizeDiagnosticValue(payload),
    };

    diagnosticsEvents.push(event);

    while (diagnosticsEvents.length > MAX_DIAGNOSTIC_EVENTS) {
        diagnosticsEvents.shift();
    }

    return event;
}

const toolbarCommandBroker = createToolbarCommandBroker({
    sendCommand: (command) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            throw new Error('The meeting window is unavailable.');
        }

        mainWindow.webContents.send('toolbar:action', command);
    },
    isToolbarSender: (event) =>
        Boolean(toolbarWindow && !toolbarWindow.isDestroyed() && event.sender === toolbarWindow.webContents),
    isResultSender: (event) =>
        Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents && isTrustedRemoteIpc(event)),
    recordDiagnostic: (type, payload) => recordDiagnosticEvent(`toolbar-command-${type}`, payload),
});

function getCurrentURLSummary() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return null;
    }

    try {
        const url = new URL.URL(mainWindow.webContents.getURL());

        url.search = '';
        url.hash = '';

        return url.toString();
    } catch (_) {
        return null;
    }
}

function getPermissionStatus() {
    return sanitizeDiagnosticValue(permissionState);
}

function getNativeMediaPermissionStatus() {
    const permissions = {
        camera: 'unknown',
        microphone: 'unknown',
        screen: 'unknown',
    };

    if (process.platform === 'darwin') {
        permissions.camera = normalizePermissionStatus(systemPreferences.getMediaAccessStatus('camera'));
        permissions.microphone = normalizePermissionStatus(systemPreferences.getMediaAccessStatus('microphone'));
        permissions.screen = normalizePermissionStatus(systemPreferences.getMediaAccessStatus('screen'));
    } else {
        permissions.camera = normalizePermissionStatus(permissionState.camera?.status || permissionState.media?.status);
        permissions.microphone = normalizePermissionStatus(
            permissionState.microphone?.status || permissionState.media?.status,
        );
        permissions.screen = normalizePermissionStatus(permissionState.displayCapture?.status);
    }

    return permissions;
}

function getMediaCapabilities() {
    const screenShare = getScreenShareCapabilities({
        platform: process.platform,
        environment: process.env,
        permissionStatus: getNativeMediaPermissionStatus().screen,
    });

    return {
        bridgeVersion: 3,
        platform: process.platform,
        sessionType: isWaylandSession() ? 'wayland' : process.env.XDG_SESSION_TYPE || null,
        permissions: getNativeMediaPermissionStatus(),
        systemSettings: {
            camera: Boolean(getMediaSystemSettingsTarget('camera')),
            microphone: Boolean(getMediaSystemSettingsTarget('microphone')),
            screen: Boolean(getMediaSystemSettingsTarget('screen')),
        },
        screenShare: {
            ...screenShare,
            sourceSwitching: true,
        },
    };
}

function notifyMediaStatusChanged() {
    const status = getMediaCapabilities();

    sendToMainWindow('media:status-changed', status);
    if (mediaCheckWindow && !mediaCheckWindow.isDestroyed()) {
        mediaCheckWindow.webContents.send('media-check:status-changed', status);
    }
}

async function requestNativeMediaAccess(kind) {
    if (!['camera', 'microphone'].includes(kind)) {
        return { granted: false, status: 'unsupported' };
    }

    let granted = false;

    if (process.platform === 'darwin') {
        granted = await systemPreferences.askForMediaAccess(kind);
    } else {
        recordDiagnosticEvent('media-access-device-request-required', {
            kind,
            platform: process.platform,
        });

        return {
            granted: false,
            status: getNativeMediaPermissionStatus()[kind],
            requiresDeviceRequest: true,
        };
    }

    const result = {
        granted,
        status: getNativeMediaPermissionStatus()[kind],
    };

    recordDiagnosticEvent('media-access-requested', { kind, ...result });
    notifyMediaStatusChanged();

    return result;
}

function getMediaSystemSettingsTarget(kind) {
    const targets = {
        darwin: {
            camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
            microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
            screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
        },
        win32: {
            camera: 'ms-settings:privacy-webcam',
            microphone: 'ms-settings:privacy-microphone',
            screen: 'ms-settings:privacy-screenshotborders',
        },
    };

    return targets[process.platform]?.[kind] || null;
}

async function openMediaSystemSettings(kind) {
    const target = getMediaSystemSettingsTarget(kind);

    if (!target) {
        return { ok: false, reason: 'unsupported' };
    }

    try {
        await shell.openExternal(target);
        recordDiagnosticEvent('media-settings-opened', { kind, platform: process.platform });

        return { ok: true };
    } catch (err) {
        recordDiagnosticEvent('media-settings-error', { kind, message: err.message });

        return { ok: false, reason: err.message };
    }
}

function getDesktopInfo() {
    return {
        appName: app.name,
        productName: pkgJson.productName || pkgJson.name,
        appVersion: pkgJson.version,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        isDev,
        serverURL: hashMeetServerURL,
        currentURL: getCurrentURLSummary(),
        lastScreenShareSource,
        permissions: getPermissionStatus(),
        mediaCapabilities: getMediaCapabilities(),
        callState,
        update: updateState,
    };
}

function getDiagnosticBundle() {
    return {
        generatedAt: new Date().toISOString(),
        desktop: getDesktopInfo(),
        events: diagnosticsEvents.slice(),
    };
}

function copyDiagnosticsToClipboard() {
    const bundle = getDiagnosticBundle();

    clipboard.writeText(JSON.stringify(bundle, null, 2));
    recordDiagnosticEvent('diagnostics-copied', { eventCount: diagnosticsEvents.length });

    return {
        ok: true,
        eventCount: diagnosticsEvents.length,
    };
}

function sendToMainWindow(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}

function updatePermissionState(permission, status, details = {}) {
    const keyMap = {
        'display-capture': 'displayCapture',
        media: 'media',
        notifications: 'notifications',
        openExternal: 'openExternal',
    };
    const key = keyMap[permission] || permission;
    const snapshot = {
        status,
        permission,
        updatedAt: new Date().toISOString(),
    };

    if (details && typeof details === 'object') {
        snapshot.details = sanitizeDiagnosticValue(details);
    }

    permissionState[key] = sanitizeDiagnosticValue(snapshot);

    if (permission === 'media') {
        getMediaPermissionTargets(permission, details).forEach((target) => {
            permissionState[target] = sanitizeDiagnosticValue({
                ...snapshot,
                permission: target,
            });
        });
    }
    recordDiagnosticEvent('permission-request', {
        permission,
        status,
        details: snapshot,
    });

    return permissionState[key];
}

function buildSourceInfo(source) {
    if (!source) {
        return null;
    }

    return {
        id: source.id,
        name: source.name,
        type: source.id.startsWith('screen:') ? 'screen' : 'window',
        displayId: source.display_id || null,
    };
}

function isWaylandSession() {
    return (
        process.platform === 'linux' &&
        (String(process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY))
    );
}

function displayMediaRequestHandlerOptions() {
    return {
        // Electron only supports the explicit system picker option on macOS.
        // Linux Wayland reaches the PipeWire portal through desktopCapturer.
        useSystemPicker: process.platform === 'darwin',
    };
}

function shouldUseOpaqueToolbarWindow() {
    return isWaylandSession();
}

function attachToolbarWindowDiagnostics(targetWindow) {
    const record = (type, payload = {}) =>
        recordDiagnosticEvent(`toolbar-window-${type}`, {
            ...payload,
            wayland: isWaylandSession(),
        });

    targetWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        record('did-fail-load', {
            errorCode,
            errorDescription,
            validatedURL,
            isMainFrame,
        });
    });

    targetWindow.webContents.on('render-process-gone', (_event, details) => {
        record('render-process-gone', details || {});
    });

    targetWindow.webContents.on('unresponsive', () => {
        record('unresponsive');
    });

    targetWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (level < 2) {
            return;
        }

        record('console-message', {
            level,
            message,
            line,
            sourceId,
        });
    });
}

function showMainRecoveryScreen(reason, details = {}) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    if (recoveryScreenActive && mainWindow.webContents.getURL().startsWith('file:')) {
        return;
    }

    const recoveryURL = details.url || lastFailedMainURL || getCurrentURLSummary();

    recoveryScreenActive = true;
    lastFailedMainURL = normalizeWebOrigin(recoveryURL) ? recoveryURL : hashMeetServerURL;
    closeToolbarWindow();
    recordDiagnosticEvent('main-window-recovery-screen', {
        reason,
        ...details,
    });
    mainWindow.loadFile(resolveAppAssetPath('offline', 'offline.html'), {
        query: {
            reason: String(reason || 'offline'),
        },
    });
}

async function promptForUnresponsiveRenderer(details = {}) {
    if (unresponsivePromptActive || !mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    unresponsivePromptActive = true;
    recordDiagnosticEvent('main-window-unresponsive', details);

    try {
        const result = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['Wait', 'Reload'],
            defaultId: 0,
            cancelId: 0,
            title: 'HashMeet is not responding',
            message: 'HashMeet is taking longer than expected to respond.',
            detail: 'You can wait, or reload the meeting window. Diagnostics will keep the recovery event.',
        });

        if (result.response === 1 && mainWindow && !mainWindow.isDestroyed()) {
            recordDiagnosticEvent('main-window-unresponsive-reload');
            mainWindow.reload();
        }
    } catch (err) {
        recordDiagnosticEvent('main-window-unresponsive-dialog-error', {
            message: err.message,
        });
    } finally {
        unresponsivePromptActive = false;
    }
}

function grantScreenShareSource(source, callback, origin = 'custom-picker', options = {}) {
    if (!source) {
        recordDiagnosticEvent('screen-share-source-cancelled', { origin });
        sendToMainWindow('desktop:screen-source-selected', null);
        callback(null);

        return;
    }

    lastScreenShareSource = buildSourceInfo(source);
    updatePermissionState('display-capture', 'allowed', {
        origin,
        sourceName: lastScreenShareSource.name,
        sourceType: lastScreenShareSource.type,
        wayland: isWaylandSession(),
    });
    recordDiagnosticEvent('screen-share-source-selected', {
        ...lastScreenShareSource,
        origin,
        wayland: isWaylandSession(),
    });
    sendToMainWindow('desktop:screen-source-selected', lastScreenShareSource);
    callback(
        createDisplayMediaGrant({
            source,
            platform: process.platform,
            audioRequested: options.audioRequested,
            shareSystemAudio: options.shareSystemAudio,
        }),
    );
}

function setupJitsiScreenShareSourceHandler() {
    if (jitsiScreenShareSourceHandlerRegistered) {
        return;
    }

    ipcMain.handle(JITSI_SCREEN_SHARE_GET_SOURCES, (_event, options = {}) => {
        const sourceOptions = {
            ...options,
            types: options.types || ['screen', 'window'],
            thumbnailSize: options.thumbnailSize || { width: 320, height: 200 },
            fetchWindowIcons: options.fetchWindowIcons === true,
        };

        recordDiagnosticEvent('screen-share-source-list-requested', {
            types: sourceOptions.types,
            thumbnailSize: sourceOptions.thumbnailSize,
        });

        return desktopCapturer.getSources(sourceOptions);
    });

    jitsiScreenShareSourceHandlerRegistered = true;
}

/**
 * Builds and installs the application menu. On macOS this shows as the
 * global top-of-screen menu bar. On Windows the menu bar is not rendered
 * (because we use titleBarStyle 'hidden'), but the accelerators still
 * register so keyboard shortcuts like Cmd+R / F11 work.
 */
function setApplicationMenu() {
    const isMac = process.platform === 'darwin';
    const homeURL = hashMeetServerURL;

    const quitItem = {
        label: isMac ? `Quit ${app.name}` : 'Quit HashMeet',
        accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q',
        click: () => {
            isQuitting = true;
            app.quit();
        },
    };

    const template = [
        ...(isMac
            ? [
                  {
                      label: app.name,
                      submenu: [
                          { role: 'about' },
                          { type: 'separator' },
                          { role: 'services' },
                          { type: 'separator' },
                          { role: 'hide' },
                          { role: 'hideOthers' },
                          { role: 'unhide' },
                          { type: 'separator' },
                          quitItem,
                      ],
                  },
              ]
            : []),
        {
            label: 'File',
            submenu: [
                {
                    label: 'Home',
                    accelerator: 'CmdOrCtrl+Shift+H',
                    click: () => {
                        navigateMainWindow('home', homeURL);
                    },
                },
                { type: 'separator' },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        navigateMainWindow('reload');
                    },
                },
                {
                    label: 'Force Reload',
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: () => {
                        navigateMainWindow('force-reload');
                    },
                },
                ...(isMac ? [] : [{ type: 'separator' }, quitItem]),
            ],
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            ],
        },
        {
            label: 'View',
            submenu: [
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { role: 'togglefullscreen' },
                ...(enableDesktopDiagnostics
                    ? [
                          { type: 'separator' },
                          {
                              label: 'Toggle Developer Tools',
                              accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
                              click: () => {
                                  if (mainWindow) {
                                      mainWindow.webContents.toggleDevTools();
                                  }
                              },
                          },
                      ]
                    : []),
            ],
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                ...(isMac
                    ? [{ type: 'separator' }, { role: 'front' }]
                    : [
                          {
                              label: 'Hide to Tray',
                              accelerator: 'Ctrl+W',
                              click: () => {
                                  if (mainWindow) {
                                      mainWindow.hide();
                                  }
                              },
                          },
                      ]),
            ],
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Audio & Video Setup',
                    accelerator: 'CmdOrCtrl+Shift+A',
                    click: () => createMediaCheckWindow(),
                },
                {
                    label:
                        updateState.status === 'downloaded'
                            ? 'Restart to update'
                            : getUpdaterPresentation({ updateState, callState }).label,
                    enabled: app.isPackaged && !process.mas,
                    click: () => checkForDesktopUpdates(),
                },
                { type: 'separator' },
                {
                    label: 'Copy Diagnostics',
                    accelerator: 'CmdOrCtrl+Shift+D',
                    click: () => copyDiagnosticsToClipboard(),
                },
                ...(enableDesktopDiagnostics
                    ? [
                          {
                              label: 'Open WebRTC Internals',
                              click: () => createWebRTCInternalsWindow(),
                          },
                      ]
                    : []),
                { type: 'separator' },
                {
                    label: 'Report an Issue',
                    click: () => shell.openExternal('https://github.com/HashMicro/hashmeet-desktop/issues'),
                },
                {
                    label: 'HashMicro Website',
                    click: () => shell.openExternal('https://hashmicro.com'),
                },
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Create the system tray icon with context menu (Show / Quit).
 * Clicking the tray icon toggles window visibility.
 */
function createTray() {
    if (tray) {
        return;
    }

    const iconPath = resolveAppAssetPath('resources', 'tray-icon.png');

    try {
        tray = new Tray(iconPath);
    } catch (err) {
        console.warn('[tray] Could not create system tray icon:', err.message);

        return;
    }
    tray.setToolTip('HashMeet');
    updateTrayMenu();

    tray.on('click', () => {
        if (!mainWindow) {
            return;
        }
        const presentation = getTrayPresentation({ callState, updateState });

        if (mainWindow.isVisible() && !mainWindow.isMinimized() && !presentation.disableHideOnClick) {
            mainWindow.hide();
        } else {
            showAndFocusMainWindow();
        }
    });
}

function updateTrayMenu() {
    if (!tray) {
        return;
    }

    const presentation = getTrayPresentation({ callState, updateState });
    const template = [
        {
            label: presentation.primaryLabel,
            click: () => showAndFocusMainWindow(),
        },
        ...(presentation.statusLabel ? [{ label: presentation.statusLabel, enabled: false }] : []),
        ...(presentation.showRestartToUpdate
            ? [
                  {
                      label: 'Restart to update',
                      enabled: presentation.restartEnabled,
                      click: () => promptForDownloadedUpdate({ force: true, source: 'tray' }),
                  },
              ]
            : []),
        { type: 'separator' },
        {
            label: 'Audio & Video Setup',
            click: () => createMediaCheckWindow(),
        },
        {
            label: 'Copy Diagnostics',
            click: () => copyDiagnosticsToClipboard(),
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            },
        },
    ];

    tray.setToolTip(callState.inMeeting ? 'HashMeet - meeting in progress' : 'HashMeet');
    tray.setContextMenu(Menu.buildFromTemplate(template));
}

function showCloseToTrayNotice() {
    const hasShownCloseNotice = preferenceStore?.get(PREFERENCE_KEYS.closeToTrayNoticeShown, false) === true;

    if (!shouldShowCloseToTrayNotice({ hasShownCloseNotice, willHideToTray: true })) {
        return;
    }

    const body = callState.inMeeting
        ? 'Your meeting continues in the system tray. Choose Return to meeting or Quit from the tray.'
        : 'Open HashMeet from the system tray, or choose Quit there to close the app.';
    const markNoticeShown = (delivery) => {
        preferenceStore?.set(PREFERENCE_KEYS.closeToTrayNoticeShown, true);
        recordDiagnosticEvent('close-to-tray-notice-shown', {
            inMeeting: callState.inMeeting,
            delivery,
        });
    };

    try {
        if (Notification.isSupported()) {
            closeToTrayNotification = new Notification({
                title: 'HashMeet is still running',
                body,
                silent: true,
            });
            closeToTrayNotification.on('click', () => showAndFocusMainWindow());
            closeToTrayNotification.on('close', () => {
                closeToTrayNotification = null;
            });
            closeToTrayNotification.show();
            markNoticeShown('notification');

            return;
        }
    } catch (error) {
        recordDiagnosticEvent('close-to-tray-notification-error', { message: error.message });
    }

    dialog
        .showMessageBox({
            type: 'info',
            buttons: ['Got it'],
            title: 'HashMeet is still running',
            message: 'HashMeet is still running in the system tray.',
            detail: body,
        })
        .then(() => markNoticeShown('dialog'))
        .catch((error) => {
            recordDiagnosticEvent('close-to-tray-notice-unavailable', { message: error.message });
        });
}

async function refreshChromeCSS(targetWindow) {
    if (!targetWindow || targetWindow.isDestroyed()) {
        return;
    }

    const generation = ++chromeCSSGeneration;
    const previousKey = chromeCSSKey;

    chromeCSSKey = null;
    if (previousKey) {
        await targetWindow.webContents.removeInsertedCSS(previousKey).catch(() => {});
    }

    if (targetWindow.isDestroyed() || generation !== chromeCSSGeneration) {
        return;
    }

    const layout = getChromeLayout(process.platform, targetWindow.isFullScreen());
    const insertedKey = await targetWindow.webContents
        .insertCSS(layout.css, CHROME_CSS_INSERT_OPTIONS)
        .catch((err) => {
            recordDiagnosticEvent('chrome-css-injection-error', { message: err.message });

            return null;
        });

    if (!insertedKey) {
        return;
    }

    if (targetWindow.isDestroyed() || generation !== chromeCSSGeneration) {
        await targetWindow.webContents.removeInsertedCSS(insertedKey).catch(() => {});

        return;
    }

    chromeCSSKey = insertedKey;
    recordDiagnosticEvent('chrome-layout-applied', {
        fullscreen: targetWindow.isFullScreen(),
        ...layout.metrics,
    });
}

/**
 * Register a custom getDisplayMedia handler on the given window's session.
 * Opens a modal picker listing screens and windows; the user clicks one and
 * we return the selected source to the Chromium media stack.
 *
 * Replaces @jitsi/electron-sdk's setupScreenSharingMain which assumes the
 * upstream Jitsi React renderer is loaded (it sends an IPC to a picker that
 * only exists in that renderer).
 */
function setupScreenShareHandler(window) {
    window.webContents.session.setDisplayMediaRequestHandler(async (request, callback) => {
        try {
            if (!getTrustedOriginPolicy().allows(request.securityOrigin)) {
                recordDiagnosticEvent('screen-share-origin-rejected', {
                    securityOrigin: request.securityOrigin,
                });
                grantScreenShareSource(null, callback, 'untrusted-origin');

                return;
            }

            const sourceOptions = {
                types: ['screen', 'window'],
                thumbnailSize: { width: 320, height: 200 },
                fetchWindowIcons: true,
            };
            const sources = await desktopCapturer.getSources(sourceOptions);

            if (!sources.length) {
                recordDiagnosticEvent('screen-share-no-sources', {
                    wayland: isWaylandSession(),
                    request: {
                        audioRequested: request.audioRequested,
                        videoRequested: request.videoRequested,
                        securityOrigin: request.securityOrigin,
                        userGesture: request.userGesture,
                    },
                });
                grantScreenShareSource(null, callback, isWaylandSession() ? 'wayland-pipewire' : 'no-sources');

                return;
            }

            if (isWaylandSession()) {
                // On Wayland the PipeWire portal already selected the real
                // source before desktopCapturer resolves. Opening our custom
                // picker after that produces an extra blank black window.
                grantScreenShareSource(sources[0], callback, 'wayland-pipewire');

                return;
            }

            const picker = new BrowserWindow({
                parent: window,
                modal: true,
                width: 900,
                height: 640,
                minWidth: 640,
                minHeight: 420,
                resizable: true,
                minimizable: false,
                maximizable: false,
                fullscreenable: false,
                show: false,
                title: 'Choose what to share',
                backgroundColor: '#1a1a1a',
                autoHideMenuBar: true,
                webPreferences: {
                    contextIsolation: true,
                    nodeIntegration: false,
                    sandbox: true,
                    preload: resolveAppAssetPath('picker', 'preload.js'),
                },
            });

            picker.setMenuBarVisibility(false);
            picker.loadFile(resolveAppAssetPath('picker', 'picker.html'));

            let currentSources = sources;
            let sourcesById = new Map(currentSources.map((source) => [source.id, source]));
            let refreshInFlight = false;

            const buildPickerPayload = () => {
                return {
                    sources: currentSources.map((source) => {
                        return {
                            id: source.id,
                            name: source.name,
                            type: source.id.startsWith('screen:') ? 'screen' : 'window',
                            displayId: source.display_id || null,
                            thumbnail: source.thumbnail.toDataURL(),
                            appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
                        };
                    }),
                    capabilities: {
                        systemAudio: process.platform === 'win32' && request.audioRequested,
                        systemAudioPlatformSupported: process.platform === 'win32',
                    },
                    request: {
                        audioRequested: request.audioRequested,
                        videoRequested: request.videoRequested,
                    },
                };
            };

            const sendSources = () => {
                if (!picker.isDestroyed()) {
                    picker.webContents.send('sources', buildPickerPayload());
                }
            };

            const refreshSources = async () => {
                if (refreshInFlight || picker.isDestroyed()) {
                    return;
                }
                refreshInFlight = true;
                try {
                    currentSources = await desktopCapturer.getSources(sourceOptions);
                    sourcesById = new Map(currentSources.map((source) => [source.id, source]));
                    sendSources();
                } catch (err) {
                    recordDiagnosticEvent('screen-share-source-refresh-error', { message: err.message });
                    if (!picker.isDestroyed()) {
                        picker.webContents.send('sources:error', { message: 'Could not refresh share sources.' });
                    }
                } finally {
                    refreshInFlight = false;
                }
            };

            picker.webContents.once('did-finish-load', () => {
                sendSources();
                picker.show();
            });

            let settled = false;
            const finish = (selection) => {
                if (settled) {
                    return;
                }
                settled = true;
                const sourceId = typeof selection === 'object' && selection ? selection.sourceId : selection;
                const source = sourceId ? sourcesById.get(sourceId) : null;

                grantScreenShareSource(source, callback, 'custom-picker', {
                    audioRequested: request.audioRequested,
                    shareSystemAudio: Boolean(selection?.shareSystemAudio),
                });

                if (!picker.isDestroyed()) {
                    picker.close();
                }
            };

            const fromPicker = (event) => event.sender === picker.webContents;
            const onSelect = (event, selection) => {
                if (fromPicker(event)) {
                    finish(selection);
                }
            };
            const onRefresh = (event) => {
                if (fromPicker(event)) {
                    refreshSources();
                }
            };

            ipcMain.on('picker:select', onSelect);
            ipcMain.on('picker:refresh', onRefresh);

            picker.on('closed', () => {
                ipcMain.removeListener('picker:select', onSelect);
                ipcMain.removeListener('picker:refresh', onRefresh);
                finish(null);
            });
        } catch (err) {
            console.error('[screenshare] handler error:', err);
            recordDiagnosticEvent('screen-share-handler-error', {
                message: err.message,
                stack: err.stack,
            });
            grantScreenShareSource(null, callback, 'handler-error');
        }
    }, displayMediaRequestHandlerOptions());
}

/**
 * Open (or refresh) the floating always-on-top screen-share toolbar.
 * Loaded from `toolbar/toolbar.html`; state is fed via IPC.
 *
 * Positioned bottom-center of the primary display. On Wayland we avoid
 * transparent flags because some compositors render them blank.
 */
function createToolbarWindow(initialState) {
    if (toolbarWindow && !toolbarWindow.isDestroyed()) {
        toolbarWindow.webContents.send('toolbar:init', initialState || {});
        if (!toolbarWindow.isVisible()) {
            toolbarWindow.showInactive();
        }

        return;
    }

    const sharedDisplay = lastScreenShareSource?.displayId
        ? screen.getAllDisplays().find((display) => String(display.id) === String(lastScreenShareSource.displayId))
        : null;
    const { workArea } = sharedDisplay || screen.getPrimaryDisplay();
    const opaqueToolbarWindow = shouldUseOpaqueToolbarWindow();
    const bounds = getToolbarWindowBounds(workArea);

    toolbarWindow = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        frame: false,
        transparent: !opaqueToolbarWindow,
        backgroundColor: opaqueToolbarWindow ? '#18181b' : '#00000000',
        resizable: false,
        movable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: true,
        acceptFirstMouse: true,
        hasShadow: !opaqueToolbarWindow,
        show: false,
        title: 'HashMeet Screen Share',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: resolveAppAssetPath('toolbar', 'preload.js'),
            backgroundThrottling: false,
        },
    });

    attachToolbarWindowDiagnostics(toolbarWindow);
    recordDiagnosticEvent('toolbar-window-created', {
        opaque: opaqueToolbarWindow,
        focusable: true,
        wayland: isWaylandSession(),
        bounds,
    });
    toolbarWindow.setAlwaysOnTop(true, 'screen-saver');
    toolbarWindow.setContentProtection(true);
    toolbarWindow.setMenuBarVisibility(false);
    if (process.platform === 'darwin') {
        toolbarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    const toolbarPath = resolveAppAssetPath('toolbar', 'toolbar.html');

    recordDiagnosticEvent('toolbar-window-load-file', {
        path: toolbarPath,
        exists: fs.existsSync(toolbarPath),
    });
    toolbarWindow.loadFile(toolbarPath);

    const repositionToolbar = () => {
        if (!toolbarWindow || toolbarWindow.isDestroyed()) {
            return;
        }

        const activeDisplay = lastScreenShareSource?.displayId
            ? screen.getAllDisplays().find((display) => String(display.id) === String(lastScreenShareSource.displayId))
            : screen.getDisplayMatching(toolbarWindow.getBounds());
        const nextBounds = getToolbarWindowBounds((activeDisplay || screen.getPrimaryDisplay()).workArea);

        toolbarWindow.setBounds(nextBounds, false);
        recordDiagnosticEvent('toolbar-window-repositioned', { bounds: nextBounds });
    };

    screen.on('display-added', repositionToolbar);
    screen.on('display-removed', repositionToolbar);
    screen.on('display-metrics-changed', repositionToolbar);

    toolbarWindow.webContents.once('did-finish-load', () => {
        if (!toolbarWindow || toolbarWindow.isDestroyed()) {
            return;
        }
        recordDiagnosticEvent('toolbar-window-loaded', {
            wayland: isWaylandSession(),
            visible: toolbarWindow.isVisible(),
        });
        toolbarWindow.webContents.send('toolbar:init', initialState || {});
        toolbarWindow.showInactive();
    });

    toolbarWindow.on('closed', () => {
        screen.removeListener('display-added', repositionToolbar);
        screen.removeListener('display-removed', repositionToolbar);
        screen.removeListener('display-metrics-changed', repositionToolbar);
        toolbarCommandBroker.cancelAll();
        toolbarWindow = null;
    });
}

/**
 * Destroy the floating toolbar window if it's open.
 */
function closeToolbarWindow() {
    toolbarCommandBroker.cancelAll();
    if (toolbarWindow && !toolbarWindow.isDestroyed()) {
        toolbarWindow.close();
    }
    toolbarWindow = null;
}

function createMediaCheckWindow() {
    if (mediaCheckWindow && !mediaCheckWindow.isDestroyed()) {
        mediaCheckWindow.show();
        mediaCheckWindow.focus();
        notifyMediaStatusChanged();

        return;
    }

    mediaCheckWindow = new BrowserWindow({
        width: 920,
        height: 720,
        minWidth: 760,
        minHeight: 600,
        show: false,
        title: 'HashMeet Audio & Video Setup',
        backgroundColor: '#171717',
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: resolveAppAssetPath('media-check', 'preload.js'),
        },
    });
    mediaCheckWindow.setMenuBarVisibility(false);
    mediaCheckWindow.loadFile(resolveAppAssetPath('media-check', 'media-check.html'));
    mediaCheckWindow.webContents.once('did-finish-load', () => {
        if (mediaCheckWindow && !mediaCheckWindow.isDestroyed()) {
            mediaCheckWindow.webContents.send('media-check:status-changed', getMediaCapabilities());
            mediaCheckWindow.show();
        }
    });
    mediaCheckWindow.on('closed', () => {
        mediaCheckWindow = null;
    });
    recordDiagnosticEvent('media-check-opened');
}

/**
 * Opens the main HashMeet window (loads meet.hashmicro.com directly).
 */
function createJitsiMeetWindow() {
    // Application menu.
    setApplicationMenu();

    // Check for Updates.
    if (app.isPackaged && !process.mas) {
        autoUpdater.checkForUpdates().catch((err) => {
            updateState = { status: 'error', message: err.message };
            recordDiagnosticEvent('update-error', updateState);
            syncNativeMenus();
        });
    }

    // Load the previous window state with fallback to defaults.
    const windowState = windowStateKeeper({
        defaultWidth: 800,
        defaultHeight: 600,
        fullScreen: false,
    });

    // HashMeet desktop loads the live Laravel webapp directly. The upstream
    // React welcome screen at build/index.html is intentionally bypassed.
    const indexURL = hashMeetServerURL;

    // Options used when creating the main HashMeet window.
    const isMac = process.platform === 'darwin';
    const options = {
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
        icon: resolveAppAssetPath('resources', 'icon.png'),
        minWidth: 800,
        minHeight: 600,
        show: false,
        backgroundColor: '#1a1a1a',
        title: 'HashMeet',

        // Hide the native title bar but keep native window controls.
        // macOS: traffic lights overlay the page at top-left.
        // Windows: min/max/close buttons shown as a titleBarOverlay
        //          in the top-right corner.
        titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
        ...(isMac ? { trafficLightPosition: { x: 16, y: 10 } } : {}),
        ...(isMac
            ? {}
            : {
                  titleBarOverlay: {
                      color: '#1a1a1a',
                      symbolColor: '#ffffff',
                      height: 36,
                  },
              }),
        webPreferences: {
            enableBlinkFeatures: 'WebAssemblyCSP',
            contextIsolation: false,
            nodeIntegration: false,
            preload: resolveAppAssetPath('build', 'preload.js'),
            sandbox: false,
        },
    };

    const windowOpenHandler = ({ url, frameName }) => {
        const target = getPopupTarget(url, frameName);

        if (!target || target === 'browser') {
            openExternalLink(url);

            return { action: 'deny' };
        }

        if (target === 'electron') {
            return { action: 'allow' };
        }

        return { action: 'deny' };
    };

    mainWindow = new BrowserWindow(options);
    windowState.manage(mainWindow);
    console.log(`[config] Loading HashMeet web app from ${indexURL}`);
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3 || !mainWindow || mainWindow.isDestroyed()) {
            return;
        }

        const failedOrigin = normalizeWebOrigin(validatedURL);

        if (!failedOrigin) {
            return;
        }

        lastFailedMainURL = validatedURL || indexURL;
        recordDiagnosticEvent('main-window-load-failed', {
            errorCode,
            errorDescription,
            url: validatedURL,
        });
        showMainRecoveryScreen('offline', {
            errorCode,
            errorDescription,
            url: validatedURL,
        });
    });
    mainWindow.webContents.on('did-frame-navigate', (_event, url, _code, _status, isMainFrame) => {
        const origin = normalizeWebOrigin(url);

        if (!origin) {
            return;
        }

        if (isMainFrame) {
            if (getTrustedOriginPolicy().allows(origin)) {
                lastFailedMainURL = null;
                recoveryScreenActive = false;
            }
        } else {
            const mainOrigin = normalizeWebOrigin(mainWindow.webContents.getURL());

            if (mainOrigin && getTrustedOriginPolicy().allows(mainOrigin)) {
                trustedWebOrigins.add(origin);
            }
        }
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        const goneDetails = details || {};

        recordDiagnosticEvent('main-render-process-gone', goneDetails);
        if (goneDetails.reason !== 'clean-exit') {
            showMainRecoveryScreen('crash', goneDetails);
        }
    });
    mainWindow.webContents.on('unresponsive', () => {
        promptForUnresponsiveRenderer();
    });
    mainWindow.loadURL(indexURL);

    if (isDev) {
        mainWindow.webContents.session.clearCache();
    }

    // Block access to file:// URLs.
    const fileFilter = {
        urls: ['file://*'],
    };

    const allowedFileRoots = getAllowedFileRoots();

    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(fileFilter, (details, callback) => {
        const requestedPath = path.resolve(URL.fileURLToPath(details.url));
        const isAllowedPath = allowedFileRoots.some((root) => isPathInside(root, requestedPath));

        if (!isAllowedPath) {
            callback({ cancel: true });
            console.warn(`Rejected file URL: ${details.url}`);

            return;
        }

        callback({ cancel: false });
    });

    // Filter out x-frame-options and frame-ancestors CSP to allow loading jitsi via the iframe API
    // Resolves https://github.com/jitsi/jitsi-meet-electron/issues/285
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        delete details.responseHeaders['x-frame-options'];

        if (details.responseHeaders['content-security-policy']) {
            const cspFiltered = details.responseHeaders['content-security-policy'][0]
                .split(';')
                .filter((x) => x.indexOf('frame-ancestors') === -1)
                .join(';');

            details.responseHeaders['content-security-policy'] = [cspFiltered];
        }

        if (details.responseHeaders['Content-Security-Policy']) {
            const cspFiltered = details.responseHeaders['Content-Security-Policy'][0]
                .split(';')
                .filter((x) => x.indexOf('frame-ancestors') === -1)
                .join(';');

            details.responseHeaders['Content-Security-Policy'] = [cspFiltered];
        }

        callback({
            responseHeaders: details.responseHeaders,
        });
    });

    // Block redirects.
    const allowedRedirects = ['http:', 'https:', 'ws:', 'wss:'];

    mainWindow.webContents.addListener('will-redirect', (ev, url) => {
        const requestedUrl = new URL.URL(url);

        if (!allowedRedirects.includes(requestedUrl.protocol)) {
            console.warn(`Disallowing redirect to ${url}`);
            ev.preventDefault();
        }
    });

    mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
        const localMediaCheck =
            mediaCheckWindow && !mediaCheckWindow.isDestroyed() && webContents === mediaCheckWindow.webContents;
        const allowedOrigin = localMediaCheck || getTrustedOriginPolicy().allows(requestingOrigin);
        const allowed = permission !== 'openExternal' && allowedOrigin;

        updatePermissionState(permission, allowed ? 'allowed-check' : 'blocked-check', {
            ...(details || {}),
            requestingOrigin,
        });

        return allowed;
    });

    // Block opening any external applications.
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
        if (permission === 'openExternal') {
            console.warn(`Disallowing opening ${details?.externalURL || 'external URL'}`);
            updatePermissionState(permission, 'blocked', details);
            callback(false);

            return;
        }

        const localMediaCheck =
            mediaCheckWindow && !mediaCheckWindow.isDestroyed() && webContents === mediaCheckWindow.webContents;
        const requestingOrigin = details?.requestingOrigin || details?.securityOrigin;
        const allowed = localMediaCheck || getTrustedOriginPolicy().allows(requestingOrigin);

        if (!allowed) {
            updatePermissionState(permission, 'blocked', details);
            callback(false);

            return;
        }

        updatePermissionState(permission, 'allowed', details);
        callback(true);
    });

    initPopupsConfigurationMain(mainWindow, windowOpenHandler);
    setupPictureInPictureMain(mainWindow);
    setupPowerMonitorMain(mainWindow);
    setupJitsiScreenShareSourceHandler();
    setupScreenShareHandler(mainWindow);
    if (ENABLE_REMOTE_CONTROL) {
        setupRemoteControlMain(mainWindow);
    }

    // Hide to tray instead of quitting when the user clicks the X button.
    // Only exception: user explicitly chose Quit (from app menu, tray, or Cmd+Q).
    mainWindow.on('close', (ev) => {
        if (!isQuitting) {
            ev.preventDefault();
            mainWindow.hide();
            showCloseToTrayNotice();
        }
    });

    mainWindow.on('closed', () => {
        chromeCSSGeneration += 1;
        chromeCSSKey = null;
        mainWindowHasBeenShown = false;
        mainWindow = null;
        closeToolbarWindow();
    });

    // Close the floating toolbar if the main renderer navigates away
    // (reload, URL change). Defensive: the webapp normally sends
    // 'toolbar:close' via screenSharingStatusChanged first.
    mainWindow.webContents.on('did-start-navigation', (_ev, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) {
            closeToolbarWindow();
        }
    });

    mainWindow.once('ready-to-show', () => {
        mainWindowHasBeenShown = true;
        mainWindow.show();
    });

    // Keep one platform-aware chrome stylesheet active for the current main
    // document. Fullscreen removes the reserved overlay area entirely.
    const syncChromeLayout = () => refreshChromeCSS(mainWindow);

    mainWindow.webContents.on('did-finish-load', syncChromeLayout);
    mainWindow.on('enter-full-screen', syncChromeLayout);
    mainWindow.on('leave-full-screen', syncChromeLayout);

    // Create the tray icon once the main window exists.
    createTray();

    /**
     * When someone tries to enter something like jitsi-meet://test
     *  while app is closed
     * it will trigger this event below
     */
    handleProtocolCall(process.argv.pop());
}

/**
 * Opens new window with WebRTC internals.
 */
function createWebRTCInternalsWindow() {
    const options = {
        minWidth: 800,
        minHeight: 600,
        show: true,
    };

    webrtcInternalsWindow = new BrowserWindow(options);
    webrtcInternalsWindow.loadURL('chrome://webrtc-internals');
}

function getSupportedProtocolRoute(fullProtocolCall) {
    try {
        const parsed = new URL.URL(fullProtocolCall);
        const expectedProtocol = `${config.default.appProtocolPrefix}:`;

        if (parsed.protocol !== expectedProtocol) {
            return null;
        }

        const segments = [parsed.hostname, ...parsed.pathname.split('/')].filter(Boolean);

        if (!segments.length) {
            return '';
        }

        if (segments.length !== 2 || segments[0] !== 'meeting') {
            return null;
        }

        const meetingId = decodeURIComponent(segments[1]);

        if (!/^[A-Za-z0-9._~-]+$/.test(meetingId)) {
            return null;
        }

        return `meeting/${encodeURIComponent(meetingId)}`;
    } catch (err) {
        recordDiagnosticEvent('protocol-link-parse-error', {
            message: err.message,
        });

        return null;
    }
}

/**
 * Handler for hashmeet:// protocol links. Navigates the main window to
 * the corresponding meet.hashmicro.com URL.
 */
async function handleProtocolCall(fullProtocolCall) {
    if (!fullProtocolCall || fullProtocolCall.trim() === '' || fullProtocolCall.indexOf(appProtocolSurplus) !== 0) {
        return;
    }

    const route = getSupportedProtocolRoute(fullProtocolCall);

    if (route === null) {
        console.warn(`Rejected unsupported protocol URL: ${redactDiagnosticString(fullProtocolCall)}`);
        recordDiagnosticEvent('protocol-link-rejected', {
            url: fullProtocolCall,
        });

        return;
    }

    const target = buildHashMeetURL(route);

    if (!app.isReady()) {
        pendingProtocolCall = fullProtocolCall;
        recordDiagnosticEvent('protocol-link-queued', {
            route: route ? 'meeting' : 'home',
        });

        return;
    }

    if (mainWindow === null) {
        createJitsiMeetWindow();
    }

    if (mainWindow) {
        const wasHidden = !mainWindow.isVisible();
        const wasMinimized = mainWindow.isMinimized();

        showAndFocusMainWindow();
        if (wasHidden || wasMinimized) {
            recordDiagnosticEvent('protocol-link-window-restored', {
                wasHidden,
                wasMinimized,
            });
        }

        const currentMeetingId = getMeetingIdFromURL(mainWindow.webContents.getURL());
        const targetMeetingId = getMeetingIdFromURL(target);

        if (currentMeetingId && targetMeetingId && currentMeetingId === targetMeetingId) {
            recordDiagnosticEvent('protocol-link-opened', {
                route: 'current-meeting',
            });

            return;
        }

        if (!(await navigateMainWindow('deep-link', target))) {
            return;
        }
        recordDiagnosticEvent('protocol-link-opened', {
            route: route ? 'meeting' : 'home',
        });
    }
}

/**
 * Force Single Instance Application.
 * Handle this on darwin via LSMultipleInstancesProhibited in Info.plist as below does not work on MAS
 */
const gotInstanceLock = process.platform === 'darwin' ? true : app.requestSingleInstanceLock();

if (!gotInstanceLock) {
    app.quit();
    process.exit(0);
}

/**
 * Run the application.
 */

app.on('activate', () => {
    if (mainWindow === null) {
        createJitsiMeetWindow();
    } else {
        showAndFocusMainWindow();
    }
});

// Ensure app.quit() propagates past the close-to-hide interceptor.
app.on('before-quit', () => {
    isQuitting = true;
    closeToolbarWindow();
});

app.on(
    'certificate-error',
    // eslint-disable-next-line max-params
    (event, _webContents, url, error, _certificate, callback) => {
        if (!isAllowedLocalhostCertificateURL(url)) {
            callback(false);

            return;
        }

        event.preventDefault();
        recordDiagnosticEvent('localhost-certificate-accepted', {
            error,
            origin: normalizeWebOrigin(url),
        });
        callback(true);
    },
);

app.on('ready', () => {
    preferenceStore = createUserDataPreferenceStore(app, {
        recordDiagnostic: recordDiagnosticEvent,
    });
    if (!mainWindow) {
        createJitsiMeetWindow();
    }
    if (pendingProtocolCall) {
        const protocolCall = pendingProtocolCall;

        pendingProtocolCall = null;
        handleProtocolCall(protocolCall);
    }
});

if (isDev) {
    app.on('ready', createWebRTCInternalsWindow);
}

app.on('second-instance', (event, commandLine) => {
    /**
     * If someone creates second instance of the application, set focus on
     * existing window.
     */
    if (mainWindow) {
        showAndFocusMainWindow();

        /**
         * This is for windows [win32]
         * so when someone tries to enter something like jitsi-meet://test
         * while app is opened it will trigger protocol handler.
         */
        handleProtocolCall(commandLine.pop());
    }
});

app.on('window-all-closed', () => {
    app.quit();
});

// remove so we can register each time as we run the app.
app.removeAsDefaultProtocolClient(config.default.appProtocolPrefix);

// If we are running a non-packaged version of the app && on windows
if (isDev && process.platform === 'win32') {
    // Set the path of electron.exe and your app.
    // These two additional parameters are only available on windows.
    app.setAsDefaultProtocolClient(config.default.appProtocolPrefix, process.execPath, [path.resolve(process.argv[1])]);
} else {
    app.setAsDefaultProtocolClient(config.default.appProtocolPrefix);
}

/**
 * This is for mac [darwin]
 * so when someone tries to enter something like jitsi-meet://test
 * it will trigger this event below
 */
app.on('open-url', (event, data) => {
    event.preventDefault();
    handleProtocolCall(data);
});

/**
 * Handle opening external links in the main process.
 */
ipcMain.on('jitsi-open-url', (event, someUrl) => {
    if (isTrustedRemoteIpc(event)) {
        openExternalLink(someUrl);
    }
});

ipcMain.handle('desktop:get-info', (event) => (isTrustedRemoteIpc(event) ? getDesktopInfo() : null));

ipcMain.handle('permissions:get-status', (event) => (isTrustedRemoteIpc(event) ? getPermissionStatus() : null));

ipcMain.handle('media:get-status', (event) => (isTrustedRemoteIpc(event) ? getMediaCapabilities() : null));

ipcMain.handle('media:request-access', (event, kind) => {
    if (!isTrustedRemoteIpc(event)) {
        return { granted: false, status: 'denied' };
    }

    return requestNativeMediaAccess(kind);
});

ipcMain.handle('media:open-settings', (event, kind) => {
    if (!isTrustedRemoteIpc(event)) {
        return { ok: false, reason: 'untrusted-sender' };
    }

    return openMediaSystemSettings(kind);
});

const isMediaCheckSender = (event) =>
    mediaCheckWindow && !mediaCheckWindow.isDestroyed() && event.sender === mediaCheckWindow.webContents;

ipcMain.handle('media-check:get-status', (event) => (isMediaCheckSender(event) ? getMediaCapabilities() : null));
ipcMain.handle('media-check:request-access', (event, kind) => {
    if (!isMediaCheckSender(event)) {
        return { granted: false, status: 'denied' };
    }

    return requestNativeMediaAccess(kind);
});
ipcMain.handle('media-check:report-device-access', (event, result) => {
    if (!isMediaCheckSender(event) || !result || !['camera', 'microphone'].includes(result.kind)) {
        return { ok: false, reason: 'untrusted-or-invalid' };
    }

    const status = classifyDeviceAccessResult(result);

    permissionState[result.kind] = sanitizeDiagnosticValue({
        status,
        permission: result.kind,
        updatedAt: new Date().toISOString(),
        details: {
            source: 'media-check-device-request',
            errorName: result.errorName || null,
        },
    });
    recordDiagnosticEvent('media-device-access-result', {
        kind: result.kind,
        status,
        errorName: result.errorName || null,
    });
    notifyMediaStatusChanged();

    return { ok: true, status };
});
ipcMain.handle('media-check:open-settings', (event, kind) => {
    if (!isMediaCheckSender(event)) {
        return { ok: false, reason: 'untrusted-sender' };
    }

    return openMediaSystemSettings(kind);
});

const isOfflineMainSender = (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
        return false;
    }

    try {
        const currentURL = new URL.URL(mainWindow.webContents.getURL());

        return currentURL.protocol === 'file:' && currentURL.pathname.endsWith('/offline/offline.html');
    } catch (_) {
        return false;
    }
};

ipcMain.on('app:retry', (event) => {
    if (!isOfflineMainSender(event)) {
        return;
    }

    const retryURL = normalizeWebOrigin(lastFailedMainURL) ? lastFailedMainURL : hashMeetServerURL;

    recordDiagnosticEvent('main-window-retry', { url: retryURL });
    recoveryScreenActive = false;
    mainWindow.loadURL(retryURL);
});
ipcMain.handle('app:copy-diagnostics', (event) =>
    isOfflineMainSender(event) ? copyDiagnosticsToClipboard() : { ok: false, reason: 'untrusted-sender' },
);

ipcMain.on('diagnostics:record', (_event, payload) => {
    const event = _event;
    const fromToolbar = toolbarWindow && !toolbarWindow.isDestroyed() && event.sender === toolbarWindow.webContents;

    if (!fromToolbar && !isTrustedRemoteIpc(event)) {
        return;
    }
    if (payload && typeof payload === 'object' && payload.type) {
        recordDiagnosticEvent(payload.type, payload.payload || {});
    } else {
        recordDiagnosticEvent('renderer-event', payload || {});
    }
});

ipcMain.handle('diagnostics:copy', (event) =>
    isTrustedRemoteIpc(event)
        ? copyDiagnosticsToClipboard()
        : {
              ok: false,
              reason: 'untrusted-sender',
          },
);

/**
 * Restore the meeting window (e.g. from PiP).
 */
ipcMain.on('restore-meeting-window', (event) => {
    if (!isTrustedRemoteIpc(event)) {
        return;
    }
    if (mainWindow) {
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.focus();
    }
});

/**
 * Main renderer requests the floating toolbar (screen share started).
 */
ipcMain.on('toolbar:open', (_ev, initialState) => {
    if (!isTrustedRemoteIpc(_ev)) {
        return;
    }
    createToolbarWindow(initialState || {});
});

/**
 * Main renderer requests the floating toolbar be closed (screen share stopped).
 */
ipcMain.on('toolbar:close', (event) => {
    if (!isTrustedRemoteIpc(event)) {
        return;
    }
    closeToolbarWindow();
});

ipcMain.on('toolbar:return-focus', (event) => {
    const fromToolbar = toolbarWindow && !toolbarWindow.isDestroyed() && event.sender === toolbarWindow.webContents;

    if (!fromToolbar || !mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    mainWindow.show();
    mainWindow.focus();
});

/**
 * Main renderer pushes a state patch (pause/mute/speaker/count changed).
 * Silently drops when no toolbar window exists.
 */
ipcMain.on('toolbar:state', (_ev, patch) => {
    if (!isTrustedRemoteIpc(_ev)) {
        return;
    }
    if (toolbarWindow && !toolbarWindow.isDestroyed()) {
        toolbarWindow.webContents.send('toolbar:state', patch || {});
    }
});

ipcMain.handle('toolbar:execute', (event, payload) => toolbarCommandBroker.execute(event, payload));

ipcMain.on('toolbar:result', (event, result) => {
    toolbarCommandBroker.handleResult(event, result);
});

ipcMain.on('call:set-state', (event, state) => {
    if (!isTrustedRemoteIpc(event) || !state || typeof state !== 'object') {
        return;
    }

    const wasInMeeting = callState.inMeeting;

    callState = {
        inMeeting: state.inMeeting === true,
        muted: state.muted !== false,
        sharing: state.sharing === true,
    };
    recordDiagnosticEvent('call-state-changed', callState);
    syncNativeMenus();

    if (wasInMeeting && !callState.inMeeting && deferredUpdatePrompt) {
        recordDiagnosticEvent('update-restart-defer-ended', { version: updateState.version });
        promptForDownloadedUpdate({ source: 'meeting-ended' });
    }
});
