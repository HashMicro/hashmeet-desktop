/* global __dirname */

const {
    initPopupsConfigurationMain,
    getPopupTarget,
    setupPictureInPictureMain,
    setupRemoteControlMain,
    setupPowerMonitorMain
} = require('@jitsi/electron-sdk');
const {
    BrowserWindow,
    Menu,
    Tray,
    app,
    clipboard,
    desktopCapturer,
    ipcMain,
    screen,
    shell
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
const pkgJson = require('./package.json');

const showDevTools = Boolean(process.env.SHOW_DEV_TOOLS) || process.argv.includes('--show-dev-tools');
const enableDesktopDiagnostics = isDev
    || showDevTools
    || process.env.HASHMEET_DESKTOP_DIAGNOSTICS === 'true'
    || process.argv.includes('--diagnostics');

// For enabling remote control, please change the ENABLE_REMOTE_CONTROL flag in
// app/features/conference/components/Conference.js to true as well
const ENABLE_REMOTE_CONTROL = false;

const HASHMEET_SERVER_URL_ENV = 'HASHMEET_DESKTOP_SERVER_URL';
const JITSI_SCREEN_SHARE_GET_SOURCES = 'jitsi-screen-sharing-get-sources';
const defaultServerURL = config.default.defaultServerURL;
const allowServerURLOverride = isDev
    || process.env.HASHMEET_DESKTOP_ALLOW_SERVER_OVERRIDE === 'true'
    || process.argv.includes('--allow-server-override');

/**
 * Resolves the HashMeet web app URL used by the desktop shell.
 *
 * @returns {string}
 */
function resolveServerURL() {
    const envURL = process.env[HASHMEET_SERVER_URL_ENV];

    if (envURL && !allowServerURLOverride) {
        console.warn(
            `[config] Ignoring ${HASHMEET_SERVER_URL_ENV} in packaged mode. `
            + 'Use development mode or HASHMEET_DESKTOP_ALLOW_SERVER_OVERRIDE=true for test builds.'
        );
    }

    const configuredURL = envURL && allowServerURLOverride ? envURL : defaultServerURL;

    try {
        const url = new URL.URL(configuredURL);

        if (![ 'http:', 'https:' ].includes(url.protocol)) {
            throw new Error(`Unsupported protocol: ${url.protocol}`);
        }

        url.hash = '';
        url.search = '';

        return url.toString().replace(/\/$/, '');
    } catch (err) {
        console.warn(
            `[config] Invalid ${HASHMEET_SERVER_URL_ENV} "${configuredURL}", `
            + `falling back to ${defaultServerURL}: ${err.message}`
        );

        return defaultServerURL;
    }
}

const hashMeetServerURL = resolveServerURL();

function getAppBasePathCandidates() {
    const appPath = app.getAppPath();
    const candidates = [
        appPath,
        path.resolve(appPath, '..')
    ];

    if (typeof __dirname === 'string' && path.isAbsolute(__dirname)) {
        candidates.push(__dirname, path.resolve(__dirname, '..'));
    }

    if (isDev) {
        candidates.push(process.cwd());
    }

    return Array.from(new Set(candidates.map(candidate => path.resolve(candidate))));
}

function resolveAppAssetPath(...segments) {
    const candidates = getAppBasePathCandidates().map(candidate => path.resolve(candidate, ...segments));
    const found = candidates.find(candidate => fs.existsSync(candidate));

    return found || candidates[0];
}

function isPathInside(parentPath, childPath) {
    const relativePath = path.relative(parentPath, childPath);

    return relativePath === '' || (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function getAllowedFileRoots() {
    return getAppBasePathCandidates().filter(candidate => fs.existsSync(candidate));
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

// Fix screen-sharing thumbnails being missing sometimes.
// https://github.com/electron/electron/issues/44504
const disabledFeatures = [
    'ThumbnailCapturerMac:capture_mode/sc_screenshot_manager',
    'ScreenCaptureKitPickerScreen',
    'ScreenCaptureKitStreamPickerSonoma'
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

// Enable context menu so things like copy and paste work in input fields.
contextMenu({
    showLookUpSelection: false,
    showSearchWithGoogle: false,
    showCopyImage: false,
    showCopyImageAddress: false,
    showSaveImage: false,
    showSaveImageAs: false,
    showInspectElement: enableDesktopDiagnostics,
    showServices: false
});

// Keep DevTools unavailable in normal packaged builds. They can still be
// enabled explicitly for diagnostics with SHOW_DEV_TOOLS=true or --diagnostics.
if (enableDesktopDiagnostics) {
    debug({
        isEnabled: true,
        showDevTools
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
let jitsiScreenShareSourceHandlerRegistered = false;

const MAX_DIAGNOSTIC_EVENTS = 80;
const diagnosticsEvents = [];
const permissionState = {
    media: { status: 'unknown' },
    displayCapture: { status: 'unknown' },
    notifications: { status: 'unknown' },
    openExternal: { status: 'blocked' }
};
let lastScreenShareSource = null;

/**
 * Add protocol data
 */
const appProtocolSurplus = `${config.default.appProtocolPrefix}://`;
let rendererReady = false;
let protocolDataForFrontApp = null;

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactLocalPath(value) {
    let text = String(value);
    const localRoots = [
        process.env.HOME,
        process.env.USERPROFILE
    ].filter(root => root && root.length > 3);

    localRoots.forEach(root => {
        text = text.replace(new RegExp(escapeRegExp(root), 'g'), '~');
    });

    return text;
}

function redactDiagnosticString(value) {
    let text = redactLocalPath(value)
        .replace(/((?:authorization|cookie|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]');

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
        return value.slice(0, 20).map(item => sanitizeDiagnosticValue(item, depth + 1));
    }

    if (typeof value === 'object') {
        return Object.entries(value).slice(0, 30).reduce((acc, [ key, item ]) => {
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
        payload: sanitizeDiagnosticValue(payload)
    };

    diagnosticsEvents.push(event);

    while (diagnosticsEvents.length > MAX_DIAGNOSTIC_EVENTS) {
        diagnosticsEvents.shift();
    }

    return event;
}

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
        permissions: getPermissionStatus()
    };
}

function getDiagnosticBundle() {
    return {
        generatedAt: new Date().toISOString(),
        desktop: getDesktopInfo(),
        events: diagnosticsEvents.slice()
    };
}

function copyDiagnosticsToClipboard() {
    const bundle = getDiagnosticBundle();

    clipboard.writeText(JSON.stringify(bundle, null, 2));
    recordDiagnosticEvent('diagnostics-copied', { eventCount: diagnosticsEvents.length });

    return {
        ok: true,
        eventCount: diagnosticsEvents.length
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
        openExternal: 'openExternal'
    };
    const key = keyMap[permission] || permission;
    const snapshot = {
        status,
        permission,
        updatedAt: new Date().toISOString()
    };

    if (details && typeof details === 'object') {
        snapshot.details = sanitizeDiagnosticValue(details);
    }

    permissionState[key] = sanitizeDiagnosticValue(snapshot);
    recordDiagnosticEvent('permission-request', {
        permission,
        status,
        details: snapshot
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
        type: source.id.startsWith('screen:') ? 'screen' : 'window'
    };
}

function isWaylandSession() {
    return process.platform === 'linux'
        && (
            String(process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland'
            || Boolean(process.env.WAYLAND_DISPLAY)
        );
}

function displayMediaRequestHandlerOptions() {
    return {
        // Electron only supports the explicit system picker option on macOS.
        // Linux Wayland reaches the PipeWire portal through desktopCapturer.
        useSystemPicker: process.platform === 'darwin'
    };
}

function shouldUseOpaqueToolbarWindow() {
    return isWaylandSession();
}

function attachToolbarWindowDiagnostics(targetWindow) {
    const record = (type, payload = {}) => recordDiagnosticEvent(`toolbar-window-${type}`, {
        ...payload,
        wayland: isWaylandSession()
    });

    targetWindow.webContents.on('did-fail-load', (
            _event,
            errorCode,
            errorDescription,
            validatedURL,
            isMainFrame
    ) => {
        record('did-fail-load', {
            errorCode,
            errorDescription,
            validatedURL,
            isMainFrame
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
            sourceId
        });
    });
}

function grantScreenShareSource(source, callback, origin = 'custom-picker') {
    if (!source) {
        recordDiagnosticEvent('screen-share-source-cancelled', { origin });
        callback(null);

        return;
    }

    lastScreenShareSource = buildSourceInfo(source);
    updatePermissionState('display-capture', 'allowed', {
        origin,
        sourceName: lastScreenShareSource.name,
        sourceType: lastScreenShareSource.type,
        wayland: isWaylandSession()
    });
    recordDiagnosticEvent('screen-share-source-selected', {
        ...lastScreenShareSource,
        origin,
        wayland: isWaylandSession()
    });
    sendToMainWindow('desktop:screen-source-selected', lastScreenShareSource);
    callback({ video: source });
}

function setupJitsiScreenShareSourceHandler() {
    if (jitsiScreenShareSourceHandlerRegistered) {
        return;
    }

    ipcMain.handle(JITSI_SCREEN_SHARE_GET_SOURCES, (_event, options = {}) => {
        const sourceOptions = {
            ...options,
            types: options.types || [ 'screen', 'window' ],
            thumbnailSize: options.thumbnailSize || { width: 320, height: 200 },
            fetchWindowIcons: options.fetchWindowIcons === true
        };

        recordDiagnosticEvent('screen-share-source-list-requested', {
            types: sourceOptions.types,
            thumbnailSize: sourceOptions.thumbnailSize
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
        }
    };

    const template = [
        ...(isMac ? [ {
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
                quitItem
            ]
        } ] : []),
        {
            label: 'File',
            submenu: [
                {
                    label: 'Home',
                    accelerator: 'CmdOrCtrl+Shift+H',
                    click: () => { if (mainWindow) mainWindow.loadURL(homeURL); }
                },
                { type: 'separator' },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => { if (mainWindow) mainWindow.reload(); }
                },
                {
                    label: 'Force Reload',
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: () => { if (mainWindow) mainWindow.webContents.reloadIgnoringCache(); }
                },
                ...(isMac ? [] : [ { type: 'separator' }, quitItem ])
            ]
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
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { role: 'togglefullscreen' },
                ...(enableDesktopDiagnostics ? [
                    { type: 'separator' },
                    {
                        label: 'Toggle Developer Tools',
                        accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
                        click: () => { if (mainWindow) mainWindow.webContents.toggleDevTools(); }
                    }
                ] : [])
            ]
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                ...(isMac
                    ? [ { type: 'separator' }, { role: 'front' } ]
                    : [ {
                        label: 'Hide to Tray',
                        accelerator: 'Ctrl+W',
                        click: () => { if (mainWindow) mainWindow.hide(); }
                    } ])
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Copy Diagnostics',
                    accelerator: 'CmdOrCtrl+Shift+D',
                    click: () => copyDiagnosticsToClipboard()
                },
                ...(enableDesktopDiagnostics ? [ {
                    label: 'Open WebRTC Internals',
                    click: () => createWebRTCInternalsWindow()
                } ] : []),
                { type: 'separator' },
                {
                    label: 'Report an Issue',
                    click: () => shell.openExternal('https://github.com/HashMicro/hashmeet-desktop/issues')
                },
                {
                    label: 'HashMicro Website',
                    click: () => shell.openExternal('https://hashmicro.com')
                }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Create the system tray icon with context menu (Show / Quit).
 * Clicking the tray icon toggles window visibility.
 */
function createTray() {
    if (tray) return;

    const iconPath = resolveAppAssetPath('resources', 'tray-icon.png');
    try {
        tray = new Tray(iconPath);
    } catch (err) {
        console.warn('[tray] Could not create system tray icon:', err.message);
        return;
    }
    tray.setToolTip('HashMeet');
    tray.setContextMenu(Menu.buildFromTemplate([
        {
            label: 'Show HashMeet',
            click: () => {
                if (mainWindow) {
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]));

    tray.on('click', () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
            mainWindow.hide();
        } else {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

/**
 * CSS injected on every page load to push webapp content below the
 * custom title bar area. On non-macOS platforms we also render a
 * draggable dark strip behind the titleBarOverlay buttons so the window can be moved.
 * macOS uses titleBarStyle 'hiddenInset' so drag is native — only
 * padding is needed to keep content clear of the traffic lights.
 */
function getChromeCSS() {
    if (process.platform === 'darwin') {
        return `
            :root { --hashmeet-desktop-chrome-height: 28px; }
            body {
                padding-top: var(--hashmeet-desktop-chrome-height) !important;
                -webkit-app-region: drag;
            }
            body > * { -webkit-app-region: no-drag; }
            #jitsi-container.header-hidden {
                top: var(--hashmeet-desktop-chrome-height) !important;
                height: calc(100vh - var(--hashmeet-desktop-chrome-height)) !important;
                height: calc(100dvh - var(--hashmeet-desktop-chrome-height)) !important;
            }
        `;
    }

    return `
        :root { --hashmeet-desktop-chrome-height: 36px; }
        body {
            padding-top: var(--hashmeet-desktop-chrome-height) !important;
            -webkit-app-region: drag;
        }
        body > * { -webkit-app-region: no-drag; }
        body > header.navbar,
        body header.navbar,
        .navbar.fixed-top,
        .navbar.sticky-top {
            box-sizing: border-box !important;
            padding-right: 144px !important;
        }
        #jitsi-container.header-hidden {
            top: var(--hashmeet-desktop-chrome-height) !important;
            height: calc(100vh - var(--hashmeet-desktop-chrome-height)) !important;
            height: calc(100dvh - var(--hashmeet-desktop-chrome-height)) !important;
        }
    `;
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
            const sourceOptions = {
                types: [ 'screen', 'window' ],
                thumbnailSize: { width: 320, height: 200 },
                fetchWindowIcons: false
            };
            const sources = await desktopCapturer.getSources(sourceOptions);

            if (!sources.length) {
                recordDiagnosticEvent('screen-share-no-sources', {
                    wayland: isWaylandSession(),
                    request: {
                        audioRequested: request.audioRequested,
                        videoRequested: request.videoRequested,
                        securityOrigin: request.securityOrigin,
                        userGesture: request.userGesture
                    }
                });
                callback(null);
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
                    contextIsolation: false,
                    nodeIntegration: true,
                    sandbox: false
                }
            });

            picker.setMenuBarVisibility(false);
            picker.loadFile(resolveAppAssetPath('picker', 'picker.html'));

            const sourcesById = new Map();
            sources.forEach(s => sourcesById.set(s.id, s));

            const payload = sources.map(s => ({
                id: s.id,
                name: s.name,
                type: s.id.startsWith('screen:') ? 'screen' : 'window',
                thumbnail: s.thumbnail.toDataURL()
            }));

            picker.webContents.once('did-finish-load', () => {
                picker.webContents.send('sources', payload);
                picker.show();
            });

            let settled = false;
            const finish = (sourceId) => {
                if (settled) return;
                settled = true;
                const source = sourceId ? sourcesById.get(sourceId) : null;

                grantScreenShareSource(source, callback, 'custom-picker');

                if (!picker.isDestroyed()) {
                    picker.close();
                }
            };

            const onSelect = (_ev, sourceId) => finish(sourceId);
            ipcMain.once('picker:select', onSelect);

            picker.on('closed', () => {
                ipcMain.removeListener('picker:select', onSelect);
                finish(null);
            });
        } catch (err) {
            console.error('[screenshare] handler error:', err);
            recordDiagnosticEvent('screen-share-handler-error', {
                message: err.message,
                stack: err.stack
            });
            callback(null);
        }
    }, displayMediaRequestHandlerOptions());
}

/**
 * Open (or refresh) the floating always-on-top screen-share toolbar.
 * Loaded from `toolbar/toolbar.html`; state is fed via IPC.
 *
 * Positioned bottom-center of the primary display. On Wayland we avoid
 * transparent/non-focusable flags because some compositors render them blank.
 */
function createToolbarWindow(initialState) {
    if (toolbarWindow && !toolbarWindow.isDestroyed()) {
        toolbarWindow.webContents.send('toolbar:init', initialState || {});
        if (!toolbarWindow.isVisible()) {
            toolbarWindow.showInactive();
        }

        return;
    }

    const { workArea } = screen.getPrimaryDisplay();
    const TOOLBAR_WIDTH = Math.min(680, Math.max(560, workArea.width - 48));
    const TOOLBAR_HEIGHT = 104;
    const MARGIN_BOTTOM = 40;
    const opaqueToolbarWindow = shouldUseOpaqueToolbarWindow();

    const x = Math.round(workArea.x + ((workArea.width - TOOLBAR_WIDTH) / 2));
    const y = Math.round((workArea.y + workArea.height) - TOOLBAR_HEIGHT - MARGIN_BOTTOM);

    toolbarWindow = new BrowserWindow({
        width: TOOLBAR_WIDTH,
        height: TOOLBAR_HEIGHT,
        x,
        y,
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
        focusable: opaqueToolbarWindow,
        acceptFirstMouse: true,
        hasShadow: !opaqueToolbarWindow,
        show: false,
        title: 'HashMeet Screen Share',
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            sandbox: false,
            backgroundThrottling: false
        }
    });

    attachToolbarWindowDiagnostics(toolbarWindow);
    recordDiagnosticEvent('toolbar-window-created', {
        opaque: opaqueToolbarWindow,
        focusable: opaqueToolbarWindow,
        wayland: isWaylandSession(),
        bounds: { x, y, width: TOOLBAR_WIDTH, height: TOOLBAR_HEIGHT }
    });
    toolbarWindow.setAlwaysOnTop(true, 'screen-saver');
    toolbarWindow.setMenuBarVisibility(false);
    if (process.platform === 'darwin') {
        toolbarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    const toolbarPath = resolveAppAssetPath('toolbar', 'toolbar.html');

    recordDiagnosticEvent('toolbar-window-load-file', {
        path: toolbarPath,
        exists: fs.existsSync(toolbarPath)
    });
    toolbarWindow.loadFile(toolbarPath);

    toolbarWindow.webContents.once('did-finish-load', () => {
        if (!toolbarWindow || toolbarWindow.isDestroyed()) {
            return;
        }
        recordDiagnosticEvent('toolbar-window-loaded', {
            wayland: isWaylandSession(),
            visible: toolbarWindow.isVisible()
        });
        toolbarWindow.webContents.send('toolbar:init', initialState || {});
        toolbarWindow.showInactive();
    });

    toolbarWindow.on('closed', () => {
        toolbarWindow = null;
    });
}

/**
 * Destroy the floating toolbar window if it's open.
 */
function closeToolbarWindow() {
    if (toolbarWindow && !toolbarWindow.isDestroyed()) {
        toolbarWindow.close();
    }
    toolbarWindow = null;
}

/**
 * Opens the main HashMeet window (loads meet.hashmicro.com directly).
 */
function createJitsiMeetWindow() {
    // Application menu.
    setApplicationMenu();

    // Check for Updates.
    if (!process.mas) {
        autoUpdater.checkForUpdatesAndNotify();
    }

    // Load the previous window state with fallback to defaults.
    const windowState = windowStateKeeper({
        defaultWidth: 800,
        defaultHeight: 600,
        fullScreen: false
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
        ...(isMac ? {} : {
            titleBarOverlay: {
                color: '#1a1a1a',
                symbolColor: '#ffffff',
                height: 36
            }
        }),
        webPreferences: {
            enableBlinkFeatures: 'WebAssemblyCSP',
            contextIsolation: false,
            nodeIntegration: false,
            preload: resolveAppAssetPath('build', 'preload.js'),
            sandbox: false
        }
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
    mainWindow.loadURL(indexURL);

    if (isDev) {
        mainWindow.webContents.session.clearCache();
    }

    // Block access to file:// URLs.
    const fileFilter = {
        urls: [ 'file://*' ]
    };

    const allowedFileRoots = getAllowedFileRoots();

    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(fileFilter, (details, callback) => {
        const requestedPath = path.resolve(URL.fileURLToPath(details.url));
        const isAllowedPath = allowedFileRoots.some(root => isPathInside(root, requestedPath));

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
                .filter(x => x.indexOf('frame-ancestors') === -1)
                .join(';');

            details.responseHeaders['content-security-policy'] = [ cspFiltered ];
        }

        if (details.responseHeaders['Content-Security-Policy']) {
            const cspFiltered = details.responseHeaders['Content-Security-Policy'][0]
                .split(';')
                .filter(x => x.indexOf('frame-ancestors') === -1)
                .join(';');

            details.responseHeaders['Content-Security-Policy'] = [ cspFiltered ];
        }

        callback({
            responseHeaders: details.responseHeaders
        });
    });

    // Block redirects.
    const allowedRedirects = [
        'http:',
        'https:',
        'ws:',
        'wss:'
    ];

    mainWindow.webContents.addListener('will-redirect', (ev, url) => {
        const requestedUrl = new URL.URL(url);

        if (!allowedRedirects.includes(requestedUrl.protocol)) {
            console.warn(`Disallowing redirect to ${url}`);
            ev.preventDefault();
        }
    });

    mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
        const allowed = permission !== 'openExternal';

        updatePermissionState(permission, allowed ? 'allowed-check' : 'blocked-check', {
            ...(details || {}),
            requestingOrigin
        });

        return allowed;
    });

    // Block opening any external applications.
    mainWindow.webContents.session.setPermissionRequestHandler((_, permission, callback, details) => {
        if (permission === 'openExternal') {
            console.warn(`Disallowing opening ${details?.externalURL || 'external URL'}`);
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
        }
    });

    mainWindow.on('closed', () => {
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
        mainWindow.show();
    });

    // Inject chrome CSS (padding + drag strip) on every page load so custom
    // title bar works across navigations inside the Laravel webapp.
    const injectChromeCSS = () => {
        const css = getChromeCSS();
        if (css) {
            mainWindow.webContents.insertCSS(css).catch(() => { /* ignore */ });
        }
    };

    mainWindow.webContents.on('did-finish-load', injectChromeCSS);
    mainWindow.webContents.on('did-frame-finish-load', injectChromeCSS);

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
        show: true
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

        const segments = [
            parsed.hostname,
            ...parsed.pathname.split('/')
        ].filter(Boolean);

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
            message: err.message
        });

        return null;
    }
}

/**
 * Handler for hashmeet:// protocol links. Navigates the main window to
 * the corresponding meet.hashmicro.com URL.
 */
function handleProtocolCall(fullProtocolCall) {
    if (
        !fullProtocolCall
        || fullProtocolCall.trim() === ''
        || fullProtocolCall.indexOf(appProtocolSurplus) !== 0
    ) {
        return;
    }

    const route = getSupportedProtocolRoute(fullProtocolCall);

    if (route === null) {
        console.warn(`Rejected unsupported protocol URL: ${redactDiagnosticString(fullProtocolCall)}`);
        recordDiagnosticEvent('protocol-link-rejected', {
            url: fullProtocolCall
        });

        return;
    }

    const target = buildHashMeetURL(route);

    if (app.isReady() && mainWindow === null) {
        createJitsiMeetWindow();
    }

    if (mainWindow) {
        recordDiagnosticEvent('protocol-link-opened', {
            route: route || 'home'
        });
        mainWindow.loadURL(target);
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
    } else if (!mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.focus();
    }
});

// Ensure app.quit() propagates past the close-to-hide interceptor.
app.on('before-quit', () => {
    isQuitting = true;
    closeToolbarWindow();
});

app.on('certificate-error',
    // eslint-disable-next-line max-params
    (event, webContents, url, error, certificate, callback) => {
        if (isDev) {
            event.preventDefault();
            callback(true);
        } else {
            callback(false);
        }
    }
);

app.on('ready', createJitsiMeetWindow);

if (isDev) {
    app.on('ready', createWebRTCInternalsWindow);
}

app.on('second-instance', (event, commandLine) => {
    /**
     * If someone creates second instance of the application, set focus on
     * existing window.
     */
    if (mainWindow) {
        mainWindow.isMinimized() && mainWindow.restore();
        mainWindow.focus();

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
    app.setAsDefaultProtocolClient(
        config.default.appProtocolPrefix,
        process.execPath,
        [ path.resolve(process.argv[1]) ]
    );
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
 * This is to notify main.js [this] that front app is ready to receive messages.
 */
ipcMain.on('renderer-ready', () => {
    rendererReady = true;
    if (protocolDataForFrontApp) {
        mainWindow
            .webContents
            .send('protocol-data-msg', protocolDataForFrontApp);
    }
});

/**
 * Handle opening external links in the main process.
 */
ipcMain.on('jitsi-open-url', (event, someUrl) => {
    openExternalLink(someUrl);
});

ipcMain.handle('desktop:get-info', () => getDesktopInfo());

ipcMain.handle('permissions:get-status', () => getPermissionStatus());

ipcMain.on('diagnostics:record', (_event, payload) => {
    if (payload && typeof payload === 'object' && payload.type) {
        recordDiagnosticEvent(payload.type, payload.payload || {});
    } else {
        recordDiagnosticEvent('renderer-event', payload || {});
    }
});

ipcMain.handle('diagnostics:copy', () => copyDiagnosticsToClipboard());

/**
 * Restore the meeting window (e.g. from PiP).
 */
ipcMain.on('restore-meeting-window', () => {
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
    createToolbarWindow(initialState || {});
});

/**
 * Main renderer requests the floating toolbar be closed (screen share stopped).
 */
ipcMain.on('toolbar:close', () => {
    closeToolbarWindow();
});

/**
 * Main renderer pushes a state patch (pause/mute/speaker/count changed).
 * Silently drops when no toolbar window exists.
 */
ipcMain.on('toolbar:state', (_ev, patch) => {
    if (toolbarWindow && !toolbarWindow.isDestroyed()) {
        toolbarWindow.webContents.send('toolbar:state', patch || {});
    }
});

/**
 * Toolbar renderer button click — forward to the main renderer so its
 * existing handlers (handlePause / handleMute / handleStop) run.
 */
ipcMain.on('toolbar:action', (_ev, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toolbar:action', payload || {});
    }
});
