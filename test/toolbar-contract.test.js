const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeToolbarCommandResult, normalizeToolbarState } = require('../lib/toolbar-contract');

test('copies only clone-safe toolbar state fields from renderer results', () => {
    const source = new Proxy(
        {
            isMuted: true,
            participantCount: 4,
            sourceName: 'Primary display',
            nested: { unsafe: true },
        },
        {},
    );

    assert.deepEqual(normalizeToolbarState(source), {
        isMuted: true,
        sourceName: 'Primary display',
        participantCount: 4,
    });
});

test('normalizes acknowledged results before sending them over Electron IPC', () => {
    assert.deepEqual(
        normalizeToolbarCommandResult(
            { commandId: 'command-1' },
            {
                ok: true,
                state: { isSharePaused: true, unsupported: () => {} },
            },
        ),
        {
            commandId: 'command-1',
            ok: true,
            state: { isSharePaused: true },
        },
    );
});
