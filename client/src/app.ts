// PeptidiHR Video Brander — Client Application Logic

interface ProcessOptions {
  logoPosition: 'BR' | 'BL' | 'TR' | 'TL';
  logoSize: number;
  logoOpacity: number;
  overlayText: string;
  textColor: string;
  fontSize: number;
  pitchShift: number;
  speed: number;
  brightness: number;
  contrast: number;
  saturation: number;
  addGrain: boolean;
  addVignette: boolean;
  addFlip: boolean;
  addOutro: boolean;
  outroText: string;
}

interface UploadedFiles {
  fileId: string;
  videoName: string;
  logoPath?: string;
  outroImagePath?: string;
}

let uploadedFileId: string | null = null;
let currentJobId: string | null = null;
let sseSource: EventSource | null = null;

// ──────────────────────────────────────────
// DOM helpers
// ──────────────────────────────────────────
function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

function $input(id: string): HTMLInputElement {
  return $ (id) as HTMLInputElement;
}

function $select(id: string): HTMLSelectElement {
  return $(id) as HTMLSelectElement;
}

function showAlert(message: string, type: 'error' | 'success' = 'error'): void {
  const alertEl = $('alert-box');
  alertEl.textContent = message;
  alertEl.className = `fixed top-4 right-4 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg ${
    type === 'error'
      ? 'bg-red-900 border border-red-500 text-red-200'
      : 'bg-green-900 border border-green-500 text-green-200'
  }`;
  alertEl.classList.remove('hidden');
  setTimeout(() => alertEl.classList.add('hidden'), 5000);
}

function setStatus(message: string): void {
  $('status-text').textContent = message;
}

function setProgress(pct: number): void {
  const bar = $('progress-bar') as HTMLDivElement;
  bar.style.width = `${pct}%`;
  $('progress-pct').textContent = `${pct}%`;
}

function setProcessing(processing: boolean): void {
  ($('brand-btn') as HTMLButtonElement).disabled = processing;
  ($('brand-btn') as HTMLButtonElement).textContent = processing
    ? 'Procesiranje...'
    : 'Brand It!';
}

// ──────────────────────────────────────────
// Drag & Drop
// ──────────────────────────────────────────
function setupDropZone(
  zoneId: string,
  inputId: string,
  labelId: string,
  accept: string
): void {
  const zone = $(zoneId);
  const input = $input(inputId);

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const dt = (e as DragEvent).dataTransfer;
    if (dt?.files?.[0]) {
      const file = dt.files[0];
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
    }
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) {
      $(labelId).textContent = file.name;
      $(labelId).classList.add('text-green-400');
    }
  });
}

// ──────────────────────────────────────────
// Slider live value display
// ──────────────────────────────────────────
function bindSlider(sliderId: string, displayId: string, transform?: (v: number) => string): void {
  const slider = $input(sliderId);
  const display = $(displayId);

  const update = () => {
    const val = parseFloat(slider.value);
    display.textContent = transform ? transform(val) : val.toString();
  };

  slider.addEventListener('input', update);
  update();
}

// ──────────────────────────────────────────
// Get current options from form
// ──────────────────────────────────────────
function getOptions(): ProcessOptions {
  return {
    logoPosition: $select('logo-position').value as ProcessOptions['logoPosition'],
    logoSize: parseInt($input('logo-size').value, 10),
    logoOpacity: parseFloat($input('logo-opacity').value),
    overlayText: $input('overlay-text').value,
    textColor: $input('text-color').value.replace('#', ''),
    fontSize: parseInt($input('font-size').value, 10),
    pitchShift: parseFloat($input('pitch-shift').value),
    speed: parseFloat($input('speed').value),
    brightness: parseFloat($input('brightness').value),
    contrast: parseFloat($input('contrast').value),
    saturation: parseFloat($input('saturation').value),
    addGrain: $input('add-grain').checked,
    addVignette: $input('add-vignette').checked,
    addFlip: $input('add-flip').checked,
    addOutro: $input('add-outro').checked,
    outroText: $input('outro-text').value,
  };
}

// ──────────────────────────────────────────
// Upload files
// ──────────────────────────────────────────
async function uploadFiles(): Promise<string> {
  const videoInput = $input('video-input');
  const logoInput = $input('logo-input');
  const outroImageInput = $input('outro-image-input');

  if (!videoInput.files?.[0]) {
    throw new Error('Molim odaberi video datoteku.');
  }

  const formData = new FormData();
  formData.append('video', videoInput.files[0]);
  if (logoInput.files?.[0]) formData.append('logo', logoInput.files[0]);
  if (outroImageInput.files?.[0]) formData.append('outroImage', outroImageInput.files[0]);

  setStatus('Uploading...');
  setProgress(0);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json() as { error: string };
    throw new Error(err.error || 'Upload failed');
  }

  const { fileId } = await response.json() as { fileId: string };
  return fileId;
}

// ──────────────────────────────────────────
// Start processing
// ──────────────────────────────────────────
async function startProcessing(fileId: string, options: ProcessOptions): Promise<string> {
  setStatus('Pokrećem FFmpeg obradu...');

  const response = await fetch('/api/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, options }),
  });

  if (!response.ok) {
    const err = await response.json() as { error: string };
    throw new Error(err.error || 'Process start failed');
  }

  const { jobId } = await response.json() as { jobId: string };
  return jobId;
}

// ──────────────────────────────────────────
// SSE Progress
// ──────────────────────────────────────────
function watchProgress(jobId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (sseSource) {
      sseSource.close();
    }

    sseSource = new EventSource(`/api/progress/${jobId}`);

    sseSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as {
          progress?: number;
          done?: boolean;
          error?: string;
        };

        if (data.error) {
          sseSource?.close();
          reject(new Error(data.error));
          return;
        }

        if (data.progress != null) {
          setProgress(data.progress);
          const phase =
            data.progress < 30
              ? 'Skaliranje i korekcija boja...'
              : data.progress < 60
                ? 'Audio obrada i pitch shift...'
                : data.progress < 90
                  ? 'Primjena efekata i logotipa...'
                  : 'Finalizacija videa...';
          setStatus(phase);
        }

        if (data.done) {
          sseSource?.close();
          resolve();
        }
      } catch {
        // ignore parse errors
      }
    };

    sseSource.onerror = () => {
      sseSource?.close();
      reject(new Error('SSE connection error'));
    };
  });
}

// ──────────────────────────────────────────
// Download
// ──────────────────────────────────────────
function downloadVideo(jobId: string): void {
  const link = document.createElement('a');
  link.href = `/api/download/${jobId}`;
  link.download = `peptidhr_branded_${Date.now()}.mp4`;
  link.click();
}

// ──────────────────────────────────────────
// Transcription
// ──────────────────────────────────────────
async function runTranscription(): Promise<void> {
  if (!uploadedFileId) {
    showAlert('Prvo uploaj video.');
    return;
  }

  setStatus('Transkribiram video...');
  ($('transcribe-btn') as HTMLButtonElement).disabled = true;

  try {
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: uploadedFileId }),
    });

    const result = await response.json() as { text: string; words: unknown[] };
    $('transcript-output').textContent = result.text;
    $('transcript-box').classList.remove('hidden');
    setStatus('Transkripcija završena.');
  } catch (err) {
    showAlert(err instanceof Error ? err.message : 'Greška pri transkripciji.');
  } finally {
    ($('transcribe-btn') as HTMLButtonElement).disabled = false;
  }
}

// ──────────────────────────────────────────
// Main brand flow
// ──────────────────────────────────────────
async function onBrandClick(): Promise<void> {
  setProcessing(true);
  $('progress-section').classList.remove('hidden');
  $('download-section').classList.add('hidden');

  try {
    const fileId = await uploadFiles();
    uploadedFileId = fileId;

    const options = getOptions();
    const jobId = await startProcessing(fileId, options);
    currentJobId = jobId;

    await watchProgress(jobId);

    setProgress(100);
    setStatus('Video uspješno obrađen!');
    showAlert('Video je spreman za preuzimanje!', 'success');

    $('download-section').classList.remove('hidden');
    ($('download-btn') as HTMLButtonElement).onclick = () => downloadVideo(jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Nepoznata greška';
    showAlert(message);
    setStatus(`Greška: ${message}`);
  } finally {
    setProcessing(false);
  }
}

// ──────────────────────────────────────────
// Initialise
// ──────────────────────────────────────────
export function initApp(): void {
  setupDropZone('video-drop-zone', 'video-input', 'video-label', 'video/*');
  setupDropZone('logo-drop-zone', 'logo-input', 'logo-label', 'image/*');
  setupDropZone('outro-image-drop-zone', 'outro-image-input', 'outro-image-label', 'image/*');

  bindSlider('pitch-shift', 'pitch-shift-val', (v) => (v >= 0 ? `+${v}` : `${v}`) + '%');
  bindSlider('speed', 'speed-val', (v) => v.toFixed(2) + 'x');
  bindSlider('brightness', 'brightness-val', (v) => v.toFixed(2));
  bindSlider('contrast', 'contrast-val', (v) => v.toFixed(2));
  bindSlider('saturation', 'saturation-val', (v) => v.toFixed(2));
  bindSlider('logo-size', 'logo-size-val', (v) => v + 'px');
  bindSlider('logo-opacity', 'logo-opacity-val', (v) => Math.round(v * 100) + '%');
  bindSlider('font-size', 'font-size-val', (v) => v + 'px');

  $('brand-btn').addEventListener('click', onBrandClick);
  $('transcribe-btn').addEventListener('click', runTranscription);

  // Toggle outro options visibility
  $input('add-outro').addEventListener('change', () => {
    const visible = $input('add-outro').checked;
    $('outro-options').style.display = visible ? 'block' : 'none';
  });

  console.log('[PeptidiHR] App initialised.');
}
