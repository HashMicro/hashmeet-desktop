const assert = require('node:assert/strict');
const test = require('node:test');

const {
    TOOLBAR_ACTION_TIMEOUTS,
    createToolbarCommandBroker,
    normalizeToolbarResult,
} = require('../lib/toolbar-command-broker');

function createHarness() {
    const commands = [];
    const diagnostics = [];
    const timers = new Map();
    let nextTimer = 1;
    let clock = 100;

    const broker = createToolbarCommandBroker({
        sendCommand: (command) => commands.push(command),
        isToolbarSender: (event) => event?.sender === 'toolbar',
        isResultSender: (event) => event?.sender === 'meeting',
        recordDiagnostic: (type, payload) => diagnostics.push({ type, payload }),
        makeCommandId: () => `command-${commands.length + 1}`,
        setTimer: (callback, delay) => {
            const id = nextTimer++;

            timers.set(id, { callback, delay });

            return id;
        },
        clearTimer: (id) => timers.delete(id),
        now: () => clock,
    });

    return {
        advance: (duration) => {
            clock += duration;
        },
        broker,
        commands,
        diagnostics,
        fireTimer: () => {
            const [id, timer] = timers.entries().next().value;

            timers.delete(id);
            timer.callback();

            return timer;
        },
        timers,
    };
}

test('forwards allowed actions with generated command IDs and action-specific timeouts', async () => {
    const harness = createHarness();
    const resultPromise = harness.broker.execute({ sender: 'toolbar' }, { action: 'switch' });

    assert.deepEqual(harness.commands, [{ commandId: 'command-1', action: 'switch' }]);
    assert.equal([...harness.timers.values()][0].delay, TOOLBAR_ACTION_TIMEOUTS.switch);

    harness.advance(25);
    assert.equal(
        harness.broker.handleResult(
            { sender: 'meeting' },
            { commandId: 'command-1', ok: true, state: { sourceName: 'Window' } },
        ),
        true,
    );
    assert.deepEqual(await resultPromise, {
        commandId: 'command-1',
        ok: true,
        state: { sourceName: 'Window' },
    });
    assert.equal(harness.broker.getPendingCount(), 0);
    assert.equal(harness.diagnostics.at(-1).type, 'completed');
});

test('rejects untrusted senders and unsupported actions without forwarding', async () => {
    const harness = createHarness();

    assert.deepEqual(await harness.broker.execute({ sender: 'other' }, { action: 'stop' }), {
        ok: false,
        error: 'Untrusted toolbar sender.',
    });
    assert.deepEqual(await harness.broker.execute({ sender: 'toolbar' }, { action: 'delete' }), {
        ok: false,
        error: 'Unsupported screen-share command.',
    });
    assert.deepEqual(harness.commands, []);
});

test('accepts results only from the trusted meeting renderer', async () => {
    const harness = createHarness();
    const resultPromise = harness.broker.execute({ sender: 'toolbar' }, 'mute');

    assert.equal(
        harness.broker.handleResult({ sender: 'other' }, { commandId: 'command-1', ok: true }),
        false,
    );
    assert.equal(harness.broker.getPendingCount(), 1);
    assert.equal(
        harness.broker.handleResult({ sender: 'meeting' }, { commandId: 'command-1', ok: true }),
        true,
    );
    assert.deepEqual(await resultPromise, { commandId: 'command-1', ok: true });
});

test('times out commands and ignores late responses', async () => {
    const harness = createHarness();
    const resultPromise = harness.broker.execute({ sender: 'toolbar' }, { action: 'pause' });
    const timer = harness.fireTimer();

    assert.equal(timer.delay, TOOLBAR_ACTION_TIMEOUTS.pause);
    assert.deepEqual(await resultPromise, {
        commandId: 'command-1',
        ok: false,
        error: 'The meeting did not respond.',
    });
    assert.equal(
        harness.broker.handleResult({ sender: 'meeting' }, { commandId: 'command-1', ok: true }),
        false,
    );
});

test('cancels every pending command during toolbar cleanup', async () => {
    const harness = createHarness();
    const first = harness.broker.execute({ sender: 'toolbar' }, { action: 'mute' });
    const second = harness.broker.execute({ sender: 'toolbar' }, { action: 'stop' });

    harness.broker.cancelAll('Meeting navigation started.');

    assert.equal(harness.broker.getPendingCount(), 0);
    assert.equal(harness.timers.size, 0);
    assert.equal((await first).error, 'Meeting navigation started.');
    assert.equal((await second).error, 'Meeting navigation started.');
});

test('normalizes malformed and failed meeting responses', () => {
    assert.deepEqual(normalizeToolbarResult(null, 'command-1'), {
        commandId: 'command-1',
        ok: false,
        error: 'The meeting returned an invalid response.',
    });
    assert.deepEqual(normalizeToolbarResult({ commandId: 'command-1', ok: false, error: '' }, 'command-1'), {
        commandId: 'command-1',
        ok: false,
        error: 'The screen-share command failed.',
    });
});

test('reports delivery failures and clears the pending entry', async () => {
    const diagnostics = [];
    const broker = createToolbarCommandBroker({
        sendCommand: () => {
            throw new Error('Meeting renderer unavailable');
        },
        isToolbarSender: () => true,
        isResultSender: () => true,
        recordDiagnostic: (type, payload) => diagnostics.push({ type, payload }),
        makeCommandId: () => 'failed-command',
    });

    assert.deepEqual(await broker.execute({}, { action: 'stop' }), {
        commandId: 'failed-command',
        ok: false,
        error: 'Meeting renderer unavailable',
    });
    assert.equal(broker.getPendingCount(), 0);
    assert.equal(diagnostics.at(-1).type, 'delivery-failed');
});
