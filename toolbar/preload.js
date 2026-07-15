const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
    const listener = (_event, payload) => callback(payload);

    ipcRenderer.on(channel, listener);

    return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld(
    'toolbarAPI',
    Object.freeze({
        action: (action) => ipcRenderer.invoke('toolbar:execute', { action }),
        onInit: (callback) => subscribe('toolbar:init', callback),
        onState: (callback) => subscribe('toolbar:state', callback),
        recordDiagnostic: (type, payload = {}) =>
            ipcRenderer.send('diagnostics:record', {
                type: `toolbar-${type}`,
                payload,
            }),
        returnFocusToMeeting: () => ipcRenderer.send('toolbar:return-focus'),
    }),
);
