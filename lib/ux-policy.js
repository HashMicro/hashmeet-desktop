function getToolbarWindowBounds(workArea) {
    if (!workArea || ![workArea.x, workArea.y, workArea.width, workArea.height].every(Number.isFinite)) {
        throw new TypeError('A finite display work area is required');
    }

    const width = Math.max(1, Math.min(680, Math.max(320, workArea.width - 24), workArea.width));
    const height = Math.max(1, Math.min(104, workArea.height));
    const marginBottom = Math.min(40, Math.max(12, Math.floor(workArea.height * 0.05)));
    const x = Math.round(workArea.x + Math.max(12, (workArea.width - width) / 2));
    const y = Math.round(workArea.y + Math.max(12, workArea.height - height - marginBottom));

    return {
        width,
        height,
        x: Math.min(x, workArea.x + workArea.width - width),
        y: Math.min(y, workArea.y + workArea.height - height),
    };
}

function classifyDeviceAccessResult(result = {}) {
    if (result.granted === true) {
        return 'allowed';
    }

    return ['NotAllowedError', 'SecurityError'].includes(result.errorName) ? 'blocked' : 'unavailable';
}

function getMediaPermissionTargets(permission, details = {}) {
    if (permission !== 'media' || !Array.isArray(details.mediaTypes)) {
        return [];
    }

    const targets = [];

    if (details.mediaTypes.includes('video')) {
        targets.push('camera');
    }
    if (details.mediaTypes.includes('audio')) {
        targets.push('microphone');
    }

    return targets;
}

module.exports = {
    classifyDeviceAccessResult,
    getMediaPermissionTargets,
    getToolbarWindowBounds,
};
