import React, { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, Brain, Loader2, MessageSquare, Mic, Paperclip, PlusCircle, Send, Smile, X } from 'lucide-react';
import { generateAIResponse, handleAIConsumption, initAI, indexNewMessage } from '../lib/ai';
import { getCreditsInfo, getPaymentUrl, hasCredits, initCredits } from '../lib/credits';

const THREADS_KEY = 'cove_neural_threads_v1';
const ACTIVE_THREAD_KEY = 'cove_neural_active_v1';
const EMOJIS = ['😀', '😂', '😍', '🔥', '✨', '👍', '🙌', '🚀', '🤝', '🧠'];

function makeThread(title = 'New Neural Thread') {
  const id = `neural_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { id, title, updatedAt: Date.now(), messages: [] };
}

export default function NeuralLinkPage() {
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [aiStatus, setAiStatus] = useState('idle');
  const [aiProgress, setAiProgress] = useState(0);
  const [showCreditWall, setShowCreditWall] = useState(false);
  const [creditsInfo, setCreditsInfo] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const fileRef = useRef(null);
  const endRef = useRef(null);
  const aiInitPromiseRef = useRef(null);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem('cove_dark_mode');
      if (storedTheme !== null) setDarkMode(storedTheme === 'true');
    } catch (e) { }

    let initial = [];
    try {
      const raw = localStorage.getItem(THREADS_KEY);
      if (raw) initial = JSON.parse(raw);
    } catch (e) { }
    if (!Array.isArray(initial) || initial.length === 0) {
      initial = [makeThread('Welcome to Neural Link')];
    }

    let initialActive = '';
    try {
      initialActive = localStorage.getItem(ACTIVE_THREAD_KEY) || '';
    } catch (e) { }
    if (!initial.find((t) => t.id === initialActive)) initialActive = initial[0].id;

    setThreads(initial);
    setActiveThreadId(initialActive);
    initCredits();
    setCreditsInfo(getCreditsInfo());
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    try {
      localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
      if (activeThreadId) localStorage.setItem(ACTIVE_THREAD_KEY, activeThreadId);
    } catch (e) { }
  }, [threads, activeThreadId, isInitialized]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages?.length]);

  const createThread = () => {
    const created = makeThread('New Neural Thread');
    setThreads((prev) => [created, ...prev]);
    setActiveThreadId(created.id);
  };

  const updateThreadById = (threadId, updater) => {
    if (!threadId) return;
    setThreads((prev) => prev.map((t) => (t.id === threadId ? updater(t) : t)));
  };

  const ensureAiReady = async () => {
    if (aiStatus === 'ready') return;
    if (aiInitPromiseRef.current) {
      await aiInitPromiseRef.current;
      return;
    }

    setAiStatus('loading');
    aiInitPromiseRef.current = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        aiInitPromiseRef.current = null;
        reject(new Error('AI model initialization timed out.'));
      }, 45000);

      initAI(
        (p) => {
          if (p?.progress != null) setAiProgress(Number(p.progress) || 0);
        },
        () => {
          clearTimeout(timeout);
          setAiStatus('ready');
          aiInitPromiseRef.current = null;
          resolve();
        }
      );
    });

    await aiInitPromiseRef.current;
  };

  const onAttach = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const next = files.map((file) => {
      const isImage = file.type.startsWith('image/');
      const isAudio = file.type.startsWith('audio/');
      const isVideo = file.type.startsWith('video/');
      return {
        file,
        previewUrl: URL.createObjectURL(file),
        fileType: isImage ? 'image' : isAudio ? 'audio' : isVideo ? 'video' : 'file'
      };
    });
    setPendingAttachments((prev) => [...prev, ...next]);
    e.target.value = '';
  };

  const sendMessage = async () => {
    if (!activeThreadId || isSending) return;
    const baseThread = threads.find((t) => t.id === activeThreadId);
    if (!baseThread) return;
    const text = messageInput.trim();
    if (!text && pendingAttachments.length === 0) return;

    setIsSending(true);
    const userMsg = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      text,
      created: Date.now(),
      attachments: pendingAttachments.map((a) => ({
        name: a.file?.name || 'file',
        url: a.previewUrl,
        fileType: a.fileType
      }))
    };

    updateThreadById(activeThreadId, (t) => ({
      ...t,
      title: t.messages.length === 0 && text ? text.slice(0, 30) : t.title,
      updatedAt: Date.now(),
      messages: [...t.messages, userMsg]
    }));
    setMessageInput('');
    setShowEmojiPicker(false);
    setPendingAttachments([]);

    if (!hasCredits()) {
      setShowCreditWall(true);
      updateThreadById(activeThreadId, (t) => ({
        ...t,
        updatedAt: Date.now(),
        messages: [...t.messages, { id: `m_${Date.now()}`, role: 'assistant', text: 'No AI credits left. Your message is saved; upgrade to continue AI replies.', created: Date.now() }]
      }));
      setIsSending(false);
      return;
    }

    try {
      const promptMessages = (baseThread.messages || []).slice(-10).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.text || ''
      }));
      promptMessages.push({
        role: 'user',
        content: `${text}${userMsg.attachments.length ? `\nAttachments: ${userMsg.attachments.map((a) => a.name).join(', ')}` : ''}`
      });

      await ensureAiReady();
      setAiStatus('generating');
      const ai = await generateAIResponse(promptMessages);
      handleAIConsumption(ai.tokens || 0);
      setCreditsInfo(getCreditsInfo());

      const aiMsg = {
        id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        text: ai.text || 'No response.',
        created: Date.now()
      };
      updateThreadById(activeThreadId, (t) => ({
        ...t,
        updatedAt: Date.now(),
        messages: [...t.messages, aiMsg]
      }));
      indexNewMessage(userMsg, activeThreadId);
      indexNewMessage(aiMsg, activeThreadId);
      setAiStatus('ready');
    } catch (e) {
      setAiStatus('ready');
      updateThreadById(activeThreadId, (t) => ({
        ...t,
        updatedAt: Date.now(),
        messages: [...t.messages, { id: `m_${Date.now()}`, role: 'assistant', text: `Error: ${e?.message || 'AI failed'}`, created: Date.now() }]
      }));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className={`fixed inset-0 h-[100dvh] flex overflow-hidden ${darkMode ? 'bg-[#0a0f1e] text-white' : 'bg-white text-slate-900'}`}>
      <Head>
        <title>Neural Link | Cove</title>
      </Head>

      <aside className={`w-[320px] h-full border-r ${darkMode ? 'bg-[#111827] border-white/10' : 'bg-white border-slate-100'} hidden md:flex md:flex-col`}>
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain size={18} className={darkMode ? 'text-blue-400' : 'text-[#00337C]'} />
            <p className="text-xs font-black uppercase tracking-widest">Neural Link</p>
          </div>
          <button onClick={createThread} className="p-2 rounded-xl bg-[#00337C] text-white"><PlusCircle size={16} /></button>
        </div>
        <div className="px-3 pb-4 overflow-y-auto flex-1">
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveThreadId(t.id)}
              className={`w-full text-left p-3 rounded-2xl mb-2 transition-colors ${activeThreadId === t.id ? 'bg-[#00337C] text-white' : darkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50'}`}
            >
              <p className="font-bold text-sm truncate">{t.title || 'Untitled'}</p>
              <p className={`text-[11px] mt-1 ${activeThreadId === t.id ? 'text-white/70' : 'opacity-60'}`}>{(t.messages || []).length} messages</p>
            </button>
          ))}
        </div>
      </aside>

      <main className={`flex-1 flex flex-col min-w-0 ${darkMode ? 'bg-[#0a0f1e]' : 'bg-[#F8FAFC]'}`}>
        <header className={`p-4 md:p-6 border-b flex items-center justify-between ${darkMode ? 'border-white/10' : 'border-slate-100'}`}>
          <div className="flex items-center gap-3">
            <Link href="/" className={`p-2 rounded-full ${darkMode ? 'bg-white/5' : 'bg-slate-100'}`}><ArrowLeft size={18} /></Link>
            <div>
              <p className="text-xs font-black uppercase tracking-widest">Neural Link</p>
              <p className="text-xs opacity-60">{aiStatus === 'loading' ? 'Initializing model...' : aiStatus === 'generating' ? 'Generating...' : 'Ready'}</p>
            </div>
          </div>
          <button onClick={createThread} className="md:hidden p-2 rounded-xl bg-[#00337C] text-white"><PlusCircle size={16} /></button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4">
          {(activeThread?.messages || []).length === 0 && (
            <div className="h-full flex items-center justify-center opacity-40">
              <div className="text-center">
                <MessageSquare size={38} className="mx-auto mb-3" />
                <p className="text-xs font-black uppercase tracking-widest">Start a Neural conversation</p>
              </div>
            </div>
          )}
          {(activeThread?.messages || []).map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] md:max-w-[70%] p-3 md:p-4 rounded-[22px] ${m.role === 'user' ? 'bg-gradient-to-br from-[#00337C] to-[#002a66] text-white rounded-tr-none' : darkMode ? 'bg-[#1e293b]/80 border border-white/5 rounded-tl-none' : 'bg-white border border-slate-100 rounded-tl-none'}`}>
                {m.attachments?.map((a, i) => (
                  <div key={`${m.id}_${i}`} className="mb-2">
                    {a.fileType === 'image' ? <img src={a.url} alt={a.name} className="max-h-[220px] rounded-xl" /> : null}
                    {a.fileType !== 'image' ? <p className="text-xs opacity-80">Attachment: {a.name}</p> : null}
                  </div>
                ))}
                <p className="text-[15px] font-medium leading-relaxed whitespace-pre-wrap">{m.text}</p>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <div className={`px-2 md:px-8 py-2 md:py-4 pb-4 md:pb-8 relative z-10 safe-p-bottom w-full ${darkMode ? 'bg-[#0a0f1e]' : 'bg-[#F8FAFC]'}`}>
          {pendingAttachments.length > 0 && (
            <div className={`max-w-4xl mx-auto mb-2 p-3 rounded-xl flex flex-col gap-3 ${darkMode ? 'bg-white/5' : 'bg-slate-50'}`}>
              {pendingAttachments.map((att, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {att.fileType === 'image' ? <img src={att.previewUrl} alt="preview" className="w-20 h-20 object-cover rounded-md" /> : <div className={`w-20 h-20 rounded-md flex items-center justify-center bg-slate-100 ${darkMode ? 'bg-black/20' : ''}`}>{att.file?.name?.slice(0, 6)}</div>}
                    <div>
                      <p className="font-bold truncate max-w-xs">{att.file?.name}</p>
                      <p className="text-xs opacity-60">{att.fileType}</p>
                    </div>
                  </div>
                  <button onClick={() => setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))} className="p-2 rounded-md text-sm font-bold text-red-500">Remove</button>
                </div>
              ))}
            </div>
          )}

          <div className={`max-w-4xl mx-auto rounded-[30px] shadow-lg flex items-center gap-1 md:gap-2 p-1 md:p-2 px-2 md:px-4 relative transition-all duration-200 ${darkMode ? 'bg-[#111827] border border-white/5' : 'bg-white border border-slate-100'}`}>
            {(aiStatus === 'loading' || aiStatus === 'generating') && (
              <div className="absolute -top-12 left-0 right-0 max-w-4xl mx-auto px-4">
                <div className={`p-3 rounded-2xl shadow-xl backdrop-blur-md flex flex-col gap-2 ${darkMode ? 'bg-blue-600/10 border border-blue-500/20' : 'bg-blue-50 border border-blue-100'}`}>
                  <div className="flex justify-between items-center text-[10px] uppercase font-black tracking-widest text-[#00337C] dark:text-blue-400">
                    <span className="flex items-center gap-2"><Brain size={12} className={aiStatus === 'generating' ? 'animate-pulse' : ''} /> {aiStatus === 'loading' ? 'Neural Link Initializing...' : 'Generating Response...'}</span>
                    {aiStatus === 'loading' && <span>{Math.round(aiProgress * 100)}%</span>}
                  </div>
                  {aiStatus === 'loading' && (
                    <div className="w-full h-1 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${aiProgress * 100}%` }} />
                    </div>
                  )}
                </div>
              </div>
            )}

            <input type="file" ref={fileRef} hidden multiple onChange={onAttach} />
            <button onClick={() => fileRef.current?.click()} className="p-0.5 md:p-3 text-slate-400 hover:text-blue-400 shrink-0"><Paperclip size={18} /></button>
            <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-0.5 md:p-3 text-slate-400 hover:text-blue-400 shrink-0"><Smile size={18} /></button>
            <button onClick={() => setMessageInput((v) => `${v}${v ? ' ' : ''}🎤`)} className="p-0.5 md:p-3 shrink-0 text-slate-400 hover:text-blue-400" title="Voice note placeholder"><Mic size={18} /></button>
            <button onClick={() => setAiStatus((s) => (s === 'ready' ? 'ready' : s))} className={`p-0.5 md:p-3 shrink-0 ${aiStatus === 'ready' ? 'text-blue-500' : aiStatus === 'loading' || aiStatus === 'generating' ? 'text-[#00337C] animate-pulse' : 'text-slate-400'} hover:text-blue-400`} title="Local AI Assistant">
              <Brain size={18} />
            </button>

            {showEmojiPicker && (
              <div className={`absolute bottom-20 left-4 p-4 rounded-3xl shadow-2xl border z-50 transition-colors ${darkMode ? 'bg-[#1e293b] border-white/10' : 'bg-white border-slate-100'}`} style={{ width: 260 }}>
                <div className="flex flex-wrap gap-2">
                  {EMOJIS.map((e) => (
                    <button key={e} onClick={() => { setMessageInput((v) => `${v}${e}`); setShowEmojiPicker(false); }} className="text-2xl p-1 rounded-lg hover:scale-110 transition-transform">{e}</button>
                  ))}
                </div>
              </div>
            )}

            <input
              className={`flex-1 min-w-0 px-2 outline-none font-bold text-sm bg-transparent ${darkMode ? 'text-white placeholder:text-slate-500' : 'text-slate-900'}`}
              placeholder={isSending ? 'Generating...' : 'Type a message...'}
              value={messageInput}
              disabled={isSending}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button onClick={sendMessage} disabled={isSending} className={`p-3 md:p-4 ${isSending ? 'opacity-50 cursor-not-allowed' : 'bg-gradient-to-br from-[#00337C] to-[#0055A4] hover:shadow-blue-900/30 hover:shadow-xl'} text-white rounded-[20px] active:scale-90 transition-all duration-200 shadow-md`}>
              {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </main>

      {showCreditWall && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xl flex items-center justify-center p-6 z-[200]">
          <div className={`p-10 rounded-[40px] w-full max-w-sm shadow-2xl text-center transition-colors ${darkMode ? 'bg-[#111827] border border-white/10' : 'bg-white'}`}>
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#00337C] to-[#0055A4] mx-auto mb-6 flex items-center justify-center">
              <Brain size={36} className="text-white" />
            </div>
            <h2 className={`text-2xl font-black mb-2 ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>Credits Exhausted</h2>
            <p className={`text-sm mb-6 opacity-60 ${darkMode ? 'text-white' : 'text-slate-600'}`}>You have used your free AI credits this week.</p>
            <button onClick={() => window.open(getPaymentUrl(), '_blank')} className="w-full py-4 bg-gradient-to-r from-[#00337C] to-[#0055A4] text-white rounded-2xl font-black shadow-lg uppercase tracking-widest mb-3">Upgrade to Pro</button>
            <p className={`text-[11px] mb-3 ${darkMode ? 'text-blue-300' : 'text-[#00337C]'}`}>Credits left: {creditsInfo?.credits ?? 0}</p>
            <button onClick={() => setShowCreditWall(false)} className="text-sm font-bold text-slate-400 uppercase tracking-widest hover:text-white transition-colors">Maybe Later</button>
          </div>
        </div>
      )}
    </div>
  );
}
