/**
 * Cove AI Manager — Enhanced with Semantic Memory & Multi-Pass Reasoning
 *
 * Features:
 * - Local LLM via Transformers.js (Qwen2.5-0.5B-Instruct → Qwen1.5-0.5B-Chat → TinyLlama fallback)
 * - Fast embeddings (all-MiniLM-L6-v2) for semantic search
 * - Persistent vector memory in IndexedDB (auto-pruned to ~15,000 entries)
 * - 3-pass generation: (1) query embedding + retrieval, (2) planning/analysis, (3) main generation
 * - Same public API: initAI, generateAIResponse, handleAIConsumption
 * - New export: indexNewMessage(msg, threadId)
 */

import { hasCredits, consumeTokens } from './credits';
import { extractFactsLocally } from './speedDemon';

// ─── Worker & State ──────────────────────────────────────────────────────────
let worker = null;
let workerState = 'idle'; // 'idle' | 'loading' | 'ready' | 'error'
let onProgressCallback = null;
let onReadyCallback = null;
let onErrorCallback = null;

// ─── Embedding Model (runs on main thread for speed) ─────────────────────────
let embedPipeline = null;
let embedReady = false;

const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
const IDB_NAME = 'cove_memory_v2';
const IDB_STORE = 'vectors';
const MAX_MEMORY_ENTRIES = 15000;
const RETRIEVAL_TOP_K = 8;

// ─── IndexedDB Helpers ───────────────────────────────────────────────────────

function openMemoryDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('threadId', 'threadId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addMemoryEntry(entry) {
  const db = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).add(entry);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function getAllMemoryEntries() {
  const db = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function pruneMemoryIfNeeded() {
  const db = await openMemoryDB();
  const tx = db.transaction(IDB_STORE, 'readwrite');
  const store = tx.objectStore(IDB_STORE);
  const countReq = store.count();

  countReq.onsuccess = () => {
    const count = countReq.result;
    if (count <= MAX_MEMORY_ENTRIES) { db.close(); return; }

    const target = Math.floor(MAX_MEMORY_ENTRIES * 0.8);
    const toDelete = count - target;
    const idx = store.index('timestamp');
    const cursor = idx.openCursor();
    let deleted = 0;

    cursor.onsuccess = (e) => {
      const c = e.target.result;
      if (c && deleted < toDelete) {
        c.delete();
        deleted++;
        c.continue();
      } else {
        db.close();
      }
    };
  };
  countReq.onerror = () => db.close();
}

// ─── Embedding Utilities ─────────────────────────────────────────────────────

async function initEmbeddings() {
  if (embedReady) return;
  try {
    const { pipeline, env } = await import(
      /* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0-alpha.19'
    );
    env.allowRemoteModels = true;
    env.remoteHost = 'https://huggingface.co/';
    env.remotePathTemplate = '{model}/resolve/{revision}/';

    embedPipeline = await pipeline('feature-extraction', EMBED_MODEL, {
      progress_callback: (p) => {
        if (onProgressCallback && p?.progress != null) {
          onProgressCallback({ ...p, status: 'embeddings' });
        }
      }
    });
    embedReady = true;
  } catch (err) {
    console.warn('[CoveAI] Embeddings init failed, falling back to keyword search:', err.message);
  }
}

async function embed(text) {
  if (!embedPipeline) return null;
  try {
    const result = await embedPipeline(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data);
  } catch {
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Semantic Retrieval ──────────────────────────────────────────────────────

export async function retrieveRelevantMemory(queryText, topK = RETRIEVAL_TOP_K) {
  const entries = await getAllMemoryEntries();
  if (entries.length === 0) return [];

  const queryVec = await embed(queryText);

  if (queryVec) {
    const scored = entries.map((entry) => ({
      ...entry,
      score: cosineSimilarity(queryVec, entry.vector)
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).filter((s) => s.score > 0.15);
  }

  // Fallback: keyword overlap
  const queryWords = new Set(queryText.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const scored = entries.map((entry) => {
    const entryWords = (entry.text || '').toLowerCase().split(/\s+/);
    const overlap = entryWords.filter((w) => queryWords.has(w)).length;
    return { ...entry, score: overlap / Math.max(queryWords.size, 1) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).filter((s) => s.score > 0);
}

// ─── Public: Index a New Message into Memory ─────────────────────────────────

export async function indexNewMessage(msg, threadId) {
  if (!msg || !msg.text || msg.text.length < 5) return;
  try {
    const vector = await embed(msg.text);
    await addMemoryEntry({
      text: msg.text,
      role: msg.role || 'user',
      threadId: threadId || 'unknown',
      timestamp: msg.created || Date.now(),
      vector: vector,
      source: 'message'
    });

    // ─── Fact Extraction for Semantic Memory ───
    // We spend extra time during indexing to make search instant later.
    const facts = extractFactsLocally(msg.text, msg.role, msg.authorName || 'User', {
      ts: msg.created || Date.now(),
      threadId: threadId || 'unknown'
    });

    for (const fact of facts) {
       const factVector = await embed(fact.text);
       await addMemoryEntry({
         text: fact.text,
         role: 'system',
         threadId: 'facts',
         timestamp: Date.now(),
         vector: factVector,
         source: 'fact',
         confidence: Number(fact.confidence || 0) || undefined,
         subject: fact.subject || undefined,
         speaker: fact.speaker || undefined,
         mentionedOn: fact.mentionedOn || undefined
       });
    }

    pruneMemoryIfNeeded().catch(() => {});
  } catch (err) {
    console.warn('[CoveAI] Failed to index message:', err.message);
  }
}

// ─── Multi-Pass Prompt Construction ──────────────────────────────────────────

function buildSystemPrompt(retrievedMemory, planText) {
  const memoryBlock = retrievedMemory.length > 0
    ? `\n\n## Relevant Memory (from past conversations)\n${retrievedMemory.map((m, i) =>
        `[${i + 1}] (${m.role}, relevance:${m.score?.toFixed(2)}): ${m.text.slice(0, 300)}`
      ).join('\n')}`
    : '';

  const planBlock = planText
    ? `\n\n## Your Internal Analysis\n${planText}`
    : '';

  return `You are Neural Link, an AI assistant in Cove messenger.${memoryBlock}${planBlock}

IDENTITY:
The user you are chatting with is "Ren".
When you see sources saying "Ren says..." or "[Ren]: ...", that is the user.
If the user asks "What is my favorite color?", they are asking about Ren.

CRITICAL RULES:
1. Ground Truth: Information in the "Relevant Memory" and "local context" blocks is the ONLY source of truth for personal facts.
2. Directness: If a source says "Ren's favorite color is Green", answer with "Your favorite color is Green".
3. NO Hallucination: If the answer is not in the sources, say you don't know.
4. Concise: Keep answers under 2 sentences.`;
}

/**
 * Extract the clean user query from a context-enriched message.
 * Cove Search sends messages like "who is George?\n\n---\nRelevant local context..."
 * We need just "who is George?" for embedding/retrieval.
 */
function extractCleanQuery(content) {
  if (!content) return '';
  // Split on the context separator
  const sepIdx = content.indexOf('\n\n---\n');
  if (sepIdx > 0) return content.slice(0, sepIdx).trim();
  return content.trim();
}

// ─── Worker & Generation ─────────────────────────────────────────────────────

let globalGenerateResolve = null;
let globalGenerateReject = null;

export function initAI(onProgress, onReady, onError) {
  onProgressCallback = onProgress;
  onReadyCallback = onReady;
  onErrorCallback = onError;

  if (worker) {
    if (workerState === 'ready' && onReadyCallback) onReadyCallback();
    if (workerState === 'loading') return;
    if (workerState === 'error') {
      try { worker.terminate(); } catch (e) { }
      worker = null;
    } else {
      return;
    }
  }
  workerState = 'loading';

  // Start embedding model init in parallel (non-blocking)
  initEmbeddings().catch((err) => {
    console.warn('[CoveAI] Embedding init background error:', err.message);
  });

  // Worker blob — Qwen2.5-0.5B-Instruct (smartest small model) → Qwen1.5-0.5B-Chat → TinyLlama fallback
  // All use ChatML (<|im_start|>/<|im_end|>) format
  const workerScript = `
    import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0-alpha.19';

    let generator = null;
    let loadedModelId = null;
    let tokenizer = null;

    env.allowRemoteModels = true;
    env.remoteHost = 'https://huggingface.co/';
    env.remotePathTemplate = '{model}/resolve/{revision}/';

    self.onmessage = async (e) => {
      const { type, data } = e.data;

      if (type === 'load') {
        try {
          // Model candidates ordered by quality (all < 1GB, all use ChatML)
          const modelCandidates = [
            'onnx-community/Qwen2.5-0.5B-Instruct',
            'Xenova/Qwen1.5-0.5B-Chat',
            'Xenova/TinyLlama-1.1B-Chat-v1.0',
            'Xenova/distilgpt2'
          ];
          let lastError = null;

          for (const modelId of modelCandidates) {
            try {
              self.postMessage({ type: 'progress', data: { status: 'model_try', model: modelId } });
              generator = await pipeline('text-generation', modelId, {
                progress_callback: (p) => {
                  self.postMessage({ type: 'progress', data: p });
                }
              });
              loadedModelId = modelId;
              tokenizer = generator.tokenizer;
              break;
            } catch (err) {
              lastError = err;
              self.postMessage({ type: 'progress', data: { status: 'model_fail', model: modelId, error: err.message } });
            }
          }

          if (!generator) throw lastError || new Error('No AI model could be loaded.');
          self.postMessage({ type: 'ready', data: { model: loadedModelId } });
        } catch (err) {
          self.postMessage({ type: 'error', data: err.message });
        }
      }

      if (type === 'generate') {
        if (!generator) {
          self.postMessage({ type: 'error', data: 'Model not loaded' });
          return;
        }

        const { messages, max_new_tokens = 512 } = data;

        try {
          // Try using the tokenizer's built-in chat template first (Qwen2.5, Qwen1.5)
          let prompt;
          try {
            if (tokenizer && typeof tokenizer.apply_chat_template === 'function') {
              prompt = tokenizer.apply_chat_template(messages, {
                tokenize: false,
                add_generation_prompt: true,
              });
            } else {
              throw new Error('no chat template');
            }
          } catch (_) {
            // Fallback: manual ChatML format (works for TinyLlama and others)
            prompt = messages.map(m => \`<|im_start|>\${m.role}\\n\${m.content}<|im_end|>\`).join('\\n') + '\\n<|im_start|>assistant\\n';
          }

          const output = await generator(prompt, {
            max_new_tokens,
            do_sample: true,
            temperature: 0.7,
            top_p: 0.92,
            repetition_penalty: 1.15,
            return_full_text: false,
          });

          // Extract just the generated text
          let response;
          if (output[0] && typeof output[0].generated_text === 'string') {
            response = output[0].generated_text;
          } else if (Array.isArray(output) && output[0]?.generated_text) {
            response = output[0].generated_text;
          } else {
            response = String(output);
          }

          // Clean up any leftover ChatML tokens
          response = response
            .replace(/<\\|im_start\\|>assistant\\n?/g, '')
            .replace(/<\\|im_end\\|>/g, '')
            .replace(/<\\|endoftext\\|>/g, '')
            .trim();

          // Estimate tokens (rough: 1 token ≈ 4 chars for English)
          const tokenEstimate = Math.ceil((prompt.length + response.length) / 4);

          self.postMessage({
            type: 'result',
            data: {
              text: response,
              tokens: tokenEstimate,
              model: loadedModelId
            }
          });
        } catch (err) {
          self.postMessage({ type: 'error', data: err.message });
        }
      }
    };
  `;

  const blob = new Blob([workerScript], { type: 'application/javascript' });
  try {
    worker = new Worker(URL.createObjectURL(blob), { type: 'module' });
  } catch (err) {
    workerState = 'error';
    if (onErrorCallback) onErrorCallback(err?.message || 'Worker failed to start');
    return;
  }

  worker.onmessage = (e) => {
    const { type, data } = e.data;
    if (type === 'progress' && onProgressCallback) {
      onProgressCallback(data);
    } else if (type === 'ready') {
      workerState = 'ready';
      console.log('[CoveAI] Model loaded:', data?.model);
      if (onReadyCallback) onReadyCallback();
    } else if (type === 'result') {
      const { text, tokens } = data;
      if (globalGenerateResolve) {
        globalGenerateResolve({ text, tokens });
        globalGenerateResolve = null;
        globalGenerateReject = null;
      }
    } else if (type === 'error') {
      console.error('[CoveAI] Worker Error:', data);
      if (onErrorCallback) onErrorCallback(data);
      if (globalGenerateReject) {
        globalGenerateReject(new Error(data));
        globalGenerateResolve = null;
        globalGenerateReject = null;
      }
    }
  };
  worker.onerror = (err) => {
    workerState = 'error';
    const msg = err?.message || 'AI worker crashed';
    console.error('[CoveAI] Worker Runtime Error:', msg, err);
    if (onErrorCallback) onErrorCallback(msg);
  };
  worker.onmessageerror = (err) => {
    workerState = 'error';
    console.error('[CoveAI] Worker Message Error:', err);
    if (onErrorCallback) onErrorCallback('AI worker message channel failed');
  };

  worker.postMessage({ type: 'load' });
}

// ─── Internal: Single Worker Generation Call ─────────────────────────────────

function workerGenerate(messages, maxTokens = 512) {
  return new Promise((resolve, reject) => {
    if (!worker || workerState !== 'ready') return reject(new Error('AI not initialized'));

    // Set a timeout so we don't hang forever on a single pass
    const timeout = setTimeout(() => {
      globalGenerateResolve = null;
      globalGenerateReject = null;
      reject(new Error('Generation timed out'));
    }, 30000);

    globalGenerateResolve = (result) => {
      clearTimeout(timeout);
      resolve(result);
    };
    globalGenerateReject = (err) => {
      clearTimeout(timeout);
      reject(err);
    };
    worker.postMessage({ type: 'generate', data: { messages, max_new_tokens: maxTokens } });
  });
}

// ─── Public: Generate AI Response (3-Pass) ───────────────────────────────────

export async function generateAIResponse(messages) {
  if (!hasCredits()) throw new Error('NO_CREDITS');
  if (!worker) throw new Error('AI not initialized');

  // Extract query and check for existing context
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const rawContent = lastUserMsg?.content || '';
  const queryText = extractCleanQuery(rawContent);

  // Pass 1: Semantic Retrieval (local)
  let retrievedMemory = [];
  try {
    retrievedMemory = await retrieveRelevantMemory(queryText, 5);
  } catch (err) {
    console.warn('[CoveAI] Memory retrieval failed:', err.message);
  }

  // ─── Optimization: Direct Fact Return (0ms) ───────────
  // We prioritize 'FACT:' documents that match the query subject.
  // We check BOTH retrieved memory AND the passed context.
  const tokens = queryText.toLowerCase().split(/\s+/);
  const findFact = (list) => list.find(m => {
     const text = (m.text || String(m.snippet || m)).toLowerCase();
     if (!text.includes('fact:')) return false;

     // Stricter Subject Matching
     return tokens.some(t => {
        if (t.length < 3) return false;
        // Check for "Name's" or "[Name]:" or "Name is"
        const pattern = new RegExp(`\\b${t}[''\\s:]`, 'i');
        return pattern.test(text);
     }) && (m.score > 0.72 || !m.score);
  });

  const topFact = findFact(retrievedMemory) || findFact(rawContent.split('\n'));

  if (topFact) {
     const text = topFact.text || String(topFact);
     const displayAnswer = text.replace(/.*?FACT: /, '').replace(/.*?VERIFIED: /, '').trim();
     return {
       text: displayAnswer,
       tokens: 0,
       isDirectFact: true
     };
  }

  // ─── Heuristic Re-Ranking (Instead of slow AI Pass) ──────
  // Pick the single best source based on matching density
  const bestSource = retrievedMemory.length > 0
    ? [...retrievedMemory].sort((a, b) => {
        const aCount = tokens.filter(t => a.text.toLowerCase().includes(t)).length;
        const bCount = tokens.filter(t => b.text.toLowerCase().includes(t)).length;
        return bCount - aCount;
      })[0]
    : null;

  const bestSources = bestSource ? [bestSource] : [];

  // ─── Pass 2: Final Synthesis (Local) ──────────────────────
  // Only run ONE generation pass to keep latency < 10s
  const systemMsg = buildSystemPrompt(bestSources, '');
  const result = await workerGenerate([{ role: 'system', content: systemMsg }, ...messages], 180);

  return {
    text: (result.text || '').split('\n\n')[0].trim() || 'No response.',
    tokens: result.tokens || 0
  };
}

// ─── Public: Quick Single-Pass Answer (for Cove Search) ──────────────────────

export async function generateQuickAnswer(messages, maxTokens = 150) {
  if (!hasCredits()) {
    throw new Error('NO_CREDITS');
  }
  if (!worker || workerState !== 'ready') {
    throw new Error('AI not initialized');
  }
  // Single worker call — no memory retrieval, no planning pass
  const result = await workerGenerate(messages, maxTokens);
  return {
    text: result.text || 'No response.',
    tokens: result.tokens || 0
  };
}

// ─── Public: Handle Credit Consumption ───────────────────────────────────────

export function handleAIConsumption(tokens) {
  consumeTokens(tokens);
}
