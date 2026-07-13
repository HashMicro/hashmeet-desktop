const {
    initPopupsConfigurationRender,
    setupScreenSharingRender,
    setupPictureInPictureRender,
    setupRemoteControlRender,
    setupPowerMonitorRender,
} = require('@jitsi/electron-sdk');
const { ipcRenderer } = require('electron');

const { normalizeToolbarCommandResult } = require('../../lib/toolbar-contract');

const whitelistedSendChannels = [
    'restore-meeting-window',
    'toolbar:open',
    'toolbar:close',
    'toolbar:state',
    'toolbar:result',
    'call:set-state',
    'app:retry',
    'diagnostics:record',
];

const whitelistedReceiveChannels = ['toolbar:action', 'desktop:screen-source-selected', 'media:status-changed'];

const whitelistedInvokeChannels = [
    'desktop:get-info',
    'permissions:get-status',
    'media:get-status',
    'media:request-access',
    'media:open-settings',
    'app:copy-diagnostics',
    'diagnostics:copy',
];

ipcRenderer.setMaxListeners(0);

/**
 * Open an external URL.
 *
 * @param {string} url - The URL we with to open.
 * @returns {void}
 */
function openExternalLink(url) {
    ipcRenderer.send('jitsi-open-url', url);
}

/**
 * Setup the renderer process.
 *
 * @param {*} api - API object.
 * @param {*} options - Options for what to enable.
 * @returns {void}
 */
function setupRenderer(api, options = {}) {
    initPopupsConfigurationRender(api);

    setupScreenSharingRender(api);

    if (options.enableRemoteControl) {
        setupRemoteControlRender(api);
    }

    if (options.enableAlwaysOnTopWindow) {
        setupPictureInPictureRender(api);
    }

    setupPowerMonitorRender(api);
}

function subscribeToolbarCommands(callback) {
    const handler = async (_event, command) => {
        if (!command || typeof command.commandId !== 'string' || typeof command.action !== 'string') {
            return;
        }

        let result;

        try {
            result = normalizeToolbarCommandResult(command, await callback(command));
        } catch (error) {
            result = {
                commandId: command.commandId,
                ok: false,
                error: String(error?.message || 'The screen-share command failed.'),
            };
        }

        ipcRenderer.send('toolbar:result', result);
    };

    ipcRenderer.addListener('toolbar:action', handler);

    return () => ipcRenderer.removeListener('toolbar:action', handler);
}

window.jitsiNodeAPI = {
    bridgeVersion: 3,
    openExternalLink,
    setupRenderer,
    ipc: {
        addListener: (channel, listener) => {
            if (!whitelistedReceiveChannels.includes(channel)) {
                return;
            }

            const cb = (_event, ...args) => {
                listener(...args);
            };

            const remove = () => {
                ipcRenderer.removeListener(channel, cb);
            };

            ipcRenderer.addListener(channel, cb);

            return remove;
        },
        invoke: (channel, data) => {
            if (!whitelistedInvokeChannels.includes(channel)) {
                return Promise.resolve(null);
            }

            if (data === undefined) {
                return ipcRenderer.invoke(channel);
            }

            return ipcRenderer.invoke(channel, data);
        },
        send: (channel, data) => {
            if (!whitelistedSendChannels.includes(channel)) {
                return;
            }

            if (data === undefined) {
                ipcRenderer.send(channel);
            } else {
                ipcRenderer.send(channel, data);
            }
        },
    },
    toolbar: {
        open: (snapshot) => ipcRenderer.send('toolbar:open', snapshot || {}),
        close: () => ipcRenderer.send('toolbar:close'),
        sendState: (patch) => ipcRenderer.send('toolbar:state', patch || {}),
        onCommand: (cb) => subscribeToolbarCommands(cb),
        // Compatibility alias for meeting pages built against bridge version 2.
        onAction: (cb) => subscribeToolbarCommands(cb),
    },
    desktop: {
        getInfo: () => ipcRenderer.invoke('desktop:get-info'),
    },
    permissions: {
        getStatus: () => ipcRenderer.invoke('permissions:get-status'),
    },
    media: {
        getStatus: () => ipcRenderer.invoke('media:get-status'),
        requestAccess: (kind) => ipcRenderer.invoke('media:request-access', kind),
        openSystemSettings: (kind) => ipcRenderer.invoke('media:open-settings', kind),
        onStatusChanged: (cb) => {
            const handler = (_event, status) => cb(status);

            ipcRenderer.addListener('media:status-changed', handler);

            return () => ipcRenderer.removeListener('media:status-changed', handler);
        },
    },
    diagnostics: {
        record: (type, payload) => {
            ipcRenderer.send('diagnostics:record', {
                type,
                payload: payload || {},
            });
        },
        copy: () => ipcRenderer.invoke('diagnostics:copy'),
    },
    screenShare: {
        getCapabilities: () => ipcRenderer.invoke('media:get-status').then((status) => status?.screenShare || null),
        onSourceSelected: (cb) => {
            const handler = (_event, payload) => cb(payload);

            ipcRenderer.addListener('desktop:screen-source-selected', handler);

            return () => ipcRenderer.removeListener('desktop:screen-source-selected', handler);
        },
    },
    call: {
        setState: (state) => ipcRenderer.send('call:set-state', state || {}),
    },
    offline: {
        retry: () => ipcRenderer.send('app:retry'),
        copyDiagnostics: () => ipcRenderer.invoke('app:copy-diagnostics'),
    },
};
