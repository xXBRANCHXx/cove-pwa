// pages/api/cove-search.js
// Server-side Gemini AI endpoint for Cove Search RAG queries.
// Keeps the API key secret (never exposed to the browser).

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = 'gemini-2.0-flash';

const SYSTEM_INSTRUCTION = `You are Neural Link, the AI search assistant inside Cove messenger.
You answer questions about the user's chat history using ONLY the provided source snippets.

CRITICAL RULES:
1. The sources are GROUND TRUTH. Base your answer ONLY on what the sources say.
2. If a source directly answers the question, repeat that information clearly.
3. NEVER invent, guess, or hallucinate facts not found in the provided sources.
4. If the sources don't contain the answer, say "I couldn't find this in your chats."
5. Be concise — 1-3 sentences unless the user asks for detail.
6. Be conversational and warm.
7. When reasoning across multiple sources, explain your chain of thought briefly.
8. If the question involves pronouns (he/she/they), use the conversation context to resolve them.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  try {
    const { query, context, history, needsReasoning } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing query' });
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    // ─── Pass 1: Source Selection (Re-Ranking) ──────────────────
    // We take the raw context and ask the model to pick which sources actually answer the query.
    let goldenSources = context;
    let tokensSelection = 0;

    if (context && context.trim().length > 100) {
      const selectionPrompt = `QUERY: ${query}

CONTEXT SNIPPETS:
${context}

TASK: List ONLY the Snippet IDs (e.g. [1], [2]) that directly contain the answer to the QUERY.
If none match, say "NONE".
BE RELENTLESS. If a snippet is irrelevant, exclude it.`;

      const selResult = await model.generateContent(selectionPrompt);
      const selText = selResult.response.text();
      tokensSelection = Math.ceil((selectionPrompt.length + selText.length) / 4);

      if (!selText.includes('NONE')) {
        // Simple extraction of [N] IDs
        const ids = selText.match(/\[\d+\]/g) || [];
        if (ids.length > 0) {
          const lines = context.split('\n');
          const filtered = lines.filter(line => ids.some(id => line.startsWith(id)));
          if (filtered.length > 0) {
            goldenSources = filtered.join('\n');
          }
        }
      }
    }

    // ─── Pass 2: Final Synthesis ──────────────────────────────
    const finalPrompt = `QUERY: ${query}

SOURCES:
${goldenSources}

TASK: Answer the QUERY using ONLY the evidence in the SOURCES.
If the answer is in the sources, be concise and specific (e.g. "Ren's favorite color is blue, mentioned in a chat yesterday").
If the answer is NOT in the sources, say "I couldn't find that in your chats."`;

    const chatHistory = [];
    if (Array.isArray(history)) {
      for (const turn of history.slice(-6)) {
        if (!turn.role || !turn.text) continue;
        chatHistory.push({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.text }],
        });
      }
    }

    const chat = model.startChat({
      history: chatHistory,
      systemInstruction: SYSTEM_INSTRUCTION
    });

    const result = await chat.sendMessage(finalPrompt);
    const response = await result.response;
    const text = response.text();

    const tokenEstimate = Math.ceil((finalPrompt.length + text.length) / 4) + tokensSelection;

    return res.status(200).json({
      text,
      tokens: tokenEstimate,
      model: MODEL_NAME,
      refined: goldenSources !== context
    });
  } catch (err) {
    console.error('[CoveSearch API] Gemini error:', err.message);

    // Handle specific Gemini errors
    if (err.message?.includes('API_KEY')) {
      return res.status(401).json({ error: 'Invalid Gemini API key' });
    }
    if (err.message?.includes('quota') || err.message?.includes('429')) {
      return res.status(429).json({ error: 'AI rate limit reached. Try again in a moment.' });
    }

    return res.status(500).json({ error: err.message || 'AI generation failed' });
  }
}
