const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
    'pickerAPI',
    Object.freeze({
        platform: process.platform,
        onError: (callback) => {
            const listener = (_event, payload) => callback(payload);

            ipcRenderer.on('sources:error', listener);

            return () => ipcRenderer.removeListener('sources:error', listener);
        },
        onSources: (callback) => {
            const listener = (_event, payload) => callback(payload);

            ipcRenderer.on('sources', listener);

            return () => ipcRenderer.removeListener('sources', listener);
        },
        refresh: () => ipcRenderer.send('picker:refresh'),
        select: (selection) => ipcRenderer.send('picker:select', selection),
    }),
);
