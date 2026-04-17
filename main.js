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
const path = require('path');
const process = require('process');
const URL = require('url');

const config = require('./app/features/config');
const { openExternalLink } = require('./app/features/utils/openExternalLink');
const pkgJson = require('./package.json');

const showDevTools = Boolean(process.env.SHOW_DEV_TOOLS) || (process.argv.indexOf('--show-dev-tools') > -1);

// For enabling remote control, please change the ENABLE_REMOTE_CONTROL flag in
// app/features/conference/components/Conference.js to true as well
const ENABLE_REMOTE_CONTROL = false;

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
    showInspectElement: true,
    showServices: false
});

// Enable DevTools also on release builds to help troubleshoot issues. Don't
// show them automatically though.
debug({
    isEnabled: true,
    showDevTools
});

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

/**
 * Add protocol data
 */
const appProtocolSurplus = `${config.default.appProtocolPrefix}://`;
let rendererReady = false;
let protocolDataForFrontApp = null;


/**
 * Builds and installs the application menu. On macOS this shows as the
 * global top-of-screen menu bar. On Windows the menu bar is not rendered
 * (because we use titleBarStyle 'hidden'), but the accelerators still
 * register so keyboard shortcuts like Cmd+R / F11 work.
 */
function setApplicationMenu() {
    const isMac = process.platform === 'darwin';
    const homeURL = config.default.defaultServerURL;

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
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { type: 'separator' },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
                    click: () => { if (mainWindow) mainWindow.webContents.toggleDevTools(); }
                }
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

    const iconPath = path.resolve(app.getAppPath(), 'resources', 'tray-icon.png');
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
 * custom title bar area. On Windows we also render a draggable dark
 * strip behind the titleBarOverlay buttons so the window can be moved.
 * macOS uses titleBarStyle 'hiddenInset' so drag is native — only
 * padding is needed to keep content clear of the traffic lights.
 */
function getChromeCSS() {
    if (process.platform === 'darwin') {
        return 'body { padding-top: 28px !important; }';
    }
    if (process.platform === 'win32') {
        return `
            body { padding-top: 36px !important; }
            html::before {
                content: '';
                position: fixed;
                top: 0; left: 0; right: 0;
                height: 36px;
                background: #1a1a1a;
                z-index: 2147483646;
                -webkit-app-region: drag;
                pointer-events: none;
            }
        `;
    }
    return '';
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
            const sources = await desktopCapturer.getSources({
                types: [ 'screen', 'window' ],
                thumbnailSize: { width: 320, height: 200 },
                fetchWindowIcons: false
            });

            if (!sources.length) {
                callback(null);
                return;
            }

            const picker = new BrowserWindow({
                parent: window,
                modal: true,
                width: 760,
                height: 560,
                minWidth: 480,
                minHeight: 360,
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
            picker.loadFile(path.resolve(app.getAppPath(), 'picker', 'picker.html'));

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
                if (source) {
                    callback({ video: source });
                } else {
                    callback(null);
                }
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
            callback(null);
        }
    }, { useSystemPicker: true });
}

/**
 * Open (or refresh) the floating always-on-top screen-share toolbar.
 * Loaded from `toolbar/toolbar.html`; state is fed via IPC.
 *
 * Positioned bottom-center of the primary display. Focus is never
 * taken from the shared window (focusable:false + showInactive).
 */
function createToolbarWindow(initialState) {
    if (toolbarWindow && !toolbarWindow.isDestroyed()) {
        toolbarWindow.webContents.send('toolbar:init', initialState || {});
        if (!toolbarWindow.isVisible()) {
            toolbarWindow.showInactive();
        }

        return;
    }

    const TOOLBAR_WIDTH = 420;
    const TOOLBAR_HEIGHT = 84;
    const MARGIN_BOTTOM = 40;

    const { workArea } = screen.getPrimaryDisplay();
    const x = Math.round(workArea.x + ((workArea.width - TOOLBAR_WIDTH) / 2));
    const y = Math.round((workArea.y + workArea.height) - TOOLBAR_HEIGHT - MARGIN_BOTTOM);

    toolbarWindow = new BrowserWindow({
        width: TOOLBAR_WIDTH,
        height: TOOLBAR_HEIGHT,
        x,
        y,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: false,
        acceptFirstMouse: true,
        hasShadow: false,
        show: false,
        title: 'HashMeet Screen Share',
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            sandbox: false,
            backgroundThrottling: false
        }
    });

    toolbarWindow.setAlwaysOnTop(true, 'screen-saver');
    toolbarWindow.setMenuBarVisibility(false);
    if (process.platform === 'darwin') {
        toolbarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    toolbarWindow.loadFile(path.resolve(app.getAppPath(), 'toolbar', 'toolbar.html'));

    toolbarWindow.webContents.once('did-finish-load', () => {
        if (!toolbarWindow || toolbarWindow.isDestroyed()) {
            return;
        }
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

    // Path to root directory.
    const basePath = isDev ? __dirname : app.getAppPath();

    // HashMeet desktop loads the live Laravel webapp directly. The upstream
    // React welcome screen at build/index.html is intentionally bypassed.
    const indexURL = config.default.defaultServerURL;

    // Options used when creating the main HashMeet window.
    const isMac = process.platform === 'darwin';
    const options = {
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
        icon: path.resolve(basePath, './resources/icon.png'),
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
            preload: path.resolve(basePath, './build/preload.js'),
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
    mainWindow.loadURL(indexURL);

    if (isDev) {
        mainWindow.webContents.session.clearCache();
    }

    // Block access to file:// URLs.
    const fileFilter = {
        urls: [ 'file://*' ]
    };

    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(fileFilter, (details, callback) => {
        const requestedPath = path.resolve(URL.fileURLToPath(details.url));
        const appBasePath = path.resolve(basePath);

        if (!requestedPath.startsWith(appBasePath)) {
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

    // Block opening any external applications.
    mainWindow.webContents.session.setPermissionRequestHandler((_, permission, callback, details) => {
        if (permission === 'openExternal') {
            console.warn(`Disallowing opening ${details.externalURL}`);
            callback(false);

            return;
        }

        callback(true);
    });

    initPopupsConfigurationMain(mainWindow, windowOpenHandler);
    setupPictureInPictureMain(mainWindow);
    setupPowerMonitorMain(mainWindow);
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

    const inputURL = fullProtocolCall.replace(appProtocolSurplus, '').replace(/^\/+/, '');
    const target = `${config.default.defaultServerURL}/${inputURL}`;

    if (app.isReady() && mainWindow === null) {
        createJitsiMeetWindow();
    }

    if (mainWindow) {
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
