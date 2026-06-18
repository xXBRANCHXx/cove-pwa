const MAX_TEXT_CHARS = 4000;

function clip(text = '', max = MAX_TEXT_CHARS) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max).trimEnd()}...` : s;
}

async function readTextFile(file) {
  const raw = await file.text();
  return clip(raw);
}

function extractPdfTextBasicFromBytes(bytes) {
  // Lightweight PDF text extraction from common literal-string operators.
  // This is intentionally simple and local-only; OCR is handled in future stages.
  const latin = new TextDecoder('latin1').decode(bytes);
  const pieces = [];

  const tj = /\(([^()]*)\)\s*Tj/g;
  let m;
  while ((m = tj.exec(latin)) !== null) {
    if (m[1]) pieces.push(m[1]);
  }

  const tjArray = /\[(.*?)\]\s*TJ/gs;
  while ((m = tjArray.exec(latin)) !== null) {
    const part = m[1] || '';
    const strings = part.match(/\(([^()]*)\)/g) || [];
    for (const s of strings) {
      pieces.push(s.slice(1, -1));
    }
  }

  if (pieces.length === 0) {
    const coarse = latin.match(/[A-Za-z0-9][A-Za-z0-9 ,.:;'"!?()\-_/]{24,}/g) || [];
    pieces.push(...coarse.slice(0, 80));
  }

  const uniq = Array.from(new Set(pieces.map(p => p.replace(/\\[nrtbf()\\]/g, ' ').trim()).filter(Boolean)));
  return clip(uniq.join(' '));
}

async function readPdfFile(file) {
  const buf = await file.arrayBuffer();
  const text = extractPdfTextBasicFromBytes(new Uint8Array(buf));
  return text || `PDF file: ${file.name}`;
}

function readMediaMetadata(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const isVideo = (file.type || '').startsWith('video');
    const el = document.createElement(isVideo ? 'video' : 'audio');
    const done = (data) => {
      try { URL.revokeObjectURL(url); } catch (e) { }
      resolve(data);
    };

    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const duration = Number.isFinite(el.duration) ? el.duration : 0;
      done({
        durationSec: Math.round(duration),
        width: isVideo ? (el.videoWidth || 0) : 0,
        height: isVideo ? (el.videoHeight || 0) : 0
      });
    };
    el.onerror = () => done({ durationSec: 0, width: 0, height: 0 });
    el.src = url;
  });
}

async function readImageMetadata(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const meta = { width: img.naturalWidth || 0, height: img.naturalHeight || 0 };
      try { URL.revokeObjectURL(url); } catch (e) { }
      resolve(meta);
    };
    img.onerror = () => {
      try { URL.revokeObjectURL(url); } catch (e) { }
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}

export async function extractShadowTextFromFile(file, opts = {}) {
  if (!file) return '';
  const mode = opts.mode === 'lite' ? 'lite' : 'full';
  const type = String(file.type || '').toLowerCase();
  const name = file.name || 'file';

  if (type.startsWith('text/') || type.includes('json') || type.includes('xml') || type.includes('csv')) {
    return readTextFile(file);
  }

  if (type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
    const pdfText = await readPdfFile(file);
    return `PDF Shadow (${name}): ${pdfText}`;
  }

  if (type.startsWith('image/')) {
    const meta = await readImageMetadata(file);
    return `Image Shadow (${name}) ${meta.width}x${meta.height}. OCR ${mode === 'lite' ? 'deferred for battery saver' : 'pending enhanced extraction'}.`;
  }

  if (type.startsWith('audio/')) {
    const meta = await readMediaMetadata(file);
    return `Audio Shadow (${name}) duration ${meta.durationSec}s. Transcription ${mode === 'lite' ? 'deferred (battery mode)' : 'queued for on-device ASR'}; first 60s prioritized.`;
  }

  if (type.startsWith('video/')) {
    const meta = await readMediaMetadata(file);
    return `Video Shadow (${name}) ${meta.width}x${meta.height}, duration ${meta.durationSec}s. ${mode === 'lite' ? 'Lite mode: metadata indexed now.' : 'Full mode: first 60s retrieval context prioritized.'}`;
  }

  return `File Shadow (${name}) type ${type || 'unknown'}.`;
}
