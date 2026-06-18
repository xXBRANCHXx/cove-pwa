// pages/api/cove-ai.js
// Server-side Gemini AI endpoint for Neural Link conversation.
// Optimized for conversational chat with memory context.

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = 'gemini-2.0-flash';

const SYSTEM_INSTRUCTION = `You are Neural Link, an advanced AI assistant inside the Cove messenger app.
You are helpful, witty, and concise.

CRITICAL RULES:
1. If the user provided "Relevant Memory," treat it as factual context about their past interactions.
2. If the user provided "Internal Analysis," that is your own reasoning chain from a previous pass — use it to inform your answer.
3. Be conversational and warm.
4. Keep answers relatively short (1-4 sentences) unless asked for more.
5. Never mention that you are a language model or that you are running on a server.
6. Use emojis occasionally to stay friendly.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  try {
    const { messages, memory = [], plan = '' } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Missing messages history' });
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    // Format history for Gemini
    // Convert generic {role, content} to Gemini's {role, parts: [{text}]}
    const geminiHistory = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || m.text || '' }]
    }));

    const lastMsg = messages[messages.length - 1];
    let userText = lastMsg.content || lastMsg.text || '';

    // Inject memory and plan context into the final prompt
    let contextBlock = '';
    if (memory.length > 0) {
      contextBlock += `\n\n## Relevant Memory\n${memory.map((m, i) => `[${i+1}] (${m.role}): ${m.text}`).join('\n')}`;
    }
    if (plan) {
      contextBlock += `\n\n## Internal Analysis\n${plan}`;
    }

    if (contextBlock) {
      userText = `${userText}${contextBlock}`;
    }

    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(userText);
    const response = await result.response;
    const text = response.text();

    const tokenEstimate = Math.ceil((userText.length + text.length) / 4);

    return res.status(200).json({
      text,
      tokens: tokenEstimate,
      model: MODEL_NAME
    });
  } catch (err) {
    console.error('[CoveAI API] Error:', err.message);
    return res.status(500).json({ error: err.message || 'AI failed' });
  }
}
