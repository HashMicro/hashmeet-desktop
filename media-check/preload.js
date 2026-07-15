/* eslint-disable require-jsdoc */

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
    GET_STATUS: 'media-check:get-status',
    OPEN_SETTINGS: 'media-check:open-settings',
    REPORT_DEVICE_ACCESS: 'media-check:report-device-access',
    REQUEST_ACCESS: 'media-check:request-access',
    STATUS_CHANGED: 'media-check:status-changed',
});

const ACCESS_KINDS = new Set(['camera', 'microphone']);

function requireAccessKind(kind) {
    if (!ACCESS_KINDS.has(kind)) {
        throw new TypeError(`Unsupported media permission kind: ${kind}`);
    }

    return kind;
}

contextBridge.exposeInMainWorld(
    'mediaCheckAPI',
    Object.freeze({
        getStatus: () => ipcRenderer.invoke(CHANNELS.GET_STATUS),
        onStatusChanged: (callback) => {
            if (typeof callback !== 'function') {
                throw new TypeError('Status listener must be a function');
            }

            const listener = (_event, status) => callback(status);

            ipcRenderer.on(CHANNELS.STATUS_CHANGED, listener);

            return () => ipcRenderer.removeListener(CHANNELS.STATUS_CHANGED, listener);
        },
        openSystemSettings: (kind) => ipcRenderer.invoke(CHANNELS.OPEN_SETTINGS, requireAccessKind(kind)),
        reportDeviceAccess: (result) => ipcRenderer.invoke(CHANNELS.REPORT_DEVICE_ACCESS, result),
        requestAccess: (kind) => ipcRenderer.invoke(CHANNELS.REQUEST_ACCESS, requireAccessKind(kind)),
    }),
);
