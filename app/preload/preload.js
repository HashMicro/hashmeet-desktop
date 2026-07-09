const {
    initPopupsConfigurationRender,
    setupScreenSharingRender,
    setupPictureInPictureRender,
    setupRemoteControlRender,
    setupPowerMonitorRender
} = require('@jitsi/electron-sdk');
const { ipcRenderer } = require('electron');

const whitelistedSendChannels = [
    'renderer-ready',
    'restore-meeting-window',
    'toolbar:open',
    'toolbar:close',
    'toolbar:state',
    'diagnostics:record'
];

const whitelistedReceiveChannels = [
    'protocol-data-msg',
    'toolbar:action',
    'desktop:screen-source-selected'
];

const whitelistedInvokeChannels = [
    'desktop:get-info',
    'permissions:get-status',
    'diagnostics:copy'
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

window.jitsiNodeAPI = {
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
        }
    },
    toolbar: {
        open: snapshot => ipcRenderer.send('toolbar:open', snapshot || {}),
        close: () => ipcRenderer.send('toolbar:close'),
        sendState: patch => ipcRenderer.send('toolbar:state', patch || {}),
        onAction: cb => {
            const handler = (_event, payload) => cb(payload);

            ipcRenderer.addListener('toolbar:action', handler);

            return () => ipcRenderer.removeListener('toolbar:action', handler);
        }
    },
    desktop: {
        getInfo: () => ipcRenderer.invoke('desktop:get-info')
    },
    permissions: {
        getStatus: () => ipcRenderer.invoke('permissions:get-status')
    },
    diagnostics: {
        record: (type, payload) => {
            ipcRenderer.send('diagnostics:record', {
                type,
                payload: payload || {}
            });
        },
        copy: () => ipcRenderer.invoke('diagnostics:copy')
    },
    screenShare: {
        onSourceSelected: cb => {
            const handler = (_event, payload) => cb(payload);

            ipcRenderer.addListener('desktop:screen-source-selected', handler);

            return () => ipcRenderer.removeListener('desktop:screen-source-selected', handler);
        }
    }
};
