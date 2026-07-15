/* eslint-disable require-jsdoc */

const api = window.mediaCheckAPI;
const elements = Object.freeze({
    cameraPermission: document.getElementById('camera-permission'),
    cameraRequest: document.querySelector('[data-request="camera"]'),
    cameraSettings: document.querySelector('[data-settings="camera"]'),
    cameraPlaceholder: document.getElementById('camera-placeholder'),
    cameraPreview: document.getElementById('camera-preview'),
    cameraSelect: document.getElementById('camera-select'),
    cameraState: document.getElementById('camera-state'),
    meter: document.getElementById('microphone-meter'),
    meterValue: document.getElementById('meter-value'),
    microphonePermission: document.getElementById('microphone-permission'),
    microphoneRequest: document.querySelector('[data-request="microphone"]'),
    microphoneSettings: document.querySelector('[data-settings="microphone"]'),
    microphoneSelect: document.getElementById('microphone-select'),
    microphoneState: document.getElementById('microphone-state'),
    notice: document.getElementById('notice'),
    platformDetail: document.getElementById('platform-detail'),
    recordMicrophone: document.getElementById('record-microphone'),
    recordingPlayback: document.getElementById('recording-playback'),
    speakerSelect: document.getElementById('speaker-select'),
    speakerState: document.getElementById('speaker-state'),
    startCamera: document.getElementById('start-camera'),
    startMicrophone: document.getElementById('start-microphone'),
    testSpeaker: document.getElementById('test-speaker'),
});

let cameraStream;
let microphoneStream;
let meterAnimation;
let meterAudioContext;
let recordingUrl;
let statusUnsubscribe;

function setStatus(element, text, tone = 'neutral') {
    element.textContent = text;
    element.className = `status ${tone}`;
}

function showNotice(message) {
    elements.notice.textContent = message;
    elements.notice.hidden = !message;
}

function describeError(error) {
    if (error && error.name === 'NotAllowedError') {
        return 'Access was denied. Allow this device in system settings and try again.';
    }

    if (error && error.name === 'NotFoundError') {
        return 'No matching device is available.';
    }

    if (error && error.name === 'NotReadableError') {
        return 'The device is already in use or could not be started.';
    }

    return error && error.message ? error.message : 'The media check could not be completed.';
}

function stopStream(stream) {
    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
    }
}

function populateSelect(select, devices, fallbackLabel) {
    const previous = select.value;

    select.replaceChildren();

    if (!devices.length) {
        const option = new Option(`No ${fallbackLabel.toLowerCase()} found`, '');

        option.disabled = true;
        select.add(option);
        select.disabled = true;

        return;
    }

    devices.forEach((device, index) => {
        select.add(new Option(device.label || `${fallbackLabel} ${index + 1}`, device.deviceId));
    });
    select.disabled = false;

    if ([...select.options].some((option) => option.value === previous)) {
        select.value = previous;
    }
}

async function refreshDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();

        populateSelect(
            elements.microphoneSelect,
            devices.filter((device) => device.kind === 'audioinput'),
            'Microphone',
        );
        populateSelect(
            elements.speakerSelect,
            devices.filter((device) => device.kind === 'audiooutput'),
            'Speaker',
        );
        populateSelect(
            elements.cameraSelect,
            devices.filter((device) => device.kind === 'videoinput'),
            'Camera',
        );
    } catch (error) {
        showNotice(describeError(error));
    }
}

function permissionTone(value) {
    if (['granted', 'authorized', 'allowed'].includes(value)) {
        return 'success';
    }

    if (['denied', 'restricted', 'blocked'].includes(value)) {
        return 'danger';
    }

    return 'warning';
}

function isGrantedPermission(value) {
    return ['granted', 'authorized', 'allowed'].includes(value);
}

function renderPermissionActions(kind, value, systemSettings = {}) {
    const requestButton = elements[`${kind}Request`];
    const settingsButton = elements[`${kind}Settings`];
    const granted = isGrantedPermission(value);
    const denied = ['denied', 'restricted', 'blocked'].includes(value);

    requestButton.hidden = granted;
    requestButton.disabled = granted;
    requestButton.textContent = denied ? 'Try again' : 'Allow';
    settingsButton.hidden = systemSettings[kind] !== true || granted || !denied;
}

function renderNativeStatus(status = {}) {
    const safeStatus = status && typeof status === 'object' ? status : {};
    const permissions = safeStatus.permissions || safeStatus;
    const microphone = String(permissions.microphone || 'unknown').toLowerCase();
    const camera = String(permissions.camera || 'unknown').toLowerCase();

    setStatus(elements.microphonePermission, microphone, permissionTone(microphone));
    setStatus(elements.cameraPermission, camera, permissionTone(camera));
    renderPermissionActions('microphone', microphone, safeStatus.systemSettings || {});
    renderPermissionActions('camera', camera, safeStatus.systemSettings || {});
    const environment = [safeStatus.platform, safeStatus.sessionType].filter(Boolean).join(' / ');

    elements.platformDetail.textContent =
        safeStatus.detail || safeStatus.message || (environment ? `Environment: ${environment}` : '');
}

async function refreshStatus() {
    if (!api) {
        setStatus(elements.microphonePermission, 'Unavailable', 'warning');
        setStatus(elements.cameraPermission, 'Unavailable', 'warning');
        elements.platformDetail.textContent = 'Native permission status is unavailable.';

        return;
    }

    try {
        renderNativeStatus(await api.getStatus());
    } catch (error) {
        elements.platformDetail.textContent = describeError(error);
    }
}

function stopMicrophone() {
    cancelAnimationFrame(meterAnimation);
    meterAnimation = undefined;
    stopStream(microphoneStream);
    microphoneStream = undefined;

    if (meterAudioContext) {
        meterAudioContext.close();
        meterAudioContext = undefined;
    }

    elements.meter.value = 0;
    elements.meterValue.textContent = '0%';
    elements.recordMicrophone.disabled = true;
    elements.startMicrophone.textContent = 'Start microphone';
    setStatus(elements.microphoneState, 'Idle');
}

async function startMicrophone() {
    if (microphoneStream) {
        stopMicrophone();

        return;
    }

    try {
        showNotice('');
        microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: elements.microphoneSelect.value ? { exact: elements.microphoneSelect.value } : undefined,
            },
            video: false,
        });

        meterAudioContext = new AudioContext();
        const analyser = meterAudioContext.createAnalyser();
        const source = meterAudioContext.createMediaStreamSource(microphoneStream);
        const samples = new Uint8Array(analyser.fftSize);

        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);

        const updateMeter = () => {
            analyser.getByteTimeDomainData(samples);
            const sum = samples.reduce((total, sample) => {
                const normalized = (sample - 128) / 128;

                return total + normalized * normalized;
            }, 0);
            const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);

            elements.meter.value = level;
            elements.meterValue.textContent = `${Math.round(level * 100)}%`;
            elements.meter.setAttribute('aria-valuetext', `${Math.round(level * 100)} percent`);
            meterAnimation = requestAnimationFrame(updateMeter);
        };

        updateMeter();
        elements.recordMicrophone.disabled = !window.MediaRecorder;
        elements.startMicrophone.textContent = 'Stop microphone';
        setStatus(elements.microphoneState, 'Active', 'success');
        microphoneStream.getAudioTracks()[0].addEventListener('ended', stopMicrophone, { once: true });
        await refreshDevices();
        await refreshStatus();
    } catch (error) {
        stopMicrophone();
        setStatus(elements.microphoneState, 'Failed', 'danger');
        showNotice(describeError(error));
    }
}

async function setOutputDevice(audioElement) {
    if (typeof audioElement.setSinkId === 'function' && elements.speakerSelect.value) {
        await audioElement.setSinkId(elements.speakerSelect.value);
    }
}

function recordMicrophone() {
    if (!microphoneStream || !window.MediaRecorder) {
        return;
    }

    const chunks = [];
    const recorder = new MediaRecorder(microphoneStream);

    elements.recordMicrophone.disabled = true;
    elements.recordMicrophone.textContent = 'Recording...';
    setStatus(elements.microphoneState, 'Recording', 'warning');

    recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) {
            chunks.push(event.data);
        }
    });
    recorder.addEventListener(
        'stop',
        async () => {
            if (recordingUrl) {
                URL.revokeObjectURL(recordingUrl);
            }

            recordingUrl = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
            elements.recordingPlayback.src = recordingUrl;
            elements.recordingPlayback.hidden = false;
            elements.recordMicrophone.disabled = false;
            elements.recordMicrophone.textContent = 'Record 5 seconds';
            setStatus(elements.microphoneState, 'Active', 'success');

            try {
                await setOutputDevice(elements.recordingPlayback);
            } catch (error) {
                showNotice(`The recording is ready, but output selection failed: ${describeError(error)}`);
            }
        },
        { once: true },
    );

    recorder.start();
    setTimeout(() => {
        if (recorder.state === 'recording') {
            recorder.stop();
        }
    }, 5000);
}

async function testSpeaker() {
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const audio = new Audio();

    elements.testSpeaker.disabled = true;
    setStatus(elements.speakerState, 'Playing', 'success');

    try {
        audio.srcObject = destination.stream;
        await setOutputDevice(audio);
        oscillator.type = 'sine';
        oscillator.frequency.value = 440;
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.04);
        gain.gain.setValueAtTime(0.16, context.currentTime + 0.7);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.85);
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.9);
        await audio.play();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setStatus(elements.speakerState, 'Complete', 'success');
    } catch (error) {
        setStatus(elements.speakerState, 'Failed', 'danger');
        showNotice(describeError(error));
    } finally {
        audio.pause();
        stopStream(destination.stream);
        await context.close();
        elements.testSpeaker.disabled = false;
    }
}

function stopCamera() {
    stopStream(cameraStream);
    cameraStream = undefined;
    elements.cameraPreview.srcObject = null;
    elements.cameraPlaceholder.hidden = false;
    elements.startCamera.textContent = 'Start camera';
    setStatus(elements.cameraState, 'Idle');
}

async function startCamera() {
    if (cameraStream) {
        stopCamera();

        return;
    }

    try {
        showNotice('');
        cameraStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                deviceId: elements.cameraSelect.value ? { exact: elements.cameraSelect.value } : undefined,
                height: { ideal: 720 },
                width: { ideal: 1280 },
            },
        });
        elements.cameraPreview.srcObject = cameraStream;
        elements.cameraPlaceholder.hidden = true;
        elements.startCamera.textContent = 'Stop camera';
        setStatus(elements.cameraState, 'Active', 'success');
        cameraStream.getVideoTracks()[0].addEventListener('ended', stopCamera, { once: true });
        await refreshDevices();
        await refreshStatus();
    } catch (error) {
        stopCamera();
        setStatus(elements.cameraState, 'Failed', 'danger');
        showNotice(describeError(error));
    }
}

async function requestAccess(kind, button) {
    if (!api) {
        showNotice('Native permission controls are unavailable.');

        return;
    }

    button.disabled = true;
    try {
        const result = await api.requestAccess(kind);

        if (result?.requiresDeviceRequest) {
            let stream;

            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: kind === 'microphone',
                    video: kind === 'camera',
                });
                stopStream(stream);
                await api.reportDeviceAccess({ kind, granted: true });
                showNotice(`${kind === 'camera' ? 'Camera' : 'Microphone'} access is available.`);
            } catch (error) {
                await api.reportDeviceAccess({
                    kind,
                    granted: false,
                    errorName: error?.name || 'Error',
                });
                throw error;
            }
        } else if (result && result.granted === false) {
            showNotice(`${kind === 'camera' ? 'Camera' : 'Microphone'} access was not granted.`);
        }
        await refreshStatus();
        await refreshDevices();
    } catch (error) {
        showNotice(describeError(error));
    } finally {
        button.disabled = false;
    }
}

async function openSettings(kind) {
    if (!api) {
        showNotice('Native settings controls are unavailable.');

        return;
    }

    try {
        const result = await api.openSystemSettings(kind);

        if (result && result.ok === false) {
            showNotice('This system does not provide a direct link to that privacy setting.');
        }
    } catch (error) {
        showNotice(describeError(error));
    }
}

document.getElementById('refresh').addEventListener('click', async () => {
    showNotice('');
    await Promise.all([refreshDevices(), refreshStatus()]);
});
elements.startMicrophone.addEventListener('click', startMicrophone);
elements.recordMicrophone.addEventListener('click', recordMicrophone);
elements.testSpeaker.addEventListener('click', testSpeaker);
elements.startCamera.addEventListener('click', startCamera);
elements.microphoneSelect.addEventListener('change', () => {
    if (microphoneStream) {
        stopMicrophone();
        startMicrophone();
    }
});
elements.cameraSelect.addEventListener('change', () => {
    if (cameraStream) {
        stopCamera();
        startCamera();
    }
});
elements.speakerSelect.addEventListener('change', async () => {
    if (!elements.recordingPlayback.hidden) {
        try {
            await setOutputDevice(elements.recordingPlayback);
        } catch (error) {
            showNotice(describeError(error));
        }
    }
});
document.querySelectorAll('[data-request]').forEach((button) => {
    button.addEventListener('click', () => requestAccess(button.dataset.request, button));
});
document.querySelectorAll('[data-settings]').forEach((button) => {
    button.addEventListener('click', () => openSettings(button.dataset.settings));
});

navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
window.addEventListener('beforeunload', () => {
    stopMicrophone();
    stopCamera();
    statusUnsubscribe?.();

    if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl);
    }
});

if (api) {
    statusUnsubscribe = api.onStatusChanged(renderNativeStatus);
}

Promise.all([refreshDevices(), refreshStatus()]);
