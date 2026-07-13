const { randomUUID } = require('node:crypto');

const TOOLBAR_ACTION_TIMEOUTS = Object.freeze({
    mute: 15_000,
    pause: 15_000,
    stop: 15_000,
    // The wrapper allows 10s to stop and 110s to select a replacement.
    // Keep the transport deadline above both application-level waits.
    switch: 130_000,
});
const TOOLBAR_ACTIONS = Object.freeze(Object.keys(TOOLBAR_ACTION_TIMEOUTS));
const TOOLBAR_ACTION_SET = new Set(TOOLBAR_ACTIONS);

function normalizeError(error, fallback = 'The screen-share command failed.') {
    const value = typeof error === 'string' ? error.trim() : '';

    return (value || fallback).slice(0, 240);
}

function normalizeToolbarResult(result, commandId) {
    if (!result || typeof result !== 'object' || result.commandId !== commandId) {
        return {
            commandId,
            ok: false,
            error: 'The meeting returned an invalid response.',
        };
    }

    const normalized = {
        commandId,
        ok: result.ok === true,
    };

    if (result.state && typeof result.state === 'object' && !Array.isArray(result.state)) {
        normalized.state = result.state;
    }

    if (!normalized.ok) {
        normalized.error = normalizeError(result.error);
    }

    return normalized;
}

function createToolbarCommandBroker({
    sendCommand,
    isToolbarSender,
    isResultSender,
    recordDiagnostic = () => {},
    makeCommandId = randomUUID,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = Date.now,
} = {}) {
    if (typeof sendCommand !== 'function' || typeof isToolbarSender !== 'function' || typeof isResultSender !== 'function') {
        throw new TypeError('Toolbar command broker requires sender validation and command delivery functions.');
    }

    const pending = new Map();

    function diagnose(type, payload = {}) {
        recordDiagnostic(type, payload);
    }

    function settle(commandId, result, diagnosticType) {
        const entry = pending.get(commandId);

        if (!entry) {
            return false;
        }

        pending.delete(commandId);
        clearTimer(entry.timer);
        diagnose(diagnosticType, {
            action: entry.action,
            commandId,
            durationMs: Math.max(0, now() - entry.startedAt),
            ok: result.ok,
            error: result.error,
        });
        entry.resolve(result);

        return true;
    }

    function execute(event, payload = {}) {
        if (!isToolbarSender(event)) {
            diagnose('rejected', { reason: 'untrusted-toolbar-sender' });

            return Promise.resolve({ ok: false, error: 'Untrusted toolbar sender.' });
        }

        const action = typeof payload === 'string' ? payload : payload?.action;

        if (!TOOLBAR_ACTION_SET.has(action)) {
            diagnose('rejected', { action, reason: 'unsupported-action' });

            return Promise.resolve({ ok: false, error: 'Unsupported screen-share command.' });
        }

        const commandId = makeCommandId();
        const startedAt = now();
        const timeoutMs = TOOLBAR_ACTION_TIMEOUTS[action];

        return new Promise((resolve) => {
            const timer = setTimer(() => {
                settle(
                    commandId,
                    {
                        commandId,
                        ok: false,
                        error: action === 'switch' ? 'Source selection timed out.' : 'The meeting did not respond.',
                    },
                    'timed-out',
                );
            }, timeoutMs);

            pending.set(commandId, { action, resolve, startedAt, timer });
            diagnose('sent', { action, commandId, timeoutMs });

            try {
                sendCommand({ commandId, action });
            } catch (error) {
                settle(
                    commandId,
                    {
                        commandId,
                        ok: false,
                        error: normalizeError(error?.message, 'The meeting is unavailable.'),
                    },
                    'delivery-failed',
                );
            }
        });
    }

    function handleResult(event, result) {
        if (!isResultSender(event)) {
            diagnose('result-rejected', { reason: 'untrusted-result-sender' });

            return false;
        }

        const commandId = typeof result?.commandId === 'string' ? result.commandId : '';

        if (!pending.has(commandId)) {
            diagnose('result-rejected', { commandId, reason: 'unknown-command' });

            return false;
        }

        const normalized = normalizeToolbarResult(result, commandId);

        return settle(commandId, normalized, 'completed');
    }

    function cancelAll(error = 'The screen-share toolbar was closed.') {
        for (const commandId of [...pending.keys()]) {
            settle(
                commandId,
                {
                    commandId,
                    ok: false,
                    error: normalizeError(error),
                },
                'cancelled',
            );
        }
    }

    return Object.freeze({
        cancelAll,
        execute,
        getPendingCount: () => pending.size,
        handleResult,
    });
}

module.exports = {
    TOOLBAR_ACTIONS,
    TOOLBAR_ACTION_TIMEOUTS,
    createToolbarCommandBroker,
    normalizeToolbarResult,
};
