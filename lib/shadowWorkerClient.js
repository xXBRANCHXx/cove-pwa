let workerRef = null;
let seq = 0;
const inflight = new Map();

function makeWorker() {
  if (typeof window === 'undefined') return null;
  if (workerRef) return workerRef;

  const script = `
    import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0-alpha.19';

    let asr = null;
    let ocr = null;
    let asrLoading = null;
    let ocrLoading = null;

    async function ensureASR() {
      if (asr) return asr;
      if (!asrLoading) {
        asrLoading = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
          progress_callback: (p) => self.postMessage({ type: 'progress', data: { channel: 'asr', progress: p?.progress || 0 } })
        });
      }
      asr = await asrLoading;
      return asr;
    }

    async function ensureOCR() {
      if (ocr) return ocr;
      if (!ocrLoading) {
        ocrLoading = pipeline('image-to-text', 'Xenova/trocr-small-printed', {
          progress_callback: (p) => self.postMessage({ type: 'progress', data: { channel: 'ocr', progress: p?.progress || 0 } })
        });
      }
      ocr = await ocrLoading;
      return ocr;
    }

    function toBlobUrl(buffer, mimeType) {
      const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
      return URL.createObjectURL(blob);
    }

    self.onmessage = async (e) => {
      const { type, id, data } = e.data || {};
      if (type !== 'job') return;

      try {
        const { fileType, buffer, mimeType } = data || {};
        const blobUrl = toBlobUrl(buffer, mimeType);
        let text = '';

        if (fileType === 'image') {
          const ocrPipe = await ensureOCR();
          const out = await ocrPipe(blobUrl, { max_new_tokens: 196 });
          if (Array.isArray(out) && out[0]?.generated_text) text = out[0].generated_text;
          else if (out?.generated_text) text = out.generated_text;
          else text = '';
        } else if (fileType === 'audio' || fileType === 'video') {
          const asrPipe = await ensureASR();
          const out = await asrPipe(blobUrl, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: false
          });
          text = out?.text || '';
        }

        try { URL.revokeObjectURL(blobUrl); } catch (e) {}
        self.postMessage({ type: 'result', id, data: { text: String(text || '').trim() } });
      } catch (err) {
        self.postMessage({ type: 'error', id, error: err?.message || 'Shadow worker failed' });
      }
    };
  `;

  const blob = new Blob([script], { type: 'application/javascript' });
  workerRef = new Worker(URL.createObjectURL(blob), { type: 'module' });

  workerRef.onmessage = (e) => {
    const { type, id, data, error } = e.data || {};
    if (type === 'progress') return;
    const slot = inflight.get(id);
    if (!slot) return;
    if (type === 'result') {
      slot.resolve(data || {});
      inflight.delete(id);
    } else if (type === 'error') {
      slot.reject(new Error(error || 'Shadow worker error'));
      inflight.delete(id);
    }
  };

  return workerRef;
}

export async function runDeepShadowJob({ file, fileType }) {
  if (!file || !fileType) return '';
  const worker = makeWorker();
  if (!worker) return '';

  const id = `shadow_job_${Date.now()}_${seq++}`;
  const buffer = await file.arrayBuffer();

  return new Promise((resolve, reject) => {
    inflight.set(id, { resolve, reject });
    worker.postMessage({
      type: 'job',
      id,
      data: {
        fileType,
        buffer,
        mimeType: file.type || 'application/octet-stream'
      }
    });
  }).then((out) => out?.text || '');
}
