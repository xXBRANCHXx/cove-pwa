import React, { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import { pb } from '../lib/pb';
import { getLocalKV, setLocalKV } from '../lib/idb';
import {
  generateRSAKeyPair,
  encryptPrivateKeyWithPassword,
  decryptPrivateKeyWithPassword,
  encryptMessagePayloadForUsers,
  decryptMessagePayload
} from '../lib/crypto';
import { hasCredits, getCreditsInfo, consumeTokens, getPaymentUrl, initCredits } from '../lib/credits';
import { initAI, generateAIResponse, generateQuickAnswer, handleAIConsumption, indexNewMessage, retrieveRelevantMemory } from '../lib/ai';
import { parseWhatsAppChat, convertToCoveMessages } from '../lib/whatsapp';
import { checkAndRunSync } from '../lib/sync';
import {
  upsertShadowDocuments,
  hybridSearch,
  evaluateRetrievalQuality,
  buildContextCocktail,
  getLibraryAnswer,
  saveLibraryAnswer,
  getSpeedDemonStats,
  clearLibraryCache,
  clearShadowIndex,
  getShadowDocIdsForChat,
  getEntityAndFactDocs
} from '../lib/speedDemon';
import { extractShadowTextFromFile } from '../lib/shadowExtraction';
import { runDeepShadowJob } from '../lib/shadowWorkerClient';
import {
  Send, X, Menu, User, PlusCircle, Moon, Sun, Search, Smile,
  Settings, LogOut, Camera, MessageSquare, MoreVertical, Check, Trash2, Reply, ArrowRight, Paperclip, FileText, Download, Mic, Maximize,
  Pin, Ban, AlertTriangle, CheckCheck, Loader2, Users, UserPlus, UserMinus, Crown, LogOut as LogOutIcon, Image, Lock,
  Phone, Video, PhoneOff, MicOff, VideoOff, Wifi, WifiOff, Brain, Upload as UploadIcon
} from 'lucide-react';

const WORKER_URL = process.env.NEXT_PUBLIC_STORAGE_WORKER_URL;
const STORAGE_UPLOAD_TOKEN = process.env.NEXT_PUBLIC_STORAGE_UPLOAD_TOKEN || '';
const TURN_URLS = process.env.NEXT_PUBLIC_TURN_URLS || '';
const TURN_USERNAME = process.env.NEXT_PUBLIC_TURN_USERNAME || '';
const TURN_CREDENTIAL = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '';
const LOCAL_SELF_CHAT_KEY = 'cove_local_self_chat';
const LOCAL_SELF_CHAT_MSG_PREFIX = 'cove_local_self_messages_';
const DEEP_SHADOW_QUEUE_KEY = 'cove_speed_demon_deep_queue_v1';
const MAX_DEEP_SHADOW_RETRIES = 2;
const COVE_SEARCH_SETTINGS_PW_KEY = 'cove_search_settings_pw_hash_v1';
const COVE_SEARCH_CONVERSATIONS_PREFIX = 'cove_speed_demon_conversations_v1_';
const COVE_SEARCH_CONVERSATIONS_GLOBAL_KEY = 'cove_speed_demon_conversations_v1_global';
const DEFAULT_COVE_SEARCH_META = {
  confidence: 'unknown',
  qualityScore: 0,
  sourceCount: 0,
  fromCache: false,
  searchMs: 0
};

function getCoveSearchPersistenceKey(email = '') {
  const safeEmail = String(email || '').toLowerCase().trim();
  return safeEmail ? `${COVE_SEARCH_CONVERSATIONS_PREFIX}${safeEmail}` : COVE_SEARCH_CONVERSATIONS_GLOBAL_KEY;
}

function getCoveConversationTitle(history = []) {
  const firstUserTurn = (Array.isArray(history) ? history : []).find((turn) => turn?.role === 'user' && String(turn?.text || '').trim());
  const fallback = 'New Chat';
  const raw = String(firstUserTurn?.text || fallback).trim();
  if (!raw) return fallback;
  return raw.length > 42 ? `${raw.slice(0, 42).trimEnd()}...` : raw;
}

function getCoveConversationSnapshot(history = []) {
  const list = Array.isArray(history) ? history : [];
  const latestAssistant = [...list].reverse().find((turn) => turn?.role === 'assistant' && !turn?.loading);
  return {
    result: String(latestAssistant?.text || ''),
    meta: latestAssistant?.meta ? { ...DEFAULT_COVE_SEARCH_META, ...latestAssistant.meta } : DEFAULT_COVE_SEARCH_META,
    sources: Array.isArray(latestAssistant?.sources) ? latestAssistant.sources : []
  };
}

function buildIceServers() {
  const stunServers = [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    { urls: ['stun:stun.cloudflare.com:3478'] }
  ];

  const turnList = TURN_URLS
    .split(',')
    .map(url => url.trim())
    .filter(Boolean);

  if (!turnList.length) return stunServers;
  if (!TURN_USERNAME || !TURN_CREDENTIAL) {
    console.warn('TURN URLs are set but credentials are missing. Falling back to STUN only.');
    return stunServers;
  }

  return [
    ...stunServers,
    {
      urls: turnList,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL
    }
  ];
}

// PocketBase is initialized in lib/pb.js — no Firebase needed

// --- LOGO ASSETS ---
const ASSETS = {
  logoNameWhite: "https://image2url.com/r2/default/images/1771570949564-6a8ca126-3828-4831-bf4d-493a8ed1a79d.png",
  logoNameNavy: "https://image2url.com/r2/default/images/1771570906162-c46b7c5c-9712-4000-b415-352c3164645c.png",
  logoWhite: "https://image2url.com/r2/default/images/1771571038533-0c65d421-55c8-4b67-b411-a38c599a72b7.png",
  logoNavy: "https://image2url.com/r2/default/images/1771570994422-1886044a-26e3-4ab8-be8e-3e38f6b5af80.png",
  nameNavy: "https://image2url.com/r2/default/images/1771571151546-a24d9cc9-c4c4-4837-b2d5-e63cfafc2b4f.png"
};

export default function CoveApp() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [activeChat, setActiveChat] = useState(null);
  const [chats, setChats] = useState([]);
  const [userLookup, setUserLookup] = useState({});
  const [pendingInvites, setPendingInvites] = useState([]);
  const [messages, setMessages] = useState([]);
  const [darkMode, setDarkMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupEmails, setGroupEmails] = useState('');
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [addMemberEmail, setAddMemberEmail] = useState('');
  const groupPhotoInputRef = useRef(null);
  const [replyTo, setReplyTo] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [emojiTab, setEmojiTab] = useState('recommended'); // 'recents' | 'recommended' | 'all'
  const [recents, setRecents] = useState([]);
  const [allEmojiObjects, setAllEmojiObjects] = useState([]); // lazy-loaded full emoji list: {char, name}
  const [pendingAttachments, setPendingAttachments] = useState([]); // array of { file, previewUrl, fileType, uploadedUrl, attachmentId, fingerprint, shadowText, shadowStatus, deepShadowStatus, chatId }
  const [forwardItem, setForwardItem] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [mediaModal, setMediaModal] = useState(null); // { url, type }
  const messagesContainerRef = useRef(null);
  const [chatSearchExpanded, setChatSearchExpanded] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const chatMenuRef = useRef(null);
  const desktopChatSearchRef = useRef(null);
  const [showTopNavMenu, setShowTopNavMenu] = useState(false);
  const topNavMenuRef = useRef(null);
  const [messagesLimit, setMessagesLimit] = useState(15);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [optimisticMessages, setOptimisticMessages] = useState([]);
  const lastScrollPosRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  const isLoadingMoreRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [shadowMode, setShadowMode] = useState('full');
  const [deepShadowQueue, setDeepShadowQueue] = useState({});
  const [activeTab, setActiveTab] = useState('chats'); // 'chats' | 'search' | 'requests' | 'settings'
  const [toast, setToast] = useState(null); // { message, type }

  // --- PWA & FEATURE STATE ---
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showCreditWall, setShowCreditWall] = useState(false);
  const [creditsInfo, setCreditsInfo] = useState(null);
  const [showWhatsAppImport, setShowWhatsAppImport] = useState(false);
  const [waImportProgress, setWaImportProgress] = useState(null);
  const [showSyncMismatch, setShowSyncMismatch] = useState(null); // { chatName, chatId }
  const [aiStatus, setAiStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'generating' | 'error'
  const [aiProgress, setAiProgress] = useState(0);
  const [coveSearchTab, setCoveSearchTab] = useState('ask'); // 'ask' | 'settings'
  const [coveSearchInput, setCoveSearchInput] = useState('');
  const [coveSearchResult, setCoveSearchResult] = useState('');
  const [coveSearchSources, setCoveSearchSources] = useState([]);
  const [showCoveSources, setShowCoveSources] = useState(false);
  const [coveSearchHistory, setCoveSearchHistory] = useState([]); // [{id, role, text, meta, sources, createdAt}]
  const [coveSearchConversations, setCoveSearchConversations] = useState([]); // [{id, title, createdAt, updatedAt, history}]
  const [activeCoveSearchConversationId, setActiveCoveSearchConversationId] = useState(null);
  const [expandedSourceMessageIds, setExpandedSourceMessageIds] = useState(new Set());
  const [correctAnswerIds, setCorrectAnswerIds] = useState(new Set());
  const [showTechDiagnostics, setShowTechDiagnostics] = useState(false);
  const [settingsPasswordHash, setSettingsPasswordHash] = useState('');
  const [settingsPasswordInput, setSettingsPasswordInput] = useState('');
  const [settingsNewPassword, setSettingsNewPassword] = useState('');
  const [settingsConfirmPassword, setSettingsConfirmPassword] = useState('');
  const [pendingProtectedAction, setPendingProtectedAction] = useState(null); // 'reindex' | 'clearCache' | 'clearAll'
  const [settingsError, setSettingsError] = useState('');
  const [pendingSourceJump, setPendingSourceJump] = useState(null); // { chatId, messageId, snippet }
  const [coveSearchMeta, setCoveSearchMeta] = useState({
    confidence: 'unknown',
    qualityScore: 0,
    sourceCount: 0,
    fromCache: false,
    searchMs: 0
  });
  const [coveSearchRunning, setCoveSearchRunning] = useState(false);
  const [speedDemonDiag, setSpeedDemonDiag] = useState({
    totalSearches: 0,
    cacheHits: 0,
    cacheHitRate: 0,
    lastSearchMs: 0,
    avgSearchMs: 0,
    lastRetrievalCount: 0,
    shadowDocCount: 0,
    cacheEntryCount: 0,
    avgCacheQuality: 0,
    deepReady: 0,
    deepFailed: 0,
    deepProcessing: 0,
    deepQueued: 0,
    deepAvgMs: 0,
    deepRuns: 0,
    autoHeals: 0
  });
  const [isAiMode, setIsAiMode] = useState(false);
  const [chatsPage, setChatsPage] = useState(1);
  const [hasMoreChats, setHasMoreChats] = useState(true);
  const [isAppLoading, setIsAppLoading] = useState(true);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [visibleMessages, setVisibleMessages] = useState(new Set());
  const [prunedMessageIds, setPrunedMessageIds] = useState(new Set());
  const chatsLimit = 15;
  const whatsappInputRef = useRef(null);
  const indexedShadowIdsRef = useRef(new Set());
  const shadowModeRef = useRef('full');
  const deepShadowInFlightRef = useRef(new Set());
  const deepShadowQueueRef = useRef({});
  const coveSearchEndRef = useRef(null);
  const aiWarmupTimeoutRef = useRef(null);
  const aiInitPromiseRef = useRef(null);
  const coveSearchHydratedRef = useRef(false);
  const diagRef = useRef({
    totalSearches: 0,
    cacheHits: 0,
    totalSearchMs: 0,
    deepTotalMs: 0,
    deepRuns: 0,
    autoHeals: 0
  });

  // --- SKELETON UI COMPONENT ---
  const NeuralPulse = () => (
    <div className="flex flex-col gap-4 p-4 animate-pulse">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-white/5" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 bg-slate-200 dark:bg-white/5 rounded" />
            <div className="h-2 w-2/3 bg-slate-100 dark:bg-white/5 rounded opacity-50" />
          </div>
        </div>
      ))}
    </div>
  );

  // --- CALLING STATE ---
  const [call, setCall] = useState(null); // { id, type, caller, receiver, status, isIncoming }
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const pcRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const ringtoneRef = useRef(null);
  const dialtoneRef = useRef(null);
  const notificationShownRef = useRef(null);
  const unsubsRef = useRef([]); // Track listeners for cleanup
  const handledCallsRef = useRef(new Set()); // Track call IDs we've already interacted with
  const candidateQueueRef = useRef([]); // Queue candidates until remote description is set

  // Initialize sounds
  useEffect(() => {
    ringtoneRef.current = new Audio('https://assets.mixkit.co/active_storage/sfx/1359/1359-preview.mp3'); // A ringing sound
    ringtoneRef.current.loop = true;
    dialtoneRef.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3'); // A dialing sound
    dialtoneRef.current.loop = true;
  }, []);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const clearAiWarmupTimers = () => {
    if (aiWarmupTimeoutRef.current) {
      clearTimeout(aiWarmupTimeoutRef.current);
      aiWarmupTimeoutRef.current = null;
    }
  };

  const refreshSpeedDemonDiag = () => {
    const libStats = getSpeedDemonStats();
    const deepEntries = Object.values(deepShadowQueueRef.current || {});
    const deepReady = deepEntries.filter(e => e?.status === 'ready').length;
    const deepFailed = deepEntries.filter(e => e?.status === 'failed').length;
    const deepProcessing = deepEntries.filter(e => e?.status === 'processing').length;
    const deepQueued = deepEntries.filter(e => !e?.status || e?.status === 'idle').length;

    const totalSearches = diagRef.current.totalSearches || 0;
    const cacheHits = diagRef.current.cacheHits || 0;
    const totalSearchMs = diagRef.current.totalSearchMs || 0;
    const deepRuns = diagRef.current.deepRuns || 0;
    const deepTotalMs = diagRef.current.deepTotalMs || 0;
    const autoHeals = diagRef.current.autoHeals || 0;
    setSpeedDemonDiag(prev => ({
      ...prev,
      shadowDocCount: libStats.shadowDocCount,
      cacheEntryCount: libStats.cacheEntryCount,
      avgCacheQuality: libStats.avgCacheQuality || 0,
      totalSearches,
      cacheHits,
      cacheHitRate: totalSearches ? Math.round((cacheHits / totalSearches) * 100) : 0,
      avgSearchMs: totalSearches ? Math.round(totalSearchMs / totalSearches) : 0,
      deepReady,
      deepFailed,
      deepProcessing,
      deepQueued,
      deepAvgMs: deepRuns ? Math.round(deepTotalMs / deepRuns) : 0,
      deepRuns,
      autoHeals
    }));
  };

  const extractMessageIdFromDoc = (docId, chatId) => {
    const id = String(docId || '');
    const cid = String(chatId || '');
    const prefix = `${cid}:`;
    if (!id.startsWith(prefix)) return '';
    return id.slice(prefix.length);
  };

  const hashString = async (value = '') => {
    const enc = new TextEncoder().encode(String(value));
    if (window?.crypto?.subtle) {
      const buf = await window.crypto.subtle.digest('SHA-256', enc);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0;
    for (let i = 0; i < value.length; i++) h = ((h << 5) - h) + value.charCodeAt(i);
    return String(h);
  };

  const hydrateCoveConversation = useCallback((conversationId) => {
    const target = (coveSearchConversations || []).find((conv) => conv.id === conversationId);
    if (!target) return;
    const history = Array.isArray(target.history) ? target.history : [];
    const snapshot = getCoveConversationSnapshot(history);
    setActiveCoveSearchConversationId(target.id);
    setCoveSearchHistory(history);
    setCoveSearchResult(snapshot.result);
    setCoveSearchMeta(snapshot.meta);
    setCoveSearchSources(snapshot.sources);
    setShowCoveSources(false);
    setExpandedSourceMessageIds(new Set());
    setCorrectAnswerIds(new Set());
    setCoveSearchTab('ask');
  }, [coveSearchConversations]);

  const startNewCoveSearchConversation = useCallback(() => {
    const now = Date.now();
    const id = `cove_conv_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const conversation = {
      id,
      title: 'New Chat',
      createdAt: now,
      updatedAt: now,
      history: []
    };
    setCoveSearchConversations((prev) => [conversation, ...prev]);
    setActiveCoveSearchConversationId(id);
    setCoveSearchHistory([]);
    setCoveSearchSources([]);
    setShowCoveSources(false);
    setExpandedSourceMessageIds(new Set());
    setCorrectAnswerIds(new Set());
    setCoveSearchResult('');
    setCoveSearchMeta(DEFAULT_COVE_SEARCH_META);
    return id;
  }, []);

  useEffect(() => {
    let canceled = false;
    const hydrate = async () => {
      const emailLow = String(userData?.email || '').toLowerCase().trim();
      const userKey = getCoveSearchPersistenceKey(emailLow);
      const globalKey = getCoveSearchPersistenceKey('');

      const readPayload = async (key) => {
        try {
          const idbPayload = await getLocalKV(key);
          if (idbPayload && typeof idbPayload === 'object') return idbPayload;
        } catch (e) { }
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : null;
        } catch (e) {
          return null;
        }
      };

      const parsed = (await readPayload(userKey)) || (emailLow ? await readPayload(globalKey) : null);
      const rawConversations = Array.isArray(parsed?.conversations) ? parsed.conversations : [];
      const normalized = rawConversations
        .filter((conv) => conv && conv.id)
        .map((conv) => ({
          id: String(conv.id),
          title: String(conv.title || 'New Chat'),
          createdAt: Number(conv.createdAt || Date.now()),
          updatedAt: Number(conv.updatedAt || conv.createdAt || Date.now()),
          history: Array.isArray(conv.history) ? conv.history : []
        }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      if (canceled) return;
      if (!normalized.length) {
        coveSearchHydratedRef.current = true;
        setCoveSearchConversations([]);
        setActiveCoveSearchConversationId(null);
        setCoveSearchHistory([]);
        setCoveSearchResult('');
        setCoveSearchSources([]);
        setCoveSearchMeta(DEFAULT_COVE_SEARCH_META);
        return;
      }

      const savedActiveId = String(parsed?.activeConversationId || '');
      const activeConversation = normalized.find((conv) => conv.id === savedActiveId) || normalized[0] || null;
      const history = activeConversation?.history || [];
      const snapshot = getCoveConversationSnapshot(history);
      coveSearchHydratedRef.current = true;
      setCoveSearchConversations(normalized);
      setActiveCoveSearchConversationId(activeConversation?.id || null);
      setCoveSearchHistory(history);
      setCoveSearchResult(snapshot.result);
      setCoveSearchMeta(snapshot.meta);
      setCoveSearchSources(snapshot.sources);
      setShowCoveSources(false);
      setExpandedSourceMessageIds(new Set());
      setCorrectAnswerIds(new Set());
    };
    hydrate();
    return () => {
      canceled = true;
    };
  }, [userData?.email]);

  useEffect(() => {
    if (!coveSearchHydratedRef.current) return;
    const emailLow = String(userData?.email || '').toLowerCase().trim();
    const storageKey = getCoveSearchPersistenceKey(emailLow);
    const payload = {
      conversations: (Array.isArray(coveSearchConversations) ? coveSearchConversations : []).slice(0, 120),
      activeConversationId: activeCoveSearchConversationId || null
    };
    const persist = async () => {
      try { await setLocalKV(storageKey, payload); } catch (e) { }
      try { await setLocalKV(COVE_SEARCH_CONVERSATIONS_GLOBAL_KEY, payload); } catch (e) { }
      try { localStorage.setItem(storageKey, JSON.stringify(payload)); } catch (e) { }
      try { localStorage.setItem(COVE_SEARCH_CONVERSATIONS_GLOBAL_KEY, JSON.stringify(payload)); } catch (e) { }
    };
    persist();
  }, [coveSearchConversations, activeCoveSearchConversationId, userData?.email]);

  useEffect(() => {
    if (!activeCoveSearchConversationId) return;
    setCoveSearchConversations((prev) => {
      const now = Date.now();
      const idx = prev.findIndex((conv) => conv.id === activeCoveSearchConversationId);
      if (idx < 0) {
        const created = {
          id: activeCoveSearchConversationId,
          title: getCoveConversationTitle(coveSearchHistory),
          createdAt: now,
          updatedAt: now,
          history: coveSearchHistory
        };
        return [created, ...prev];
      }
      const current = prev[idx];
      const updated = {
        ...current,
        title: getCoveConversationTitle(coveSearchHistory),
        updatedAt: now,
        history: coveSearchHistory
      };
      const next = prev.map((conv, index) => (index === idx ? updated : conv));
      next.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return next;
    });
  }, [coveSearchHistory, activeCoveSearchConversationId]);

  const openProtectedAction = (action) => {
    setPendingProtectedAction(action);
    setSettingsPasswordInput('');
    setSettingsError('');
  };

  const saveCoveSearchSettingsPassword = async () => {
    if (!settingsNewPassword || settingsNewPassword.length < 4) {
      setSettingsError('Use at least 4 characters.');
      return;
    }
    if (settingsNewPassword !== settingsConfirmPassword) {
      setSettingsError('Passwords do not match.');
      return;
    }
    const hash = await hashString(settingsNewPassword);
    setSettingsPasswordHash(hash);
    try { localStorage.setItem(COVE_SEARCH_SETTINGS_PW_KEY, hash); } catch (e) { }
    setSettingsNewPassword('');
    setSettingsConfirmPassword('');
    setSettingsError('');
    showToast('Cove Search settings password saved', 'success');
  };

  const runProtectedAction = async () => {
    if (!pendingProtectedAction) return;
    if (!settingsPasswordHash) {
      setSettingsError('Set a Cove Search settings password first.');
      return;
    }
    const providedHash = await hashString(settingsPasswordInput);
    if (providedHash !== settingsPasswordHash) {
      setSettingsError('Incorrect password.');
      return;
    }
    const action = pendingProtectedAction;
    setPendingProtectedAction(null);
    setSettingsPasswordInput('');
    setSettingsError('');
    if (action === 'reindex') reindexCurrentChat();
    if (action === 'clearCache') clearSpeedDemonCacheOnly();
    if (action === 'clearAll') clearSpeedDemonAll();
  };

  useEffect(() => {
    try {
      const hash = localStorage.getItem(COVE_SEARCH_SETTINGS_PW_KEY) || '';
      setSettingsPasswordHash(hash);
    } catch (e) { }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(event.target)) {
        setShowChatMenu(false);
      }
      const isInsideTopNav = topNavMenuRef.current && topNavMenuRef.current.contains(event.target);
      const isInsideDesktopChatSearch = desktopChatSearchRef.current && desktopChatSearchRef.current.contains(event.target);
      if (!isInsideTopNav && !isInsideDesktopChatSearch) {
        setShowTopNavMenu(false);
        setChatSearchExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    const checkSize = () => {
      setIsMobile(window.innerWidth < 1024);
      // Use visualViewport when available to keep fixed layout stable on mobile keyboard open/close.
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      let vh = viewportHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);

      const rawKeyboardOffset = window.visualViewport
        ? Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop)
        : 0;
      setKeyboardOffset(rawKeyboardOffset > 100 ? rawKeyboardOffset : 0);
    };
    checkSize();
    window.addEventListener('resize', checkSize);
    window.visualViewport?.addEventListener('resize', checkSize);
    window.visualViewport?.addEventListener('scroll', checkSize);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener('resize', checkSize);
      window.visualViewport?.removeEventListener('resize', checkSize);
      window.visualViewport?.removeEventListener('scroll', checkSize);
    };
  }, []);

  useEffect(() => {
    shadowModeRef.current = shadowMode;
  }, [shadowMode]);

  useEffect(() => () => clearAiWarmupTimers(), []);

  useEffect(() => {
    deepShadowQueueRef.current = deepShadowQueue || {};
    try {
      localStorage.setItem(DEEP_SHADOW_QUEUE_KEY, JSON.stringify(deepShadowQueue || {}));
    } catch (e) { }
  }, [deepShadowQueue]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DEEP_SHADOW_QUEUE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        setDeepShadowQueue(parsed);
      }
    } catch (e) { }
  }, []);

  useEffect(() => {
    refreshSpeedDemonDiag();
  }, [deepShadowQueue, pendingAttachments.length, activeTab]);

  useEffect(() => {
    let battery = null;
    let detached = false;

    const applyBatteryProfile = () => {
      if (!battery || detached) return;
      const nextMode = (!battery.charging && battery.level <= 0.35) ? 'lite' : 'full';
      setShadowMode(nextMode);
    };

    if (!navigator?.getBattery) {
      setShadowMode('full');
      return;
    }

    navigator.getBattery().then((bat) => {
      if (detached) return;
      battery = bat;
      applyBatteryProfile();
      battery.addEventListener('levelchange', applyBatteryProfile);
      battery.addEventListener('chargingchange', applyBatteryProfile);
    }).catch(() => setShadowMode('full'));

    return () => {
      detached = true;
      if (battery) {
        battery.removeEventListener('levelchange', applyBatteryProfile);
        battery.removeEventListener('chargingchange', applyBatteryProfile);
      }
    };
  }, []);

  // --- SERVICE WORKER & PWA ---
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('Service Worker registered:', reg.scope);
      }).catch(err => console.warn('SW registration failed:', err));
    }

    // Capture PWA install prompt
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Initialize credits
    const ci = initCredits();
    setCreditsInfo(getCreditsInfo());

    // Run 12-hour sync check
    if (WORKER_URL) {
      checkAndRunSync(WORKER_URL, STORAGE_UPLOAD_TOKEN).catch(err => console.warn('Sync check failed:', err));
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const installPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      showToast('Cove installed to your home screen!', 'success');
    }
    setDeferredPrompt(null);
  };

  // --- WHATSAPP IMPORTER ---
  const handleWhatsAppImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeChat) return;
    setWaImportProgress('reading');

    try {
      const text = await file.text();
      const parsed = parseWhatsAppChat(text);
      setWaImportProgress(`parsed ${parsed.length} messages`);

      const coveMessages = convertToCoveMessages(parsed, activeChat.id, userData.email);

      // Batch upload to PocketBase
      let uploaded = 0;
      for (const msg of coveMessages) {
        await pb.collection('messages').create(msg);
        uploaded++;
        if (uploaded % 10 === 0) {
          setWaImportProgress(`${uploaded}/${coveMessages.length} imported`);
        }
      }

      // Update last message on contact
      if (coveMessages.length > 0) {
        const lastMsg = coveMessages[coveMessages.length - 1];
        await pb.collection('contacts').update(activeChat.id, {
          lastMessage: lastMsg.text?.substring(0, 100) || 'Imported messages',
          lastSender: userData.email
        });
      }

      setWaImportProgress(null);
      setShowWhatsAppImport(false);
      showToast(`Successfully imported ${coveMessages.length} messages!`, 'success');
    } catch (err) {
      console.error('WhatsApp import failed:', err);
      setWaImportProgress(null);
      showToast('Import failed: ' + err.message, 'error');
    }
    if (e.target) e.target.value = '';
  };

  const loadAI = () => {
    if (aiStatus !== 'idle' && aiStatus !== 'error') return;
    clearAiWarmupTimers();
    setAiStatus('loading');
    setAiProgress(0);
    aiWarmupTimeoutRef.current = setTimeout(() => {
      setAiStatus('error');
      showToast('AI setup timed out. Refresh and try again.', 'error');
      clearAiWarmupTimers();
    }, 4 * 60 * 1000);
    initAI(
      (data) => {
        const rawProgress = (() => {
          if (data?.status === 'done' || data?.status === 'ready') return 1;
          if (typeof data?.progress === 'number') return data.progress;
          if (typeof data?.percentage === 'number') return data.percentage / 100;
          if (typeof data?.percent === 'number') return data.percent / 100;
          if (typeof data?.value === 'number') return data.value;
          if (typeof data?.progress === 'object') {
            const p = data.progress;
            if (typeof p?.value === 'number') return p.value;
            if (typeof p?.percentage === 'number') return p.percentage / 100;
            if (typeof p?.loaded === 'number' && typeof p?.total === 'number' && p.total > 0) {
              return p.loaded / p.total;
            }
          }
          if (typeof data?.loaded === 'number' && typeof data?.total === 'number' && data.total > 0) {
            return data.loaded / data.total;
          }
          if (typeof data === 'number') return data;
          return null;
        })();
        if (rawProgress == null) return;
        const normalized = rawProgress > 1 ? rawProgress / 100 : rawProgress;
        const clamped = Math.max(0, Math.min(0.99, normalized));
        setAiProgress(clamped);
      },
      () => {
        clearAiWarmupTimers();
        setAiProgress(1);
        setAiStatus('ready');
        showToast('Neural Link Established: Local AI Ready', 'success');
      },
      (errMsg) => {
        clearAiWarmupTimers();
        setAiStatus('error');
        showToast(`AI init failed: ${errMsg || 'unknown error'}`, 'error');
      }
    );
  };

  const ensureAiReady = async () => {
    if (aiStatus === 'ready') return;
    if (aiInitPromiseRef.current) {
      await aiInitPromiseRef.current;
      return;
    }
    aiInitPromiseRef.current = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        aiInitPromiseRef.current = null;
        reject(new Error('AI model initialization timed out.'));
      }, 60000);
      initAI(
        (data) => {
          const rawProgress = (() => {
            if (data?.status === 'done' || data?.status === 'ready') return 1;
            if (typeof data?.progress === 'number') return data.progress;
            if (typeof data?.percentage === 'number') return data.percentage / 100;
            if (typeof data?.loaded === 'number' && typeof data?.total === 'number' && data.total > 0) return data.loaded / data.total;
            if (typeof data === 'number') return data;
            return null;
          })();
          if (rawProgress != null) {
            const clamped = Math.max(0, Math.min(0.99, rawProgress > 1 ? rawProgress / 100 : rawProgress));
            setAiProgress(clamped);
          }
        },
        () => {
          clearTimeout(timeout);
          clearAiWarmupTimers();
          setAiProgress(1);
          setAiStatus('ready');
          aiInitPromiseRef.current = null;
          resolve();
        },
        (errMsg) => {
          clearTimeout(timeout);
          clearAiWarmupTimers();
          setAiStatus('error');
          aiInitPromiseRef.current = null;
          reject(new Error(errMsg || 'AI init failed'));
        }
      );
      setAiStatus('loading');
      setAiProgress(0);
    });
    await aiInitPromiseRef.current;
  };

  const handleAISuggestion = async () => {
    if (aiStatus === 'idle') {
      loadAI();
      return;
    }
    if (aiStatus !== 'ready') return;
    if (!hasCredits()) {
      setShowCreditWall(true);
      return;
    }

    setAiStatus('generating');
    try {
      // Get last few messages for context
      const contextMessages = messages.slice(-5).map(m => ({
        role: m.senderEmail === userData.email ? 'user' : 'assistant',
        content: m.text
      }));

      if (contextMessages.length === 0) {
        contextMessages.push({ role: 'user', content: 'Hello' });
      }

      const response = await generateAIResponse(contextMessages);

      // Auto-fill composer with suggestion.
      setMessageInput(response.text);
      handleAIConsumption(response.tokens);
      setCreditsInfo(getCreditsInfo());
    } catch (err) {
      if (err.message === 'NO_CREDITS') setShowCreditWall(true);
      else showToast('AI Error: ' + err.message, 'error');
    } finally {
      setAiStatus('ready');
    }
  };

  const NOISY_SHADOW_PATTERNS = [
    'ocr pending enhanced extraction',
    'deferred for battery saver',
    'queued for on-device asr',
    'first 60s retrieval context prioritized',
    'lite mode: metadata indexed now',
    'file shadow (',
    'image shadow (',
    'audio shadow (',
    'video shadow (',
    'confidence:',
    'sources:',
    'hide sources',
    'translation:',
    'can you please',
    'retrieval assistant',
    'speed demon 1.0'
  ];
  const BAD_ANSWER_PATTERNS = [
    'low confidence: limited relevant local context was found',
    'why are you asking me',
    'such? what do? when? why?',
    'to change the context according to the input',
    'remember, the system always reads your input word-for-word',
    'use the context when relevant'
  ];

  const cleanSnippetText = (value = '') => {
    let text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    text = text
      .replace(/\[source\s*\d+\]/ig, '')
      .replace(/question:\s*/ig, '')
      .replace(/retrieved local context:\s*/ig, '')
      .replace(/use the context when relevant\.?/ig, '')
      .replace(/verify before acting\.?/ig, '')
      .replace(/confidence:\s*\w+/ig, '')
      .replace(/sources:\s*\d+/ig, '')
      .replace(/hide sources/ig, '')
      .replace(/translation:\s*/ig, '')
      .replace(/speaker self aliases:\s*[^.]+/ig, '')
      .replace(/speaker aliases:\s*[^.]+/ig, '')
      .replace(/speaker:\s*[^.]+/ig, '')
      .replace(/account holder:\s*[^.]+/ig, '')
      .replace(/counterpart:\s*[^.]+/ig, '')
      .replace(/first person refers to(?: speaker)?:\s*[^.]+/ig, '')
      .replace(/first person refers to account holder:\s*[^.]+/ig, '')
      .replace(/second person refers to(?: user| counterpart)?:\s*[^.]+/ig, '')
      .replace(/context:\s*[a-z0-9_]+['']s\s+[^.]+\./ig, '')
      .replace(/context for neutral pronouns\s*\(it\/this\/that\):\s*[^.]+\.?/ig, '')
      .replace(/\bhttps?:\/\/\S+\b/ig, '')
      .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/ig, '')
      .replace(/\b[a-z0-9-]+\.(com|net|org|io|co|app|dev|ai)\b/ig, '')
      .replace(/\b([a-z0-9_]{3,})(?:\s+\1){2,}\b/ig, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const banned = [
      /^question:/i,
      /^use the context when relevant/i,
      /^remember, the system/i,
      /^to change the context/i
    ];
    if (banned.some((rx) => rx.test(text))) return '';
    return text;
  };

  const isBadAnswerText = (value = '') => {
    const t = String(value || '').toLowerCase();
    if (!t) return true;
    return BAD_ANSWER_PATTERNS.some((p) => t.includes(p));
  };

  const isProfessionalAnswerText = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return false;
    if (text.length > 260) return false;
    if (/\n/.test(text)) return false;
    if (/\bi don'?t believe\b/i.test(text)) return false;
    if (/speed[- ]?demon\s*1\.0/i.test(text)) return false;
    if (/local-first retrieval assistant/i.test(text)) return false;
    return true;
  };

  const userExplicitlyWantsQuestion = (query = '') => {
    const q = String(query || '').toLowerCase();
    return /\b(ask\s+a\s+question|give\s+me\s+a\s+question|pose\s+a\s+question)\b/.test(q);
  };

  const AMBIGUOUS_REFERENCE_REGEX = /\b(he|she|they|them|their|his|her|it|its|this|that|these|those|first person|second person|mother|father|son|daughter|brother|sister|parent|child)\b/i;

  const extractEntityAnchors = (value = '') => {
    const text = String(value || '');
    if (!text) return [];
    const proper = text.match(/\b[A-Z][a-z]{2,}\b/g) || [];
    const tags = text.match(/\b[a-z][a-z0-9_]{2,}\b/gi) || [];
    const relationTerms = tags.filter((t) => /\b(mother|father|son|daughter|brother|sister|parent|child|husband|wife)\b/i.test(t));
    return Array.from(new Set([...proper, ...relationTerms].map((t) => t.trim()).filter((t) => t.length >= 3))).slice(0, 8);
  };

  /**
   * Resolve pronouns and references from conversation history.
   * "is he also a firefighter?" → "is Steven also a firefighter?"
   * "and is that friend Steven?" → "and is Steve's friend Steven?"
   * Returns { resolved: string, subject: string|null, anchors: string[] }
   */
  const resolveConversationReferences = (prompt, history = []) => {
    const base = String(prompt || '').trim();
    const recentTurns = (Array.isArray(history) ? history : [])
      .filter((turn) => turn && !turn.loading && String(turn.text || '').trim())
      .slice(-10);

    // Collect all named entities from recent turns (most recent first)
    const entities = [];
    for (const turn of [...recentTurns].reverse()) {
      const text = String(turn.text || '');
      const names = text.match(/\b[A-Z][a-z]{2,}\b/g) || [];
      for (const name of names) {
        if (!entities.includes(name) && !['From', 'Profile', 'Source', 'FACT', 'Context', 'Steve\'s', 'The'].includes(name)) {
          entities.push(name);
        }
      }
      if (Array.isArray(turn.sources)) {
        for (const src of turn.sources.slice(0, 3)) {
          const srcNames = String(src?.snippet || '').match(/\b[A-Z][a-z]{2,}\b/g) || [];
          for (const name of srcNames) {
            if (!entities.includes(name) && !['From', 'Profile', 'Source', 'FACT', 'Context', 'The'].includes(name)) {
              entities.push(name);
            }
          }
        }
      }
    }

    // Find the most recent subject being discussed
    // Look at last assistant answer for the primary subject
    const lastAssistant = [...recentTurns].reverse().find(t => t.role === 'assistant');
    const lastAssistantText = String(lastAssistant?.text || '');

    // Extract the primary subject from the last answer
    // The subject is typically: the entity the answer is ABOUT, not just any entity mentioned
    let primarySubject = null;
    if (lastAssistantText) {
      const answerEntities = (lastAssistantText.match(/\b[A-Z][a-z]{2,}\b/g) || [])
        .filter(n => !['From', 'Profile', 'Source', 'FACT', 'Context', 'The', 'VERIFIED', 'Yes', 'No', 'His', 'Her', 'Based'].includes(n));
      // Check for "X's friend" pattern — the reference is the subject
      const refMatch = lastAssistantText.match(/([A-Z][a-z]+)'s\s+\w+\s+\(([A-Z][a-z]+)\)/);
      if (refMatch) {
        // "Steve's friend (Steven)" → subject is Steven
        primarySubject = refMatch[2];
      } else if (answerEntities.length > 0) {
        // First entity in the answer is usually the subject
        primarySubject = answerEntities[0];
      }
    }
    // Also check: if the last user question asked about someone, carry that forward
    if (!primarySubject) {
      const lastUserTurn = [...recentTurns].reverse().find(t => t.role === 'user');
      const lastUserText = String(lastUserTurn?.text || '');
      const userEntities = (lastUserText.match(/\b[A-Z][a-z]{2,}\b/g) || [])
        .filter(n => !['Which', 'What', 'Who', 'Where', 'When', 'How', 'The', 'Does', 'Has'].includes(n));
      if (userEntities.length > 0) primarySubject = userEntities[0];
    }

    // Resolve pronouns in the query
    let resolved = base;
    const pronounTarget = primarySubject || entities[0] || null;
    if (pronounTarget) {
      // Replace "he/she/they/him/her/them" with the subject
      resolved = resolved.replace(/\b(he|she|him|her|they|them)\b/gi, pronounTarget);
      // Replace "that friend/that person/that one" with subject
      resolved = resolved.replace(/\b(that\s+(?:friend|person|one))\b/gi, pronounTarget);
    }

    return {
      resolved,
      subject: pronounTarget,
      anchors: entities.slice(0, 6)
    };
  };

  const buildReasoningRetrievalQuery = (prompt, history = []) => {
    const base = String(prompt || '').trim();
    if (!base) return '';
    const needsContext = AMBIGUOUS_REFERENCE_REGEX.test(base);
    if (!needsContext) return base;

    const { resolved, anchors } = resolveConversationReferences(prompt, history);
    if (anchors.length) {
      return `${resolved}\nContext anchors: ${anchors.join(', ')}`;
    }
    return resolved;
  };

  const mergeReasoningResults = (a = [], b = [], limit = 10) => {
    const byId = new Map();
    const merged = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
    for (const item of merged) {
      const id = String(item?.id || '');
      if (!id) continue;
      const prev = byId.get(id);
      if (!prev || Number(item.score || 0) > Number(prev.score || 0)) {
        byId.set(id, item);
      }
    }
    return Array.from(byId.values())
      .sort((x, y) => Number(y.score || 0) - Number(x.score || 0) || Number(y.ts || 0) - Number(x.ts || 0))
      .slice(0, limit);
  };

  const enforceStatementTone = (query = '', value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (userExplicitlyWantsQuestion(query)) return raw;
    let out = raw
      .replace(/\?/g, '.')
      .replace(/\b(can you|could you|would you|do you|are you)\b/ig, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!out) return '';
    if (!/[.!]$/.test(out)) out = `${out}.`;
    return out;
  };

  const sanitizeRetrievalResults = (query, results = []) => {
    const q = String(query || '').toLowerCase();
    const asksAboutMedia = /(ocr|image|audio|video|pdf|file|transcript)/i.test(q);
    return (Array.isArray(results) ? results : []).filter((item) => {
      const snippet = String(item?.snippet || item?.text || '').toLowerCase();
      if (!snippet) return false;
      if (asksAboutMedia) return true;
      return !NOISY_SHADOW_PATTERNS.some((pat) => snippet.includes(pat));
    });
  };

  const tryExtractDirectFactAnswer = (query, results = [], opts = {}) => {
    const q = String(query || '').toLowerCase();
    const list = Array.isArray(results) ? results : [];
    const withMeta = !!opts.withMeta;
    const makeReturn = (text = '', doc = null) => {
      if (!text) return withMeta ? { text: '', confidence: null, docId: null } : '';
      const confidence = doc && Number(doc.confidence) > 0 ? Number(doc.confidence) : null;
      const docId = doc?.id || null;
      return withMeta ? { text, confidence, docId } : text;
    };

    if (!list.length) return makeReturn('', null);
    const queryTerms = q
      .split(/[^a-z0-9_]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3);
    const queryHasConflictSignal = /\b(actually|correct|latest|current|real|true|not)\b/i.test(q);
    const queryHasColorIntent = /\bcolor|colour\b/i.test(q);
    const queryAsksFavoriteColor = /\bfavo(?:u)?rite\s+colou?r\b/i.test(q);
    const colorRegex = /\b(black|white|gray|grey|red|blue|green|yellow|orange|purple|pink|brown|teal|cyan|magenta|maroon|navy|gold|silver)\b/i;

    const factual = list
      .map((r) => {
        const raw = String(r?.snippet || r?.text || '');
        // Strip FACT: prefix for display, but track that it's a fact doc
        const isFactDoc = raw.startsWith('FACT:') || r.source === 'fact';
        const isEntityDoc = r.source === 'entity-profile';
        const displayText = raw.replace(/^FACT:\s*/i, '').replace(/^CORRECTION:\s*/i, '');
        return {
          ...r,
          raw,
          clean: cleanSnippetText(displayText),
          isFactDoc,
          isEntityDoc
        };
      })
      .filter((r) => r.clean && !/\?/.test(r.clean));

    if (!factual.length) return makeReturn('', null);

    // Priority: if there are fact or entity-profile docs, prefer those
    // But ONLY if the query directly names the entity (not pronouns like "which one")
    const queryHasPronouns = /\b(which\s+one|they|them|he|she|it|his|her|its)\b/i.test(q);
    if (!queryHasPronouns) {
      const factDocs = factual.filter(r => r.isFactDoc || r.isEntityDoc);
      if (factDocs.length > 0) {
        // Require at least 60% of meaningful query terms to appear in the fact doc
        const meaningfulTerms = queryTerms.filter(t => t.length >= 3 && !['who', 'what', 'where', 'when', 'how', 'the', 'does', 'did', 'was', 'has', 'have', 'from', 'your', 'chat', 'chats'].includes(t));
        const bestFact = factDocs.find(r => {
          const low = r.clean.toLowerCase();
          const hits = meaningfulTerms.filter(t => low.includes(t)).length;
          return meaningfulTerms.length > 0 && hits >= Math.max(1, Math.ceil(meaningfulTerms.length * 0.6));
        });
        if (bestFact) {
          return makeReturn(`From your chats: ${bestFact.clean}`, bestFact);
        }
      }
    }

    const newestTs = factual.reduce((max, r) => Math.max(max, Number(r.ts || 0)), 0) || Date.now();
    const ranked = factual.map((r) => {
      const low = r.clean.toLowerCase();
      const termHits = queryTerms.filter((t) => low.includes(t)).length;
      const termCoverage = queryTerms.length ? termHits / queryTerms.length : 0;
      const recency = Math.max(0, 1 - ((newestTs - Number(r.ts || 0)) / (1000 * 60 * 60 * 24 * 14)));
      const correctionBoost = /\b(actually|correction|update|sorry|i mean|not)\b/.test(low) ? 1 : 0;
      const colorAnswerBoost = queryHasColorIntent && colorRegex.test(low) ? 1 : 0;
      const domainNoisePenalty = /\b[a-z0-9-]+\.(com|net|org|io|co|app|dev|ai)\b/.test(low) ? 1 : 0;
      const tooLongPenalty = low.length > 210 ? 1 : 0;
      const uncertaintyPenalty = /\b(either|or|can'?t remember|cannot remember|not sure|maybe|i think|probably|guess)\b/.test(low) ? 1 : 0;
      const explicitFavoriteColorClaim = /\bfavo(?:u)?rite\s+colou?r\s+(?:is|was|now)\b/.test(low) ? 1 : 0;
      const actuallyColorClaim = /\bactually\b[\s\w,'-]{0,40}\b(black|white|gray|grey|red|blue|green|yellow|orange|purple|pink|brown|teal|cyan|magenta|maroon|navy|gold|silver)\b/.test(low) ? 1 : 0;
      const factDocBoost = r.isFactDoc ? 0.15 : r.isEntityDoc ? 0.12 : 0;
      const score =
        (0.5 * Number(r.score || 0)) +
        (0.20 * termCoverage) +
        (0.12 * recency) +
        ((queryHasConflictSignal ? 0.13 : 0.06) * correctionBoost) +
        (0.08 * colorAnswerBoost) +
        factDocBoost -
        (0.24 * uncertaintyPenalty) -
        (0.12 * domainNoisePenalty) -
        (0.08 * tooLongPenalty) +
        ((queryAsksFavoriteColor ? 0.08 : 0) * explicitFavoriteColorClaim) +
        ((queryAsksFavoriteColor ? 0.18 : 0.04) * actuallyColorClaim);
      return {
        ...r,
        score2: score,
        termCoverage,
        correctionBoost,
        domainNoisePenalty,
        uncertaintyPenalty,
        colorAnswerBoost,
        explicitFavoriteColorClaim,
        actuallyColorClaim
      };
    });

    // Prefer explicit correction color claims over uncertain alternatives for favorite-color queries.
    if (queryAsksFavoriteColor) {
      const correctionCandidates = ranked.filter((r) =>
        r.colorAnswerBoost &&
        (r.actuallyColorClaim || r.correctionBoost) &&
        !r.uncertaintyPenalty
      );
      if (correctionCandidates.length > 0) {
        correctionCandidates.sort((a, b) =>
          (b.score2 - a.score2) ||
          (Number(b.ts || 0) - Number(a.ts || 0)) ||
          (Number(b.score || 0) - Number(a.score || 0))
        );
        return `From your chats: ${correctionCandidates[0].clean}`;
      }
    }

    ranked.sort((a, b) => b.score2 - a.score2);
    if (!ranked.length) return makeReturn('', null);
    const best = ranked[0];

    // Require at least minimal query-term grounding for generic queries.
    if (best.termCoverage < 0.2 && Number(best.score || 0) < 0.3 && !best.correctionBoost) return makeReturn('', null);

    return makeReturn(`From your chats: ${best.clean}`, best);
  };

  const normalizeAnswerForDisplay = (query, answer, sources = []) => {
    const raw = String(answer || '').trim();
    const fallback = tryExtractDirectFactAnswer(query, sources);
    if (!raw) return enforceStatementTone(query, fallback || 'I could not find a reliable answer in your local chats.');
    if (isBadAnswerText(raw)) return enforceStatementTone(query, fallback || 'I could not find a reliable answer in your local chats.');
    if (/retrieved local context|question:|source\s*\d+/i.test(raw)) return enforceStatementTone(query, fallback || 'I could not find a reliable answer in your local chats.');
    if (!isProfessionalAnswerText(raw)) return enforceStatementTone(query, fallback || raw.split('\n')[0].trim());
    return enforceStatementTone(query, raw);
  };

  const finalizeCoveAnswer = (query, answer, sources = []) => {
    const fallback = tryExtractDirectFactAnswer(query, sources) || 'I could not find a reliable answer in your local chats.';
    let text = String(answer || '').trim();
    if (!text) return enforceStatementTone(query, fallback);

    text = text
      .replace(/low confidence:[^.\n]*\.?/ig, ' ')
      .replace(/question:\s*/ig, ' ')
      .replace(/retrieved local context:\s*/ig, ' ')
      .replace(/context retrieving:\s*/ig, ' ')
      .replace(/translation:\s*/ig, ' ')
      .replace(/\[source\s*\d+\]/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const toxicPatterns = [
      /retriever is a machine learning system/i,
      /context when relevant/i,
      /speed demon 1\.0/i,
      /local-first retrieval assistant/i,
      /private chat data/i
    ];
    if (toxicPatterns.some((rx) => rx.test(text))) {
      return enforceStatementTone(query, fallback);
    }

    if (!userExplicitlyWantsQuestion(query) && /^\s*(what|why|how|when|where|who|whom|whose|which|can|could|would|do|does|did|is|are|am|should)\b/i.test(text)) {
      return enforceStatementTone(query, fallback);
    }

    const firstSentence = text.split(/(?<=[.!])\s+/)[0] || text;
    const compact = firstSentence.trim().slice(0, 220);
    const safe = normalizeAnswerForDisplay(query, compact, sources);
    return enforceStatementTone(query, safe || fallback);
  };

  const runCoveSearch = async () => {
    const prompt = coveSearchInput.trim();
    if (!prompt || coveSearchRunning) return;
    if (!activeCoveSearchConversationId) {
      startNewCoveSearchConversation();
    }
    const userTurnId = `cove_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const assistantTurnId = `cove_a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const pushTurn = (turn) => setCoveSearchHistory((prev) => [...prev, turn]);
    const patchTurn = (id, patch) => {
      setCoveSearchHistory((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    };

    pushTurn({
      id: userTurnId,
      role: 'user',
      text: prompt,
      createdAt: Date.now()
    });
    pushTurn({
      id: assistantTurnId,
      role: 'assistant',
      text: 'Thinking...',
      loading: true,
      createdAt: Date.now()
    });
    setCoveSearchInput('');
    const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    diagRef.current.totalSearches += 1;

    const cached = getLibraryAnswer(prompt);
    const cachedSources = Array.isArray(cached?.topSnippets) ? cached.topSnippets.filter((s) => String(s?.snippet || '').trim()) : [];
    const cachedQuality = Number(cached?.qualityScore || 0);
    const allowCachedHit =
      !!cached?.answer &&
      !isBadAnswerText(cached.answer) &&
      isProfessionalAnswerText(cached.answer) &&
      cachedSources.length > 0 &&
      cachedQuality >= 0.45;
    if (allowCachedHit) {
      const elapsed = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - startedAt);
      diagRef.current.cacheHits += 1;
      diagRef.current.totalSearchMs += elapsed;
      const finalCachedAnswer = cached.answer;
      setCoveSearchResult(finalCachedAnswer);
      setCoveSearchMeta({
        confidence: cachedQuality >= 0.72 ? 'high' : cachedQuality >= 0.45 ? 'medium' : 'low',
        qualityScore: cachedQuality,
        sourceCount: Number(cached.sourceCount || 0),
        fromCache: true,
        searchMs: elapsed
      });
      setCoveSearchSources(cachedSources);
      setShowCoveSources(false);
      patchTurn(assistantTurnId, {
        text: finalCachedAnswer,
        loading: false,
        meta: {
          confidence: cachedQuality >= 0.72 ? 'high' : cachedQuality >= 0.45 ? 'medium' : 'low',
          qualityScore: cachedQuality,
          sourceCount: Number(cached.sourceCount || 0),
          fromCache: true,
          searchMs: elapsed
        },
        sources: cachedSources
      });
      setSpeedDemonDiag(prev => ({ ...prev, lastSearchMs: elapsed, lastRetrievalCount: 0 }));
      refreshSpeedDemonDiag();
      showToast('Speed Demon: instant library hit', 'success');
      return;
    }

    setCoveSearchRunning(true);
    setAiStatus('generating');
    try {
      // ── Step 1: Resolve pronouns from conversation history ──────────
      const { resolved: resolvedPrompt, subject: conversationSubject, anchors: conversationAnchors } = resolveConversationReferences(prompt, coveSearchHistory);

      // ── Step 2: Retrieval using resolved query ─────────────────────
      const reasoningQuery = buildReasoningRetrievalQuery(prompt, coveSearchHistory);
      const retrievalPass1 = hybridSearch(reasoningQuery || resolvedPrompt, { chatId: activeChat?.id || null, limit: 12 });
      const pass1TopScore = Number(retrievalPass1?.[0]?.score || 0);
      const shouldRunPass2 = retrievalPass1.length > 0 && (pass1TopScore < 0.78 || AMBIGUOUS_REFERENCE_REGEX.test(prompt));
      let retrievalResultsRaw = retrievalPass1;
      if (shouldRunPass2) {
        const pass1Anchors = retrievalPass1
          .slice(0, 5)
          .flatMap((r) => extractEntityAnchors(String(r?.snippet || r?.text || '')))
          .slice(0, 8);
        const pass2Query = pass1Anchors.length ? `${resolvedPrompt}\nReasoning anchors: ${Array.from(new Set(pass1Anchors)).join(', ')}` : resolvedPrompt;
        const retrievalPass2 = hybridSearch(pass2Query, { chatId: activeChat?.id || null, limit: 12 });
        retrievalResultsRaw = mergeReasoningResults(retrievalPass1, retrievalPass2, 12);
      }
      let retrievalResults = sanitizeRetrievalResults(prompt, retrievalResultsRaw);

      // Broad fallback: if search found nothing, pull entity/fact docs
      if (retrievalResults.length === 0) {
        const broadDocs = getEntityAndFactDocs({ chatId: activeChat?.id || null, limit: 12 });
        if (broadDocs.length > 0) {
          retrievalResults = sanitizeRetrievalResults(prompt, broadDocs);
        }
      }

      const retrievalGate = evaluateRetrievalQuality(resolvedPrompt, retrievalResults);
      const contextCocktail = buildContextCocktail(retrievalResults);
      const qualityScore = Number(retrievalGate.qualityScore || 0);
      const confidence = qualityScore >= 0.72 ? 'high' : qualityScore >= 0.45 ? 'medium' : 'low';
      const sourceSnippets = retrievalResults.slice(0, 5).map((r, idx) => ({
        id: r.id || `src_${idx}`,
        label: `Source ${idx + 1}`,
        snippet: cleanSnippetText(r.snippet || r.text || ''),
        score: Number(r.score || 0),
        chatId: r.chatId || null,
        docId: r.id || null,
        messageId: extractMessageIdFromDoc(r.id, r.chatId)
      }));
      const directFact = tryExtractDirectFactAnswer(resolvedPrompt, retrievalResults, { withMeta: true });
      const extractedAnswer = directFact?.text || '';

      // ── Step 3: Build a knowledge graph from sources ────────────────
      // Extract entities, relationships, and attributes from ALL sources
      // so we can answer by reasoning, not just keyword matching.
      const knowledgeFromSources = (() => {
        if (!retrievalResults.length) return { entities: {}, aliases: {} };
        const entities = {}; // name → { attributes: Set, mentions: [] }
        const aliases = {}; // "steve's friend" → "Steven", "steve" → "Steve"
        const noiseWords = new Set(['From', 'Profile', 'Source', 'FACT', 'Context', 'The', 'VERIFIED', 'Yes', 'No']);

        const ensureEntity = (name) => {
          if (!entities[name]) entities[name] = { attributes: new Set(), mentions: [] };
          return entities[name];
        };

        for (const r of retrievalResults) {
          const text = String(r.snippet || r.text || '')
            .replace(/^\[.*?\]:\s*/, '')
            .replace(/\[Context:.*?\]/g, '')
            .replace(/^(?:VERIFIED )?FACT:\s*/i, '')
            .replace(/^Q:.*?A:\s*/i, '')
            .replace(/^Profile of \w+:\s*/i, '')
            .trim();
          if (!text) continue;

          // Split into sentences for better parsing
          const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);

          for (const sent of sentences) {
            // Pattern: "X is Y's Z" → X has role Z to Y, alias "Y's Z" → X
            // e.g. "Steven is Steve's friend" → Steven.attr = "Steve's friend", aliases["steve's friend"] = "Steven"
            const xIsYsZ = sent.match(/^([A-Z][a-z]+)\s+(?:is|was)\s+([A-Z][a-z]+)'s\s+(.+)/i);
            if (xIsYsZ) {
              const [, person, owner, role] = xIsYsZ;
              const ent = ensureEntity(person);
              ent.attributes.add(`${owner}'s ${role.trim()}`);
              aliases[`${owner}'s ${role.trim()}`.toLowerCase()] = person;
              aliases[`${owner.toLowerCase()}'s ${role.trim().toLowerCase()}`] = person;
              continue;
            }

            // Pattern: "X's Y is Z" → alias "X's Y" → Z (when Z is a name)
            // e.g. "Steve's friend is Steven"
            const xsYisZ = sent.match(/^([A-Z][a-z]+)'s\s+(\w+)\s+(?:is|was)\s+([A-Z][a-z]+)/i);
            if (xsYisZ) {
              const [, owner, role, person] = xsYisZ;
              const ent = ensureEntity(person);
              ent.attributes.add(`${owner}'s ${role}`);
              aliases[`${owner}'s ${role}`.toLowerCase()] = person;
              aliases[`${owner.toLowerCase()}'s ${role.toLowerCase()}`] = person;
              continue;
            }

            // Pattern: "X is a/an Y" → attribute
            const xIsA = sent.match(/^([A-Z][a-z]+)\s+(?:is|was)\s+(?:a\s+|an\s+)(.{3,60})/i);
            if (xIsA) {
              ensureEntity(xIsA[1]).attributes.add(xIsA[2].trim());
              continue;
            }

            // Pattern: "X is Y" (no article) → attribute
            const xIsY = sent.match(/^([A-Z][a-z]+)\s+(?:is|was)\s+(.{3,60})/i);
            if (xIsY) {
              ensureEntity(xIsY[1]).attributes.add(xIsY[2].trim());
            }

            // Pattern: "X has a/an Y" → attribute
            const xHasA = sent.match(/^([A-Z][a-z]+)\s+has\s+(?:a\s+|an\s+)?(.{3,60})/i);
            if (xHasA) {
              ensureEntity(xHasA[1]).attributes.add(`has ${xHasA[2].trim()}`);
            }

            // Pattern: "X's Y has Z" → find who Y resolves to, give them the attribute
            const xsYhasZ = sent.match(/^([A-Z][a-z]+)'s\s+(\w+)\s+has\s+(?:a\s+|an\s+)?(.{3,60})/i);
            if (xsYhasZ) {
              const ref = `${xsYhasZ[1]}'s ${xsYhasZ[2]}`.toLowerCase();
              const resolvedName = aliases[ref];
              if (resolvedName) {
                ensureEntity(resolvedName).attributes.add(`has ${xsYhasZ[3].trim()}`);
              } else {
                // Store under the reference itself as a pseudo-entity
                ensureEntity(`${xsYhasZ[1]}'s ${xsYhasZ[2]}`).attributes.add(`has ${xsYhasZ[3].trim()}`);
              }
            }
          }

          // Track all named entities mentioned
          const names = text.match(/\b[A-Z][a-z]{2,}\b/g) || [];
          for (const name of names) {
            if (noiseWords.has(name)) continue;
            const ent = ensureEntity(name);
            if (ent.mentions.length < 3) ent.mentions.push(text.slice(0, 120));
          }
        }

        // Second pass: resolve any "X's Y has Z" that now have aliases
        for (const [refKey, resolvedName] of Object.entries(aliases)) {
          const pseudoEntity = entities[refKey];
          if (pseudoEntity) {
            const target = ensureEntity(resolvedName);
            for (const attr of pseudoEntity.attributes) {
              target.attributes.add(attr);
            }
            delete entities[refKey];
          }
        }

        return { entities, aliases };
      })();

      // ── Step 4: Answer formulation from knowledge graph ────────────
      const sourceGroundedAnswer = (() => {
        const { entities, aliases } = knowledgeFromSources;
        const entityNames = Object.keys(entities);
        if (!entityNames.length) return '';

        const stopwords = new Set(['which', 'what', 'who', 'where', 'when', 'how', 'does', 'did', 'was', 'has', 'have', 'had', 'the', 'one', 'ones', 'people', 'person', 'mentioned', 'chats', 'chat', 'messages', 'message', 'from', 'your', 'about', 'that', 'this', 'are', 'were', 'been', 'being', 'would', 'could', 'should', 'will', 'can', 'may', 'might', 'also', 'but', 'his', 'her', 'name', 'owns', 'own']);
        const effectiveQuery = resolvedPrompt.toLowerCase();
        const queryKeyTerms = effectiveQuery.split(/[^a-z0-9']+/).filter(t => t.length >= 3 && !stopwords.has(t));

        // Helper: resolve "X's friend" style references to actual names
        const resolveRef = (text) => {
          let result = text;
          for (const [ref, name] of Object.entries(aliases)) {
            const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escaped, 'gi');
            if (regex.test(result)) {
              result = result.replace(regex, `${name}`);
            }
          }
          return result;
        };

        // Helper: get all attributes as a flat lowercase string for searching
        const getAttrsLow = (name) => {
          const ent = entities[name];
          return ent ? [...ent.attributes].map(a => a.toLowerCase()).join(' | ') : '';
        };

        // ── "what's his/her name?" or "who is that?" — asking for identity ──
        const askingName = /\bwhat(?:'s| is)\s+(?:his|her|their|its)\s+name\b/i.test(prompt) ||
          /\bwho\s+(?:is|was)\s+(?:he|she|that|this)\b/i.test(prompt);
        if (askingName && conversationSubject) {
          // "his" refers to conversationSubject — but if conversationSubject is a description
          // like "Steve's friend", resolve it to a name
          const resolved = aliases[conversationSubject.toLowerCase()] || conversationSubject;
          const ent = entities[resolved];
          if (ent) {
            const attrs = [...ent.attributes];
            return `From your chats: His name is ${resolved}${attrs.length ? ` (${attrs[0]})` : ''}.`;
          }
          return `From your chats: Based on the conversation, that's ${resolved}.`;
        }

        // ── "is X a Y?" / "is X also a Y?" ──
        const isXaYMatch = resolvedPrompt.match(/^(?:is|are|was|were|does)\s+([a-z]+)\s+(?:a\s+|an\s+|also\s+(?:a\s+|an\s+)?)?(.+?)[\s?]*$/i);
        if (isXaYMatch) {
          const targetRaw = isXaYMatch[1];
          const targetName = targetRaw.charAt(0).toUpperCase() + targetRaw.slice(1);
          const queryAttr = isXaYMatch[2].toLowerCase().replace(/[?.!]$/, '').trim();
          const ent = entities[targetName];
          if (ent) {
            const attrs = [...ent.attributes];
            const attrsLow = attrs.map(a => a.toLowerCase());
            // Direct match: does this entity have the attribute?
            const directMatch = attrsLow.some(a => a.includes(queryAttr) || queryAttr.split(/\s+/).some(w => w.length >= 4 && a.includes(w)));
            if (directMatch) {
              const match = attrs.find(a => a.toLowerCase().includes(queryAttr) || queryAttr.split(/\s+/).some(w => w.length >= 4 && a.toLowerCase().includes(w)));
              return `From your chats: Yes, ${targetName} is ${match || queryAttr}.`;
            }
            // Indirect: does a related entity have it?
            for (const attr of attrs) {
              // If targetName is "Steve's friend", check Steve's attributes
              const relMatch = attr.match(/^([A-Z][a-z]+)'s\s+/);
              if (relMatch) {
                const relatedName = relMatch[1];
                const relEnt = entities[relatedName];
                if (relEnt) {
                  const relAttrsLow = [...relEnt.attributes].map(a => a.toLowerCase());
                  if (relAttrsLow.some(a => a.includes(queryAttr))) {
                    return `From your chats: ${relatedName} is ${queryAttr}. ${targetName} is ${attr}, but the chats don't specifically say ${targetName} is also ${queryAttr}.`;
                  }
                }
              }
            }
            return `From your chats: ${targetName} is known as ${attrs.join(', ')}. The chats don't specifically mention "${queryAttr}" for ${targetName}.`;
          }
        }

        // ── "which one has/owns X?" — scan all entities ──
        if (/^(?:which|who)\b/i.test(prompt.trim()) && queryKeyTerms.length) {
          const matches = [];
          for (const [name, ent] of Object.entries(entities)) {
            const attrsLow = [...ent.attributes].map(a => a.toLowerCase()).join(' ');
            const hit = queryKeyTerms.find(t => attrsLow.includes(t));
            if (hit) {
              const matchAttr = [...ent.attributes].find(a => a.toLowerCase().includes(hit));
              matches.push({ name, attr: matchAttr || hit });
            }
          }
          if (matches.length === 1) {
            return `From your chats: ${matches[0].name} — ${matches[0].attr}.`;
          }
          if (matches.length > 1) {
            return `From your chats: ${matches.map(m => `${m.name} (${m.attr})`).join(', ')}.`;
          }
        }

        // ── General: find sources with query terms, resolve references ──
        if (queryKeyTerms.length) {
          for (const r of retrievalResults) {
            const text = String(r.snippet || r.text || '')
              .replace(/^\[.*?\]:\s*/, '')
              .replace(/\[Context:.*?\]/g, '')
              .replace(/^(?:VERIFIED )?FACT:\s*/i, '')
              .replace(/^Q:.*?A:\s*/i, '')
              .replace(/^Profile of \w+:\s*/i, '')
              .trim();
            const low = text.toLowerCase();
            if (queryKeyTerms.some(t => low.includes(t))) {
              return `From your chats: ${resolveRef(text)}`;
            }
          }
        }

        return '';
      })();

      // ── Determine if query needs multi-hop reasoning ──────────────
      const needsReasoning = AMBIGUOUS_REFERENCE_REGEX.test(prompt) ||
        /\b(which\s+one|compare|difference|both|between|relationship|connect|related)\b/i.test(prompt) ||
        (retrievalResults.length > 3 && qualityScore < 0.6);

      // ── AI Generation — 100% LOCAL (fast) ──────────────────
      // First, check if Pass 1/Indexing already produced a clear Fact.
      let answer;
      const bestDirectAnswer = sourceGroundedAnswer || extractedAnswer;

      if (retrievalResults.length > 0) {
        // Also run neural semantic retrieval (MiniLM embeddings from IndexedDB)
        // alongside the keyword-based hybridSearch results already gathered
        let neuralContext = '';
        try {
          const neuralResults = await retrieveRelevantMemory(resolvedPrompt, 6);
          if (neuralResults.length > 0) {
            const neuralSnippets = neuralResults
              .filter(r => r.text && r.score > 0.2)
              .map((r, i) => `[Memory ${i + 1}] (${r.role || 'unknown'}, relevance:${r.score?.toFixed(2)}): ${r.text.slice(0, 300)}`);
            if (neuralSnippets.length > 0) {
              neuralContext = `\n\nAdditional semantic memory matches:\n${neuralSnippets.join('\n')}`;
            }
          }
        } catch (neuralErr) {
          console.warn('[CoveSearch] Neural retrieval failed, continuing with keyword results:', neuralErr.message);
        }

        const fullContext = `${contextCocktail}${neuralContext}`;
        const historyForAI = (coveSearchHistory || [])
          .filter(t => t.role && t.text && !t.loading)
          .slice(-6)
          .map(t => ({ role: t.role, content: t.text }));

        try {
          await ensureAiReady();
          const aiResult = await generateAIResponse([
            ...historyForAI,
            { role: 'user', content: `${resolvedPrompt}\n\n---\nRelevant local context from your chats:\n${fullContext}` }
          ]);

          handleAIConsumption(aiResult.tokens || 0);
          const rawAiAnswer = aiResult.text || '';

          // If AI produced a direct fact or a high-quality summary
          if (rawAiAnswer && !isBadAnswerText(rawAiAnswer)) {
            answer = rawAiAnswer;
          } else {
            answer = bestDirectAnswer || 'I could not find a reliable answer in your local chats.';
          }
        } catch (localErr) {
          console.warn('[CoveSearch] Local AI failed:', localErr.message);
          answer = bestDirectAnswer || 'I could not find a reliable answer in your local chats.';
        }
      } else if (bestDirectAnswer) {
        answer = bestDirectAnswer;
      } else {
        // No retrieval results - try a simple local AI response
        try {
          await ensureAiReady();
          const aiResult = await generateAIResponse([{ role: 'user', content: prompt }]);
          answer = aiResult.text || 'No relevant information found in your chats.';
        } catch (e) {
          answer = 'I could not find a reliable answer in your local chats.';
        }
      }

      const elapsed = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - startedAt);
      const finalConfidence = retrievalResults.length > 0 ? confidence : 'low';
      const finalQuality = retrievalResults.length > 0 ? qualityScore : 0;

      setCoveSearchResult(answer);
      setCoveSearchMeta({
        confidence: finalConfidence,
        qualityScore: finalQuality,
        sourceCount: retrievalResults.length,
        fromCache: false,
        searchMs: elapsed,
        factConfidence: directFact?.confidence ?? null,
        factDocId: directFact?.docId ?? null
      });
      setCoveSearchSources(sourceSnippets);
      setShowCoveSources(false);
      patchTurn(assistantTurnId, {
        text: answer, loading: false,
        meta: {
          confidence: finalConfidence,
          qualityScore: finalQuality,
          sourceCount: retrievalResults.length,
          fromCache: false,
          searchMs: elapsed,
          factConfidence: directFact?.confidence ?? null,
          factDocId: directFact?.docId ?? null
        },
        sources: sourceSnippets
      });
      indexNewMessage({ text: prompt, role: 'user', created: Date.now() }, 'cove_search');
      indexNewMessage({ text: answer, role: 'assistant', created: Date.now() }, 'cove_search');
      if (isProfessionalAnswerText(answer)) {
        saveLibraryAnswer(prompt, answer, { sourceCount: retrievalResults.length, qualityScore: finalQuality, topSnippets: sourceSnippets });
      }
      diagRef.current.totalSearchMs += elapsed;
      setSpeedDemonDiag(prev => ({ ...prev, lastSearchMs: elapsed, lastRetrievalCount: retrievalResults.length }));
      refreshSpeedDemonDiag();
    } catch (err) {
      if (err.message === 'NO_CREDITS') {
        patchTurn(assistantTurnId, { text: 'AI credits are exhausted. Please upgrade or wait for reset.', loading: false });
        setShowCreditWall(true);
      } else {
        patchTurn(assistantTurnId, { text: `AI Error: ${err.message}`, loading: false });
        showToast('AI Error: ' + err.message, 'error');
      }
    } finally {
      setAiStatus('ready');
      setCoveSearchRunning(false);
    }
  };

  const jumpToSearchSource = (source) => {
    if (!source?.chatId) {
      showToast('Source chat not available', 'error');
      return;
    }
    const targetChat = chats.find(c => c.id === source.chatId);
    if (!targetChat) {
      showToast('Source chat is not loaded yet. Open that chat first.', 'info');
      setActiveTab('chats');
      setActiveChat(null);
      return;
    }
    setActiveTab('chats');
    setShowSettings(false);
    setActiveChat(targetChat);
    setPendingSourceJump({
      chatId: source.chatId,
      messageId: source.messageId || '',
      snippet: source.snippet || ''
    });
  };

  const buildPersonAliases = ({ email = '', name = '' } = {}) => {
    const aliases = [];
    const emailLow = String(email || '').toLowerCase().trim();
    if (emailLow) {
      const local = emailLow.split('@')[0];
      if (local) {
        aliases.push(local);
        aliases.push(...local.split(/[._-]+/).filter((t) => t.length >= 2));
      }
    }
    const nameTokens = String(name || '')
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    aliases.push(...nameTokens);
    return Array.from(new Set(aliases)).slice(0, 8);
  };

  const getPersonLabel = ({ email = '', name = '' } = {}) => {
    const nameClean = String(name || '').trim();
    if (nameClean) return nameClean;
    const local = String(email || '').toLowerCase().trim().split('@')[0];
    if (!local) return 'Unknown';
    const words = local.split(/[._-]+/).filter(Boolean);
    const pretty = words.length ? words.join(' ') : local;
    return pretty.slice(0, 40);
  };

  /** Enhance message text with identity/topic resolution */
  /** Enhance message text with identity/topic resolution */
  const enrichMessageText = (rawText, senderLabel, isSelfSender, selfLabel, counterpartLabel, memory, replaceMode = false) => {
    let text = String(rawText || '').trim();
    if (text.length < 3) return text;

    const { lastMentionedPerson, lastTopic } = memory;

    // Resolve first-person pronouns
    if (/\b(I|me|my|mine|myself)\b/i.test(text)) {
      const name = isSelfSender ? selfLabel : senderLabel;
      if (replaceMode) {
        text = text.replace(/\bI\b/g, name)
                   .replace(/\bme\b/gi, name)
                   .replace(/\bmy\b/gi, `${name}'s`)
                   .replace(/\bmine\b/gi, `${name}'s`)
                   .replace(/\bmyself\b/gi, name);
      } else {
        text = text.replace(/\bI\b/g, (m) => `${m} (${name})`);
        text = text.replace(/\bme\b/gi, (m) => `${m} (${name})`);
        text = text.replace(/\bmy\b/gi, (m) => `${m} (${name})`);
        text = text.replace(/\bmyself\b/gi, (m) => `${m} (${name})`);
      }
    }

    // Second person → counterpart or self depending on who sent
    if (/\b(you|your|you're)\b/i.test(text)) {
      const target = isSelfSender ? counterpartLabel : selfLabel;
      if (target && target !== 'Unknown') {
        if (replaceMode) {
          text = text.replace(/\byou\b/gi, target)
                     .replace(/\byour\b/gi, `${target}'s`)
                     .replace(/\byou're\b/gi, `${target} is`);
        } else {
          let youReplaced = false;
          text = text.replace(/\byou\b(?!\s*\()/gi, (m) => {
            if (youReplaced) return m;
            youReplaced = true;
            return `${m} (${target})`;
          });
          text = text.replace(/\byour\b(?!\s*\()/gi, (m) => `${m} (${target})`);
        }
      }
    }

    // He/him/his → lastMentionedPerson (best guess)
    if (/\b(he|him|his|himself)\b/i.test(text) && lastMentionedPerson) {
      if (replaceMode) {
        text = text.replace(/\bhe\b/gi, lastMentionedPerson)
                   .replace(/\bhim\b/gi, lastMentionedPerson)
                   .replace(/\bhis\b/gi, `${lastMentionedPerson}'s`);
      } else {
        let heReplaced = false;
        text = text.replace(/\b(he|him|his)\b(?!\s*\()/gi, (m) => {
          if (heReplaced) return m;
          heReplaced = true;
          return `${m} (${lastMentionedPerson})`;
        });
      }
    }

    // She/her/hers → lastMentionedPerson
    if (/\b(she|her|hers|herself)\b/i.test(text) && lastMentionedPerson) {
      if (replaceMode) {
        text = text.replace(/\bshe\b/gi, lastMentionedPerson)
                   .replace(/\bher\b/gi, lastMentionedPerson)
                   .replace(/\bhers\b/gi, `${lastMentionedPerson}'s`);
      } else {
        let sheReplaced = false;
        text = text.replace(/\b(she|her)\b(?!\s*\()/gi, (m) => {
          if (sheReplaced) return m;
          sheReplaced = true;
          return `${m} (${lastMentionedPerson})`;
        });
      }
    }

    // They/them/their → lastMentionedPerson
    if (/\b(they|them|their)\b/i.test(text) && lastMentionedPerson) {
      if (replaceMode) {
        text = text.replace(/\bthey\b/gi, lastMentionedPerson)
                   .replace(/\bthem\b/gi, lastMentionedPerson)
                   .replace(/\btheir\b/gi, `${lastMentionedPerson}'s`);
      } else {
        let theyReplaced = false;
        text = text.replace(/\b(they|them|their)\b(?!\s*\()/gi, (m) => {
          if (theyReplaced) return m;
          theyReplaced = true;
          return `${m} (${lastMentionedPerson})`;
        });
      }
    }

    // It/this/that → lastTopic (first occurrence only)
    if (/\b(it|this|that)\b/i.test(text) && lastTopic && lastTopic.length > 3) {
      if (replaceMode) {
        text = text.replace(/\b(it|this|that)\b/gi, lastTopic);
      } else {
        let itReplaced = false;
        text = text.replace(/\b(it|this|that)\b(?!\s*\()/gi, (m) => {
          if (itReplaced) return m;
          itReplaced = true;
          return `${m} (ref: ${lastTopic.slice(0, 60)})`;
        });
      }
    }

    return text;
  };

  const extractFacts = (rawText, senderLabel) => [];

  const detectMentionedPerson = (value, knownNames = []) => {
    const text = String(value || '');
    if (!text) return '';

    // Forbidden Names: Common words often capitalized mid-sentence (colors, months, days)
    const FORBIDDEN_NAMES = /^(Green|Blue|Red|Yellow|Black|White|Orange|Purple|Brown|Pink|Grey|Gray|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Yes|No|Actually|Thanks|Please)$/i;

    // Check against known participant names first
    for (const name of knownNames) {
      if (name && text.includes(name) && !FORBIDDEN_NAMES.test(name)) return name;
    }

    // Look for capitalized words that aren't at sentence start
    const propNouns = text.match(/(?:^|[.!?]\s+)\s*[a-z].*?\b([A-Z][a-z]{2,})\b/g);
    if (propNouns) {
      for (const match of propNouns) {
        const nameMatch = match.match(/\b([A-Z][a-z]{2,})\b/);
        if (nameMatch) {
          const n = nameMatch[1];
          if (!FORBIDDEN_NAMES.test(n)) return n;
        }
      }
    }

    // Simpler: any capitalized word not at very start
    const midCapitals = text.slice(1).match(/\b([A-Z][a-z]{2,15})\b/);
    if (midCapitals && !FORBIDDEN_NAMES.test(midCapitals[1])) return midCapitals[1];
    return '';
  };

  const buildDocsFromMessages = (chatId, list = []) => {
    const out = [];
    const allFacts = new Map(); // personName → [fact strings]
    const memory = {
      favoriteColorName: '',
      lastTopic: '',
      lastMentionedPerson: ''
    };
    const selfEmail = String(userData?.email || '').toLowerCase().trim();
    const selfName = String(userData?.name || '');
    const selfLabel = getPersonLabel({ email: selfEmail, name: selfName });
    const counterpartEmail = (activeChat?.participants || []).find((p) => String(p || '').toLowerCase() !== selfEmail) || '';
    const counterpartLookup = userLookup[String(counterpartEmail || '').toLowerCase()] || null;
    const counterpartLabel = getPersonLabel({
      email: counterpartEmail,
      name: counterpartLookup?.name || ''
    });
    // Known names for entity detection
    const knownNames = [selfLabel, counterpartLabel].filter(n => n && n !== 'Unknown');

    for (let msgIdx = 0; msgIdx < list.length; msgIdx++) {
      const msg = list[msgIdx];
      const rawText = String(msg?.text || '').trim();
      if (!rawText && !msg?.fileType) continue;

      const senderEmail = String(msg?.senderEmail || '').toLowerCase().trim();
      const senderLookup = userLookup[senderEmail] || null;
      const senderLabel = getPersonLabel({ email: senderEmail, name: senderLookup?.name || '' });
      const isSelfSender = !!selfEmail && senderEmail === selfEmail;

      // Update topic tracking
      const favoriteColorNameMatch = rawText.match(/\b([A-Za-z][A-Za-z0-9_]{1,30})['']s favorite color\b/i);
      const favoriteColorValueMatch = rawText.match(/\bfavorite color\s+is\s+([A-Za-z][A-Za-z0-9_-]{1,30})\b/i);
      if (favoriteColorNameMatch) memory.favoriteColorName = favoriteColorNameMatch[1];
      if (favoriteColorValueMatch) {
        const subject = favoriteColorNameMatch?.[1] || senderLabel;
        memory.lastTopic = `${subject}'s favorite color`;
      } else if (rawText.length >= 12) {
        memory.lastTopic = rawText.replace(/\s+/g, ' ').slice(0, 100);
      }

      // Track mentioned persons
      const detectedPerson = detectMentionedPerson(rawText, knownNames);
      if (detectedPerson) memory.lastMentionedPerson = detectedPerson;
      // Enrich the message text with inline pronoun annotations
      // We use replaceMode=true for indexing to make the docs ultra-usable
      const enrichedBody = enrichMessageText(rawText, senderLabel, isSelfSender, selfLabel, counterpartLabel, memory, true);

      // Build the main message document with speaker prefix
      const fileHint = msg.fileType ? ` Attachment type: ${msg.fileType}.` : '';
      const contextHint = memory.favoriteColorName ? ` [Context: ${memory.favoriteColorName}'s favorite color discussion]` : '';
      const textForIndex = `[${senderLabel}]: ${enrichedBody}${fileHint}${contextHint}`.trim();

      if (textForIndex) {
        const msgId = msg.id || msg.tempId || `${msg.created || Date.now()}:${senderEmail || 'unknown'}`;
        out.push({
          id: `${chatId}:${msgId}`,
          chatId,
          source: msg.fileType ? 'file-shadow' : 'message',
          text: textForIndex,
          authorName: senderLabel,
          ts: msg.created ? new Date(msg.created).getTime() : Date.now()
        });
      }

      const facts = [];
      for (let fi = 0; fi < facts.length; fi++) {
        const factText = facts[fi];
        out.push({
          id: `fact:${chatId}:${msgIdx}:${fi}`,
          chatId,
          source: 'fact',
          text: `FACT: ${factText}`,
          ts: msg.created ? new Date(msg.created).getTime() : Date.now()
        });

        // Aggregate facts by person for entity profiles
        const personMatch = factText.match(/^(?:CORRECTION:\s*)?([A-Z][a-zA-Z]+)/);
        if (personMatch) {
          const personName = personMatch[1];
          if (!allFacts.has(personName)) allFacts.set(personName, []);
          allFacts.get(personName).push(factText);
        }
      }
    }

    // Generate entity profile documents from aggregated facts
    const latestTs = list.length > 0 ? (list[list.length - 1]?.created ? new Date(list[list.length - 1].created).getTime() : Date.now()) : Date.now();
    for (const [personName, personFacts] of allFacts) {
      if (personFacts.length === 0) continue;
      const uniqueFacts = Array.from(new Set(personFacts)).slice(0, 20);
      out.push({
        id: `entity:${chatId}:${personName}`,
        chatId,
        source: 'entity-profile',
        text: `Profile of ${personName}: ${uniqueFacts.join(' ')}`,
        ts: latestTs
      });
    }

    return out;
  };

  const buildDocsFromChats = (list = []) => {
    const now = Date.now();
    return (Array.isArray(list) ? list : []).map((chat) => {
      const text = String(chat?.lastMessage || '').trim();
      if (!chat?.id || !text) return null;
      return {
        id: `contact_summary:${chat.id}`,
        chatId: chat.id,
        source: 'contact-summary',
        text,
        ts: chat?.updated ? new Date(chat.updated).getTime() : now
      };
    }).filter(Boolean);
  };

  const verifyAndHealIndexForActiveChat = (opts = {}) => {
    const quiet = !!opts.quiet;
    if (!activeChat?.id || !messages?.length) return 0;
    const expectedDocs = buildDocsFromMessages(activeChat.id, messages);
    if (!expectedDocs.length) return 0;

    const existingIds = new Set(getShadowDocIdsForChat(activeChat.id));
    const missing = expectedDocs.filter(doc => !existingIds.has(doc.id));
    if (!missing.length) return 0;

    upsertShadowDocuments(missing);
    missing.forEach(doc => indexedShadowIdsRef.current.add(doc.id));
    diagRef.current.autoHeals += 1;
    refreshSpeedDemonDiag();
    if (!quiet) showToast(`Auto-healed ${missing.length} missing index items`, 'success');
    return missing.length;
  };

  const reindexCurrentChat = () => {
    if (!activeChat?.id || !messages?.length) {
      showToast('Open a chat with messages first', 'info');
      return;
    }
    const docs = buildDocsFromMessages(activeChat.id, messages);
    if (!docs.length) {
      showToast('No indexable text found in this chat', 'info');
      return;
    }
    upsertShadowDocuments(docs);
    docs.forEach(doc => indexedShadowIdsRef.current.add(doc.id));
    refreshSpeedDemonDiag();
    showToast(`Re-indexed ${docs.length} items`, 'success');
  };

  const clearSpeedDemonCacheOnly = () => {
    clearLibraryCache();
    refreshSpeedDemonDiag();
    showToast('Speed Demon library cache cleared', 'success');
  };

  const clearSpeedDemonAll = () => {
    clearLibraryCache();
    clearShadowIndex();
    indexedShadowIdsRef.current = new Set();
    refreshSpeedDemonDiag();
    showToast('Speed Demon cache + shadow index cleared', 'success');
  };

  useEffect(() => {
    if (!pendingSourceJump || !activeChat?.id) return;
    if (pendingSourceJump.chatId !== activeChat.id) return;
    if (!messages || messages.length === 0) return;

    const byId = pendingSourceJump.messageId
      ? messages.findIndex(m => String(m.id || '') === String(pendingSourceJump.messageId))
      : -1;

    if (byId >= 0 && messagesRefs.current[byId]) {
      messagesRefs.current[byId].scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPendingSourceJump(null);
      return;
    }

    if (pendingSourceJump.snippet) {
      const needle = pendingSourceJump.snippet.toLowerCase();
      const byText = messages.findIndex(m => String(m.text || '').toLowerCase().includes(needle.slice(0, 48)));
      if (byText >= 0 && messagesRefs.current[byText]) {
        messagesRefs.current[byText].scrollIntoView({ behavior: 'smooth', block: 'center' });
        setPendingSourceJump(null);
        return;
      }
    }
  }, [pendingSourceJump, activeChat?.id, messages]);

  useEffect(() => {
    if (coveSearchTab !== 'ask') return;
    const el = coveSearchEndRef.current;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [coveSearchHistory, coveSearchRunning, coveSearchTab]);

  useEffect(() => {
    if (aiStatus !== 'loading') return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [aiStatus]);

  useEffect(() => {
    if (!messages || messages.length === 0 || !activeChat?.id) return;
    const allDocs = buildDocsFromMessages(activeChat.id, messages);
    const docs = allDocs.filter(doc => !indexedShadowIdsRef.current.has(doc.id));

    if (docs.length > 0) {
      upsertShadowDocuments(docs);
      docs.forEach(doc => indexedShadowIdsRef.current.add(doc.id));
    }
  }, [messages, activeChat?.id]);

  useEffect(() => {
    if (!activeChat?.id) return;
    const timer = setInterval(() => {
      verifyAndHealIndexForActiveChat({ quiet: true });
    }, 120000);
    return () => clearInterval(timer);
  }, [activeChat?.id, messages]);

  const pauseAllMediaInMessages = () => {
    try {
      const root = messagesContainerRef.current;
      if (!root) return;
      const medias = root.querySelectorAll('video, audio');
      medias.forEach(m => {
        try { m.pause(); } catch (e) { }
      });
    } catch (e) { }
  };
  // edit modal handled via state
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  // Chat search state and helpers
  const [chatSearch, setChatSearch] = useState('');
  const [searchMatches, setSearchMatches] = useState([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const messagesRefs = useRef([]);
  const [expandedMessageKeys, setExpandedMessageKeys] = useState(new Set());
  const MAX_MESSAGE_PREVIEW_CHARS = 420;

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const getMessageRenderInfo = (text, expanded = false) => {
    const raw = (text || '').trim();
    if (!raw) return { text: '', truncated: false };
    if (expanded || raw.length <= MAX_MESSAGE_PREVIEW_CHARS) return { text: raw, truncated: false };
    return { text: `${raw.slice(0, MAX_MESSAGE_PREVIEW_CHARS).trimEnd()}...`, truncated: true };
  };

  const scrollToMatch = (match) => {
    if (!match) return;
    const el = messagesRefs.current[match.msgIndex];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const updateChatSearch = (q) => {
    setChatSearch(q);
    if (!q) {
      setSearchMatches([]);
      setCurrentMatchIndex(0);
      return;
    }
    const matches = [];
    const ql = q.toLowerCase();
    messages.forEach((m, mi) => {
      if (!m.text) return;
      const text = String(m.text);
      let pos = text.toLowerCase().indexOf(ql);
      while (pos > -1) {
        matches.push({ msgIndex: mi, start: pos, end: pos + ql.length });
        pos = text.toLowerCase().indexOf(ql, pos + 1);
      }
    });
    setSearchMatches(matches);
    if (matches.length > 0) {
      setCurrentMatchIndex(0);
      scrollToMatch(matches[0]);
    } else {
      setCurrentMatchIndex(0);
    }
  };

  const gotoMatch = (dir = 1) => {
    if (!searchMatches || searchMatches.length === 0) return;
    let next = currentMatchIndex + dir;
    if (next < 0) next = searchMatches.length - 1;
    if (next >= searchMatches.length) next = 0;
    setCurrentMatchIndex(next);
    scrollToMatch(searchMatches[next]);
  };

  useEffect(() => {
    setExpandedMessageKeys(new Set());
  }, [activeChat?.id]);

  const highlightText = (text) => {
    if (!chatSearch) return text;
    const parts = String(text).split(new RegExp(`(${escapeRegExp(chatSearch)})`, 'gi'));
    return parts.map((part, i) => (
      part.toLowerCase() === chatSearch.toLowerCase() ? <span key={i} className="bg-yellow-300/60 dark:bg-yellow-400/30 px-0.5 rounded">{part}</span> : <span key={i}>{part}</span>
    ));
  };

  const handleRetryUpload = async (index = 0) => {
    const target = pendingAttachments[index];
    if (!target?.file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const url = await uploadFileToStorage(target.file);
      setPendingAttachments(prev => prev.map((p, i) => i === index ? { ...p, uploadedUrl: url } : p));
    } catch (err) {
      console.error('Retry upload failed', err);
      setUploadError(err?.message || String(err));
    } finally { setUploading(false); }
  };

  const profileInputRef = useRef(null);
  const chatFileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const DUMMY_PW = "cove_password_safe_123";
  const EMOJI_DATA = [
    { e: '❤️', k: 'heart love' },
    { e: '😂', k: 'laugh joy haha' },
    { e: '😮', k: 'wow surprised' },
    { e: '😢', k: 'sad cry' },
    { e: '😡', k: 'angry mad' },
    { e: '👍', k: 'thumbs up ok' },
    { e: '🔥', k: 'fire flame hot' },
    { e: '🙌', k: 'celebrate praise' },
    { e: '✨', k: 'sparkle shine' },
    { e: '✅', k: 'check done' }
  ];
  const EMOJIS = EMOJI_DATA.map(d => d.e);
  const RECOMMENDED_EMOJIS = ['👍', '❤️', '😂', '🔥', '✨', '🙌'];

  // --- AUTH SYNC ---
  useEffect(() => {
    // Initial sync
    if (pb.authStore.model) {
      setUser(pb.authStore.model);
      setUserData(pb.authStore.model);
    }

    // Listener for changes (Login/Logout)
    const unsub = pb.authStore.onChange((token, model) => {
      console.log('DEBUG: Auth Change State:', !!model);
      setUser(model);
      setUserData(model);
      if (!model) {
        setChats([]);
        setActiveChat(null);
        setIsAppLoading(false);
      }
    }, true);
    return () => unsub();
  }, []);

  const fetchChats = async (page = 1) => {
    if (!userData?.email) return;
    const emailLow = userData.email.toLowerCase();
    try {
      console.log(`DEBUG: Fetching chats for ${emailLow}, page ${page}`);
      const records = await pb.collection('contacts').getList(page, chatsLimit, {
        filter: `participants ~ "${emailLow}"`,
        sort: '-updated'
      });
      console.log('DEBUG: Chats fetched:', records.items.length);
      let localSelfChat = null;
      try {
        const raw = localStorage.getItem(LOCAL_SELF_CHAT_KEY);
        if (raw) localSelfChat = JSON.parse(raw);
      } catch (e) { }
      if (!localSelfChat) {
        const selfChatId = `self_${emailLow.replace(/[^a-z0-9]/g, '_')}`;
        const localMsgKey = `${LOCAL_SELF_CHAT_MSG_PREFIX}${selfChatId}`;
        try {
          const rawMsgs = localStorage.getItem(localMsgKey);
          const msgs = rawMsgs ? JSON.parse(rawMsgs) : [];
          if (Array.isArray(msgs) && msgs.length > 0) {
            const last = msgs[msgs.length - 1];
            localSelfChat = {
              id: selfChatId,
              participants: [emailLow],
              lastMessage: last?.fileUrl ? `📎 ${last?.text || ''}` : (last?.text || 'Personal notes and files'),
              lastSender: emailLow,
              isGroup: false
            };
            localStorage.setItem(LOCAL_SELF_CHAT_KEY, JSON.stringify(localSelfChat));
          }
        } catch (e) { }
      }

      if (page === 1) {
        const merged = localSelfChat?.id
          ? [localSelfChat, ...records.items.filter(c => c.id !== localSelfChat.id)]
          : records.items;
        setChats(merged);
        const summaryDocs = buildDocsFromChats(merged);
        if (summaryDocs.length > 0) upsertShadowDocuments(summaryDocs);
      } else {
        setChats(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const uniqueNew = records.items.filter(c => !existingIds.has(c.id));
          const summaryDocs = buildDocsFromChats(uniqueNew);
          if (summaryDocs.length > 0) upsertShadowDocuments(summaryDocs);
          return [...prev, ...uniqueNew];
        });
      }

      setHasMoreChats(records.items.length >= chatsLimit);
      setIsAppLoading(false);

      if (activeChat) {
        const updated = records.items.find(c => c.id === activeChat.id);
        if (updated) setActiveChat(updated);
      }
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
      setIsAppLoading(false);
    }
  };

  const ensureLocalSelfChatInList = useCallback((emailLow) => {
    if (!emailLow) return;
    const selfChatId = `self_${emailLow.replace(/[^a-z0-9]/g, '_')}`;
    const localMsgKey = `${LOCAL_SELF_CHAT_MSG_PREFIX}${selfChatId}`;
    let derivedSelfChat = null;

    try {
      const rawMeta = localStorage.getItem(LOCAL_SELF_CHAT_KEY);
      if (rawMeta) derivedSelfChat = JSON.parse(rawMeta);
    } catch (e) { }

    if (!derivedSelfChat) {
      try {
        const rawMsgs = localStorage.getItem(localMsgKey);
        const msgs = rawMsgs ? JSON.parse(rawMsgs) : [];
        if (Array.isArray(msgs) && msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          derivedSelfChat = {
            id: selfChatId,
            participants: [emailLow],
            lastMessage: last?.fileUrl ? `📎 ${last?.text || ''}` : (last?.text || 'Personal notes and files'),
            lastSender: emailLow,
            isGroup: false
          };
          localStorage.setItem(LOCAL_SELF_CHAT_KEY, JSON.stringify(derivedSelfChat));
        }
      } catch (e) { }
    }

    if (!derivedSelfChat?.id) return;
    setChats((prev) => {
      const exists = prev.some((c) => c.id === derivedSelfChat.id);
      if (exists) return prev;
      return [derivedSelfChat, ...prev];
    });
  }, []);

  useEffect(() => {
    if (!userData?.email) return;
    fetchChats(1);
    ensureLocalSelfChatInList(userData.email.toLowerCase());

    // Subscribe to ALL contact changes for this user
    // PB correctly only sends events for records the user has access to (via rules)
    pb.collection('contacts').subscribe('*', function (e) {
      console.log('DEBUG: Contact Real-time Event:', e.action);
      fetchChats(1);
    }).catch((err) => {
      console.warn('Realtime subscribe failed: contacts', err);
    });

    return () => { pb.collection('contacts').unsubscribe('*'); };
  }, [userData?.email, ensureLocalSelfChatInList]);

  useEffect(() => {
    if (chatsPage > 1) {
      fetchChats(chatsPage);
    }
  }, [chatsPage]);

  // Load more chats on scroll
  const loadMoreChats = () => {
    if (!hasMoreChats || isAppLoading) return;
    setChatsPage(prev => prev + 1);
  };

  useEffect(() => {
    const fetchVisibleUsers = async () => {
      if (!chats.length) return;
      try {
        // Only fetch users actually involved in current visible chats for 100k scale
        const emails = [...new Set(chats.flatMap(c => c.participants))];
        const filter = emails.map(e => `email = "${e}"`).join(' || ');
        const records = await pb.collection('users').getList(1, 50, { filter });

        const lookup = {};
        records.items.forEach(u => { lookup[u.email.toLowerCase()] = u; });
        setUserLookup(lookup);
      } catch (err) { console.warn('User lookup failed', err); }
    };
    fetchVisibleUsers();
  }, [chats]);

  useEffect(() => {
    if (!userData?.email) return;
    const emailLow = userData.email.toLowerCase();

    const fetchInvites = async () => {
      try {
        const records = await pb.collection('pending_requests').getList(1, 10, {
          filter: `to = "${emailLow}" && status = "pending"`
        });
        setPendingInvites(records.items);
      } catch (e) { }
    }
    fetchInvites();

    pb.collection('pending_requests').subscribe('*', fetchInvites).catch((err) => {
      console.warn('Realtime subscribe failed: pending_requests', err);
    });
    return () => { pb.collection('pending_requests').unsubscribe('*'); };
  }, [userData?.email]);

  useEffect(() => {
    if (!activeChat) return;
    setMessagesLimit(15);
    setHasMoreMessages(true);
    isInitialLoadRef.current = true;
  }, [activeChat?.id]);

  useEffect(() => {
    if (!activeChat) return;

    let isSubscribed = true;
    const localPrivateKey = localStorage.getItem('cove_master_key');
    const isEphemeralSelfChat = String(activeChat.id || '').startsWith('self_');

    const fetchMessages = async () => {
      try {
        setIsChatLoading(true);
        if (isEphemeralSelfChat) {
          const localKey = `${LOCAL_SELF_CHAT_MSG_PREFIX}${activeChat.id}`;
          let localItems = [];
          try {
            const raw = localStorage.getItem(localKey);
            localItems = raw ? JSON.parse(raw) : [];
          } catch (e) { localItems = []; }
          const normalized = (Array.isArray(localItems) ? localItems : []).map((d) => ({
            ...d,
            timestamp: { seconds: new Date(d.created).getTime() / 1000 }
          }));
          setMessages(normalized);
          setHasMoreMessages(false);
          setIsChatLoading(false);
          return;
        }
        // Optimize: skip fileUrl and large blobs initially using fields
        const records = await pb.collection('messages').getList(1, messagesLimit, {
          filter: `contact = "${activeChat.id}"`,
          sort: '-created',
          fields: 'id,text,senderEmail,created,updated,contact,isForwarded,imported,encryptedPayload,encryptedKeys,replyTo,tempId,status,seenAt'
        });

        if (!isSubscribed) return;
        setIsChatLoading(false);

        // Decrypt E2EE messages if applicable
        const decryptedItems = await Promise.all(records.items.map(async (d) => {
          if (d.encryptedPayload && d.encryptedKeys && localPrivateKey && userData?.email) {
            try {
              const encryptedKeysMap = typeof d.encryptedKeys === 'string' ? JSON.parse(d.encryptedKeys) : d.encryptedKeys;
              const decryptedJson = await decryptMessagePayload(d.encryptedPayload, encryptedKeysMap, userData.email, localPrivateKey);
              const payload = JSON.parse(decryptedJson);
              return { ...d, text: payload.text, fileUrl: payload.fileUrl, fileType: payload.fileType, replyTo: payload.replyTo, _decrypted: true };
            } catch (decErr) {
              console.warn('Message decryption failed', decErr);
              return { ...d, text: '[Encrypted Message]', _decrypted: false };
            }
          }
          // Parse replyTo if it's a JSON string
          if (d.replyTo && typeof d.replyTo === 'string') {
            try { d.replyTo = JSON.parse(d.replyTo); } catch (e) { }
          }
          return d;
        }));

        const newMessages = decryptedItems.reverse().map(d => ({ ...d, timestamp: { seconds: new Date(d.created).getTime() / 1000 } }));

        if (newMessages.length < messagesLimit) {
          setHasMoreMessages(false);
        }
        setMessages(newMessages);

        if (isInitialLoadRef.current) {
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            if (messagesContainerRef.current) {
              messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
            }
          }, 50);
          isInitialLoadRef.current = false;
        } else if (lastScrollPosRef.current > 0 && messagesContainerRef.current) {
          requestAnimationFrame(() => {
            const container = messagesContainerRef.current;
            if (container) {
              const newHeight = container.scrollHeight;
              container.scrollTop = newHeight - lastScrollPosRef.current;
            }
            lastScrollPosRef.current = 0;
            setTimeout(() => { isLoadingMoreRef.current = false; }, 500);
          });
        }

        setOptimisticMessages(prev => prev.filter(om => !newMessages.some(m => m.tempId === om.tempId || (m.text === om.text && m.senderEmail === om.senderEmail && Math.abs((new Date(m.created).getTime()) - om.created) < 5000))));
      } catch (err) {
        console.error('Failed fetching messages', err);
        setIsChatLoading(false);
      }
    };

    fetchMessages();

    if (isEphemeralSelfChat) {
      return () => {
        isSubscribed = false;
      };
    }

    pb.collection('messages').subscribe('*', function (e) {
      if (e.record.contact === activeChat.id) {
        fetchMessages();
      }
    }).catch((err) => {
      console.warn('Realtime subscribe failed: messages', err);
    });

    return () => {
      isSubscribed = false;
      pb.collection('messages').unsubscribe('*');
    };
  }, [activeChat?.id, messagesLimit]);

  const handleScroll = () => {
    if (!messagesContainerRef.current || isLoadingMoreRef.current) return;
    const { scrollTop } = messagesContainerRef.current;

    // "5 messages from the top" threshold (approx 450px)
    if (scrollTop < 450 && hasMoreMessages && !isInitialLoadRef.current) {
      isLoadingMoreRef.current = true;
      lastScrollPosRef.current = messagesContainerRef.current.scrollHeight;
      setMessagesLimit(prev => prev + 15);
    }
  };

  // --- MESSAGE CACHE FLOW (7 Second Virtualization) ---
  useEffect(() => {
    if (messages.length === 0 || !activeChat) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const msgId = entry.target.getAttribute('data-id');
        if (!msgId) return;

        if (entry.isIntersecting) {
          setVisibleMessages(prev => {
            if (prev.has(msgId)) return prev;
            const next = new Set(prev);
            next.add(msgId);
            return next;
          });
          // Restore if pruned
          setPrunedMessageIds(prev => {
            if (prev.has(msgId)) {
              const next = new Set(prev);
              next.delete(msgId);
              return next;
            }
            return prev;
          });
        } else {
          setVisibleMessages(prev => {
            if (!prev.has(msgId)) return prev;
            const next = new Set(prev);
            next.delete(msgId);
            return next;
          });
        }
      });
    }, { threshold: 0.05 });

    const currentRefs = messagesRefs.current;
    currentRefs.forEach(ref => {
      if (ref) observer.observe(ref);
    });

    const pruneTimer = setInterval(() => {
      setPrunedMessageIds(prev => {
        const msgIds = messages.map(m => m.id).filter(Boolean);
        if (msgIds.length <= 20) return prev;

        const visibleArray = Array.from(visibleMessages);
        if (visibleArray.length === 0) return prev;

        const indices = msgIds.map((id, i) => visibleMessages.has(id) ? i : -1).filter(idx => idx !== -1);
        if (indices.length === 0) return prev;

        const minVisible = Math.min(...indices);
        const maxVisible = Math.max(...indices);

        const next = new Set(prev);
        msgIds.forEach((id, idx) => {
          if (idx < minVisible - 10 || idx > maxVisible + 10) {
            next.add(id);
          }
        });
        return next;
      });
    }, 7000);

    return () => {
      observer.disconnect();
      clearInterval(pruneTimer);
    };
  }, [messages.length, activeChat?.id, visibleMessages.size]);

  // Ensure we scroll to the bottom when messages change or when opening a chat.
  useEffect(() => {
    if (isInitialLoadRef.current || !messagesEndRef.current) return;
    // Only auto-scroll on new messages if we are already near bottom
    const container = messagesContainerRef.current;
    if (container) {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isNearBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages.length, optimisticMessages.length]);

  // Mark incoming messages as seen when opening the chat
  useEffect(() => {
    if (!activeChat || !userData) return;
    const markSeen = async () => {
      try {
        // Fix: Use getList instead of getFullList for scalability
        const records = await pb.collection('messages').getList(1, 50, {
          filter: `contact = "${activeChat.id}" && senderEmail != "${userData.email}" && seenAt = ""`
        });

        for (const msg of records.items) {
          await pb.collection('messages').update(msg.id, { seenAt: new Date().toISOString() });
        }
      } catch (err) {
        console.error('Failed to mark messages seen', err);
      }
    };
    markSeen();
  }, [activeChat, userData]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cove_recents_emojis') || '[]');
      if (Array.isArray(saved)) setRecents(saved);
    } catch (err) { /* ignore */ }
  }, []);

  // Restore theme preference from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('cove_dark_mode');
      if (stored !== null) setDarkMode(stored === 'true');
    } catch (e) { }
  }, []);

  useEffect(() => {
    if (emojiTab !== 'all' || allEmojiObjects.length > 0) return;
    // Lazy-load a comprehensive emoji dataset (uses unpkg CDN). This is optional and happens on demand.
    (async () => {
      try {
        const res = await fetch('https://unpkg.com/emoji.json@13.1.0/emoji.json');
        if (!res.ok) return;
        const data = await res.json();
        // data items usually have `char` and `name` fields
        const objs = data.map(item => ({ e: item.char, name: (item.name || '').toLowerCase() }));
        setAllEmojiObjects(objs);
      } catch (err) { console.error('Failed to load emoji list:', err); }
    })();
  }, [emojiTab, allEmojiObjects.length]);

  // --- ACTIONS ---
  const [authLoading, setAuthLoading] = useState(false);

  const handleAuth = async () => {
    if (!email || !email.includes('@')) {
      showToast("Enter a valid email", "error");
      return;
    }
    if (password.length < 6) {
      showToast("Password must be at least 6 characters", "error");
      return;
    }
    if (isSignUp && !username) {
      showToast("Please enter a username", "error");
      return;
    }

    const cleanEmail = email.toLowerCase().trim();
    setAuthLoading(true);

    try {
      if (isSignUp) {
        // Generate E2EE master RSA keypair for the user
        const { publicKey, privateKey } = await generateRSAKeyPair();

        // Securely package their private key using their password so ONLY THEY can read it
        // We do this locally so the server only ever receives opaque cyphertext
        const encryptedPrivateKey = encryptPrivateKeyWithPassword(privateKey, password);

        // Next, register user with PocketBase
        const data = {
          username: username || cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, ''),
          email: cleanEmail,
          emailVisibility: true,
          password: password,
          passwordConfirm: password,
          name: username,
          publicKey: publicKey, // store public key for others to encrypt with
          privateKeySecure: encryptedPrivateKey // securely wrapped private key
        };
        await pb.collection('users').create(data);
        await pb.collection('users').authWithPassword(cleanEmail, password);

        // Save the raw active private key locally onto the device
        localStorage.setItem('cove_master_key', privateKey);
        showToast("Welcome to Cove!", "success");
      } else {
        // Login Flow
        const authData = await pb.collection('users').authWithPassword(cleanEmail, password);

        // If they don't have the master key locally, decrypt it using their entered password
        // and safely drop just the raw text into local storage for the session
        if (!localStorage.getItem('cove_master_key') && authData.record.privateKeySecure) {
          try {
            const rawPrivateKey = decryptPrivateKeyWithPassword(authData.record.privateKeySecure, password);
            localStorage.setItem('cove_master_key', rawPrivateKey);
          } catch {
            console.error("Could not decrypt master key");
            showToast("Could not retrieve End-to-End Encryption key!", "error");
          }
        }
      }
    } catch (err) {
      console.error("Auth Error:", err);
      // Pocketbase error mapping
      if (err.status === 400 && isSignUp) {
        showToast("Username or email already in use / invalid", "error");
      } else if (err.status === 400) {
        showToast("Invalid email or password", "error");
      } else {
        showToast("Error: " + err.message, "error");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEmojiSelect = (emoji) => {
    setMessageInput(prev => prev + emoji);
    try {
      const next = [emoji, ...recents.filter(e => e !== emoji)].slice(0, 12);
      setRecents(next);
      localStorage.setItem('cove_recents_emojis', JSON.stringify(next));
    } catch (err) { /* ignore */ }
    setShowEmojiPicker(false);
  };

  const getEmojiCandidates = () => {
    let source = [];
    if (emojiTab === 'recents') source = recents;
    else if (emojiTab === 'recommended') source = RECOMMENDED_EMOJIS;
    else if (allEmojiObjects.length > 0) source = allEmojiObjects.map(o => o.e);
    else source = EMOJIS;

    if (!emojiSearch) return source;
    const q = emojiSearch.toLowerCase();

    // If we have name metadata, prefer searching names
    if (allEmojiObjects.length > 0) {
      return allEmojiObjects
        .filter(o => o.e && (o.name.includes(q) || o.e.includes(emojiSearch)))
        .map(o => o.e);
    }

    // Fallback: filter by character or basic keyword map
    return source.filter(e => {
      const d = EMOJI_DATA.find(x => x.e === e);
      return d ? d.k.includes(q) || e.includes(emojiSearch) : e.includes(emojiSearch);
    });
  };

  const deleteChat = async (chatId, e) => {
    if (e) e.stopPropagation();
    if (!confirm('Are you sure you want to delete this chat? This cannot be undone.')) return;
    try {
      // Scale fix: only fetch first 100 messages to delete, or delete by filter if server supports it
      const msgs = await pb.collection('messages').getList(1, 200, { filter: `contact = "${chatId}"` });
      for (const m of msgs.items) {
        await pb.collection('messages').delete(m.id);
      }
      await pb.collection('contacts').delete(chatId);
      if (activeChat?.id === chatId) setActiveChat(null);
    } catch (err) { console.error('Failed to delete chat', err); }
  };

  const deleteMessageWithConfirm = async (msgId) => {
    if (!window.confirm('Delete this message? This cannot be undone.')) return;
    try {
      await pb.collection('messages').delete(msgId);
      // Recompute lastMessage on the contact
      try {
        const remaining = await pb.collection('messages').getList(1, 1, {
          filter: `contact = "${activeChat.id}"`,
          sort: '-created'
        });
        if (remaining.items.length > 0) {
          const last = remaining.items[0];
          const newLastMessage = last.fileUrl ? `📎 ${last.text || ''}` : (last.text || '');
          await pb.collection('contacts').update(activeChat.id, { lastMessage: newLastMessage, lastSender: last.senderEmail || null });
        } else {
          await pb.collection('contacts').update(activeChat.id, { lastMessage: '', lastSender: null });
        }
      } catch (e) {
        console.error('Failed to recompute lastMessage after delete', e);
      }
    } catch (err) {
      console.error('Failed to delete message', err);
    }
  };

  const startEditMessage = (msg) => {
    setEditingMessageId(msg.id);
    setEditingText(msg.text || '');
  };

  const saveEditedMessage = async () => {
    if (!editingMessageId) return;
    try {
      await pb.collection('messages').update(editingMessageId, { text: editingText, edited: true, editedAt: new Date().toISOString() });
    } catch (err) {
      console.error('Failed to save edited message', err);
    } finally {
      setEditingMessageId(null);
      setEditingText('');
    }
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditingText('');
  };

  const togglePinChat = async (chatId) => {
    if (!chatId || !userData?.email) return;
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    const email = userData.email.toLowerCase();
    const pinnedBy = chat.pinnedBy || [];
    const isPinned = pinnedBy.includes(email);
    const updatedPinnedBy = isPinned ? pinnedBy.filter(e => e !== email) : [...pinnedBy, email];
    try {
      await pb.collection('contacts').update(chatId, { pinnedBy: updatedPinnedBy });
    } catch (err) { console.error('Failed to toggle pin', err); }
  };

  const reportAbuse = async (chatId) => {
    if (!chatId || !userData?.email) return;
    if (!window.confirm("Report this conversation for abuse?")) return;
    try {
      await pb.collection('reports').create({
        chatId,
        reportedBy: userData.email,
        status: 'pending'
      });
      showToast("Report submitted. Thank you.", "success");
    } catch (err) { console.error('Failed to report abuse', err); }
  };

  const toggleBlockContact = async (chatId) => {
    if (!chatId || !userData?.email || !activeChat) return;
    const partnerEmail = activeChat.participants.find(p => p !== userData.email);
    if (!partnerEmail) return;

    const blocked = userData.blocked || [];
    const isBlocked = blocked.includes(partnerEmail.toLowerCase());

    if (isBlocked) {
      if (!window.confirm(`Unblock ${partnerEmail}?`)) return;
    } else {
      if (!window.confirm(`Are you sure you want to block ${partnerEmail}? You will no longer receive messages from them.`)) return;
    }

    const updatedBlocked = isBlocked ? blocked.filter(e => e !== partnerEmail.toLowerCase()) : [...blocked, partnerEmail.toLowerCase()];
    try {
      await pb.collection('users').update(user.id, { blocked: updatedBlocked });
    } catch (err) { console.error('Failed to toggle block', err); }
  };

  // Cancel edit on Escape
  useEffect(() => {
    if (!editingMessageId) return;
    const onKey = (ev) => { if (ev.key === 'Escape') cancelEdit(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingMessageId]);

  // Close media modal on Escape
  useEffect(() => {
    if (!mediaModal) return;
    const onKey = (ev) => { if (ev.key === 'Escape') setMediaModal(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mediaModal]);

  const formatTimestamp = (ts) => {
    try {
      if (!ts) return 'Just now';
      const d = ts.seconds ? new Date(ts.seconds * 1000) : (ts instanceof Date ? ts : new Date(ts));
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  };

  const getPbErrorMessage = (err, fallback = 'Something went wrong.') => {
    const response = err?.response;
    if (response?.data && typeof response.data === 'object') {
      const fieldMessages = Object.values(response.data)
        .map((v) => (v && typeof v === 'object' ? v.message : null))
        .filter(Boolean);
      if (fieldMessages.length > 0) return fieldMessages.join(' | ');
    }
    if (response?.message && response.message !== 'Something went wrong.') {
      return response.message;
    }
    const statusPart = response?.status ? ` (status ${response.status})` : '';
    const dataPart = response?.data ? ` ${JSON.stringify(response.data)}` : '';
    return `${err?.message || fallback}${statusPart}${dataPart}`;
  };

  const handleInviteResponse = async (invite, approved) => {
    if (!approved) {
      if (!window.confirm('Decline and remove this invite?')) return;
    }
    try {
      if (approved) {
        const newContact = await pb.collection('contacts').create({
          participants: [invite.from.toLowerCase(), invite.to.toLowerCase()],
          lastMessage: "Conversation established",
          updated: new Date()
        });
        showToast('Invite Accepted!', 'success');
        fetchChats(1);
        setActiveChat(newContact);
      }
      await pb.collection('pending_requests').delete(invite.id);
    } catch (err) {
      console.error('Failed to respond to invite:', err);
      showToast('Action failed', 'error');
    }
  };

  const sendInvite = async () => {
    if (!inviteEmail || !userData) return;
    const cleanEmail = inviteEmail.toLowerCase().trim();
    const myEmail = userData.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      showToast('Enter a valid email address', 'error');
      return;
    }

    try {
      if (!pb.authStore.isValid) {
        try { await pb.collection('users').authRefresh(); } catch (e) { }
      }

      // Self-chat flow: create/open a personal conversation directly.
      if (cleanEmail === myEmail) {
        const selfChatId = `self_${myEmail.replace(/[^a-z0-9]/g, '_')}`;
        const existingSelfChat = chats.find((c) => {
          const participants = c.participants || [];
          return c.id === selfChatId || (participants.length > 0 && participants.every((p) => p.toLowerCase() === myEmail));
        });

        if (existingSelfChat) {
          setActiveChat(existingSelfChat);
          setShowInviteModal(false);
          setInviteEmail("");
          showToast('Opened your personal chat', 'success');
          return;
        }

        let selfContact;
        try {
          selfContact = await pb.collection('contacts').create({
            participants: [myEmail],
            lastMessage: 'Personal notes and files',
            lastSender: myEmail,
            isGroup: false
          });
        } catch (firstErr) {
          try {
            // Compatibility fallback for backends that implicitly expect 2 participants.
            selfContact = await pb.collection('contacts').create({
              participants: [myEmail, myEmail],
              lastMessage: 'Personal notes and files',
              lastSender: myEmail,
              isGroup: false
            });
          } catch (secondErr) {
            // Final fallback: local-only self chat so user can still use notes/files immediately.
            console.error('Self chat create failed on backend', { firstErr, secondErr });
            selfContact = {
              id: selfChatId,
              participants: [myEmail],
              lastMessage: 'Personal notes and files',
              lastSender: myEmail,
              isGroup: false
            };
            setChats((prev) => prev.some((c) => c.id === selfChatId) ? prev : [selfContact, ...prev]);
            try { localStorage.setItem(LOCAL_SELF_CHAT_KEY, JSON.stringify(selfContact)); } catch (e) { }
          }
        }
        await fetchChats(1);
        setActiveChat(selfContact);
        setShowInviteModal(false);
        setInviteEmail("");
        showToast('Personal chat created', 'success');
        return;
      }

      const existingContact = await pb.collection('contacts').getList(1, 1, {
        filter: `participants ~ "${myEmail}" && participants ~ "${cleanEmail}"`
      });
      if (existingContact.items.length > 0) {
        showToast('Conversation already exists', 'info');
        setShowInviteModal(false);
        setInviteEmail("");
        return;
      }

      const existingInvite = await pb.collection('pending_requests').getList(1, 1, {
        filter: `from = "${myEmail}" && to = "${cleanEmail}" && status = "pending"`
      });
      if (existingInvite.items.length > 0) {
        showToast('Invite already sent', 'info');
        setShowInviteModal(false);
        setInviteEmail("");
        return;
      }

      await pb.collection('pending_requests').create({
        from: myEmail,
        to: cleanEmail,
        status: 'pending'
      });
      showToast('Invite sent', 'success');
      setShowInviteModal(false);
      setInviteEmail("");
    } catch (err) {
      console.error('Failed to send invite:', err);
      const msg = getPbErrorMessage(err, 'Could not send invite');
      showToast(msg, 'error');
    }
  };

  // --- GROUP CHAT FUNCTIONS ---
  const createGroupChat = async () => {
    if (!groupName.trim() || !userData) return;
    const emails = groupEmails.split(',').map(e => e.trim().toLowerCase()).filter(e => e && e !== userData.email.toLowerCase());
    if (emails.length < 1) { showToast('Add at least one member', 'error'); return; }
    const participants = [userData.email.toLowerCase(), ...emails];
    try {
      await pb.collection('contacts').create({
        participants,
        isGroup: true,
        groupName: groupName.trim(),
        groupPhoto: null,
        admins: [userData.email.toLowerCase()],
        createdBy: userData.email.toLowerCase(),
        lastMessage: `${userData.name || userData.email.split('@')[0]} created the group`,
        lastSender: userData.email
      });
      showToast('Group created!', 'success');
      setShowGroupModal(false);
      setGroupName('');
      setGroupEmails('');
    } catch (err) { console.error('Failed to create group', err); showToast('Failed to create group', 'error'); }
  };

  const addGroupMember = async (chatId, email) => {
    if (!email || !chatId) return;
    const chat = chats.find(c => c.id === chatId);
    if (!chat?.isGroup) return;
    const clean = email.toLowerCase().trim();
    if (chat.participants.includes(clean)) { showToast('Already a member', 'error'); return; }
    try {
      await pb.collection('contacts').update(chatId, {
        participants: [...chat.participants, clean],
        lastMessage: `${clean.split('@')[0]} was added`,
        lastSender: userData.email
      });
      showToast('Member added', 'success');
      setAddMemberEmail('');
    } catch (err) { console.error(err); showToast('Failed to add member', 'error'); }
  };

  const removeGroupMember = async (chatId, email) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat?.isGroup) return;
    if (!chat.admins?.includes(userData.email.toLowerCase())) { showToast('Only admins can remove members', 'error'); return; }
    if (!window.confirm(`Remove ${email.split('@')[0]} from the group?`)) return;
    try {
      const updated = chat.participants.filter(p => p !== email.toLowerCase());
      const updatedAdmins = (chat.admins || []).filter(a => a !== email.toLowerCase());
      await pb.collection('contacts').update(chatId, {
        participants: updated,
        admins: updatedAdmins,
        lastMessage: `${email.split('@')[0]} was removed`,
        lastSender: userData.email
      });
      showToast('Member removed', 'success');
    } catch (err) { console.error(err); }
  };

  const toggleAdmin = async (chatId, email) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat?.isGroup) return;
    if (!chat.admins?.includes(userData.email.toLowerCase())) { showToast('Only admins can manage admins', 'error'); return; }
    const isAdmin = chat.admins?.includes(email.toLowerCase());
    const updatedAdmins = isAdmin ? chat.admins.filter(a => a !== email.toLowerCase()) : [...(chat.admins || []), email.toLowerCase()];
    try {
      await pb.collection('contacts').update(chatId, { admins: updatedAdmins });
      showToast(isAdmin ? 'Admin removed' : 'Admin added', 'success');
    } catch (err) { console.error(err); }
  };

  const leaveGroup = async (chatId) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat?.isGroup) return;
    if (!window.confirm('Leave this group? You will need to be re-added to rejoin.')) return;
    const updated = chat.participants.filter(p => p !== userData.email.toLowerCase());
    const updatedAdmins = (chat.admins || []).filter(a => a !== userData.email.toLowerCase());
    try {
      await pb.collection('contacts').update(chatId, {
        participants: updated,
        admins: updatedAdmins.length > 0 ? updatedAdmins : (updated.length > 0 ? [updated[0]] : []),
        lastMessage: `${userData.name || userData.email.split('@')[0]} left the group`,
        lastSender: userData.email
      });
      setActiveChat(null);
      showToast('You left the group', 'info');
    } catch (err) { console.error(err); }
  };

  const updateGroupPhoto = async (chatId, file) => {
    if (!file || !chatId) return;
    try {
      const url = await uploadFileToStorage(file);
      if (url) {
        await pb.collection('contacts').update(chatId, { groupPhoto: url });
        showToast('Group photo updated', 'success');
      }
    } catch (err) { console.error(err); showToast('Failed to update photo', 'error'); }
  };

  const handleProfileUpdate = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadFileToStorage(file);
      if (url) {
        await pb.collection('users').update(user.id, { photoURL: url });
        showToast('Profile photo updated', 'success');
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to update profile photo', 'error');
    }
    finally { setUploading(false); }
  };

  const upsertDeepQueue = (attachment, patch = {}) => {
    if (!attachment?.attachmentId) return;
    setDeepShadowQueue(prev => {
      const existing = prev?.[attachment.attachmentId] || {
        attachmentId: attachment.attachmentId,
        fingerprint: attachment.fingerprint || '',
        attempts: 0,
        status: 'idle',
        updatedAt: Date.now()
      };
      return {
        ...(prev || {}),
        [attachment.attachmentId]: {
          ...existing,
          ...patch,
          fingerprint: attachment.fingerprint || existing.fingerprint || '',
          updatedAt: Date.now()
        }
      };
    });
  };

  const fingerprintFile = (file) => `${file?.name || 'file'}::${file?.size || 0}::${file?.type || 'unknown'}::${file?.lastModified || 0}`;

  const tryExtractVideoFirst60Audio = async (videoFile) => {
    if (typeof document === 'undefined') return null;
    const canCapture = typeof HTMLMediaElement !== 'undefined'
      && (HTMLMediaElement.prototype.captureStream || HTMLMediaElement.prototype.mozCaptureStream);
    if (!canCapture) return null;

    return new Promise((resolve) => {
      const url = URL.createObjectURL(videoFile);
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';

      const cleanup = () => {
        try { URL.revokeObjectURL(url); } catch (e) { }
      };

      video.onloadedmetadata = async () => {
        try {
          const stream = (video.captureStream ? video.captureStream() : video.mozCaptureStream());
          const hasAudioTrack = stream?.getAudioTracks?.().length > 0;
          if (!hasAudioTrack) {
            cleanup();
            resolve(null);
            return;
          }

          const chunks = [];
          let recorder = null;
          try {
            recorder = MediaRecorder.isTypeSupported('audio/webm')
              ? new MediaRecorder(stream, { mimeType: 'audio/webm' })
              : new MediaRecorder(stream);
          } catch (e) {
            cleanup();
            resolve(null);
            return;
          }

          recorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
          };
          recorder.onstop = () => {
            try { stream.getTracks().forEach(t => t.stop()); } catch (e) { }
            cleanup();
            if (!chunks.length) {
              resolve(null);
              return;
            }
            const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
            const audioFile = new File([blob], `video-first60-${Date.now()}.webm`, { type: blob.type });
            resolve(audioFile);
          };

          await video.play().catch(() => { });
          recorder.start(1000);
          const ms = Math.max(5000, Math.min(60000, ((video.duration || 60) * 1000)));
          setTimeout(() => {
            try {
              if (recorder.state !== 'inactive') recorder.stop();
              video.pause();
            } catch (e) { resolve(null); }
          }, ms);
        } catch (e) {
          cleanup();
          resolve(null);
        }
      };

      video.onerror = () => {
        cleanup();
        resolve(null);
      };

      video.src = url;
    });
  };

  const kickOffDeepShadowExtraction = async (attachment, options = {}) => {
    if (!attachment?.attachmentId || !attachment?.fileType || !attachment?.file) return;
    if (shadowModeRef.current !== 'full') return;
    if (!['image', 'audio', 'video'].includes(attachment.fileType)) return;
    if (deepShadowInFlightRef.current.has(attachment.attachmentId)) return;
    const force = !!options.force;
    const queueEntry = deepShadowQueueRef.current?.[attachment.attachmentId];
    const attemptCount = queueEntry?.attempts || 0;
    if (!force && attemptCount > MAX_DEEP_SHADOW_RETRIES) return;
    const deepStartedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    deepShadowInFlightRef.current.add(attachment.attachmentId);
    upsertDeepQueue(attachment, { status: 'processing', attempts: force ? 0 : attemptCount });
    setPendingAttachments(prev => prev.map(att => (
      att.attachmentId === attachment.attachmentId ? { ...att, deepShadowStatus: 'processing' } : att
    )));

    try {
      let targetFile = attachment.file;
      let targetType = attachment.fileType;
      let deepPrefix = '';

      // Video path: prioritize first 60s audio extraction for faster retrieval.
      if (attachment.fileType === 'video') {
        const first60Audio = await tryExtractVideoFirst60Audio(attachment.file);
        if (first60Audio) {
          targetFile = first60Audio;
          targetType = 'audio';
          deepPrefix = '[Video first 60s ASR] ';
        }
      }

      const deepText = await runDeepShadowJob({ file: targetFile, fileType: targetType });
      if (!deepText) {
        upsertDeepQueue(attachment, { status: 'failed', error: 'No deep text extracted', attempts: attemptCount + 1 });
        setPendingAttachments(prev => prev.map(att => (
          att.attachmentId === attachment.attachmentId ? { ...att, deepShadowStatus: 'error' } : att
        )));
        if (attemptCount + 1 <= MAX_DEEP_SHADOW_RETRIES) {
          const retryDelayMs = 1500 * (attemptCount + 1);
          setTimeout(() => kickOffDeepShadowExtraction(attachment), retryDelayMs);
        }
        return;
      }

      const senderName = userData?.name || (userData?.email || '').split('@')[0] || 'User';
      const mergedShadow = `[Sent by ${senderName}] ${attachment.shadowText ? `${attachment.shadowText}\n` : ''}${deepPrefix}${deepText}`.trim();
      setPendingAttachments(prev => prev.map(att => (
        att.attachmentId === attachment.attachmentId
          ? { ...att, shadowText: mergedShadow, deepShadowStatus: 'ready' }
          : att
      )));

      if (attachment.chatId) {
        const shadowDocs = [{
          id: `shadow_deep_${attachment.chatId}_${attachment.attachmentId}`,
          chatId: attachment.chatId,
          source: 'file-shadow-deep',
          text: mergedShadow,
          ts: Date.now()
        }];
        // Create a fact doc from OCR/ASR content for better retrieval
        if (deepText && deepText.length > 5) {
          const fileLabel = attachment.file?.name || attachment.fileType || 'file';
          const factPrefix = attachment.fileType === 'image'
            ? `FACT: Image '${fileLabel}' sent by ${senderName} shows: `
            : attachment.fileType === 'audio'
            ? `FACT: Audio '${fileLabel}' sent by ${senderName} contains: `
            : `FACT: Video '${fileLabel}' sent by ${senderName} contains: `;
          shadowDocs.push({
            id: `fact_deep_${attachment.chatId}_${attachment.attachmentId}`,
            chatId: attachment.chatId,
            source: 'fact',
            text: `${factPrefix}${deepText.slice(0, 500)}`,
            ts: Date.now()
          });
        }
        upsertShadowDocuments(shadowDocs);
      }
      const elapsed = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - deepStartedAt);
      diagRef.current.deepTotalMs += elapsed;
      diagRef.current.deepRuns += 1;
      upsertDeepQueue(attachment, { status: 'ready', attempts: attemptCount, error: null });
      refreshSpeedDemonDiag();
    } catch (err) {
      console.warn('Deep shadow extraction failed:', err);
      const nextAttempts = attemptCount + 1;
      upsertDeepQueue(attachment, { status: 'failed', attempts: nextAttempts, error: err?.message || 'Deep extraction failed' });
      setPendingAttachments(prev => prev.map(att => (
        att.attachmentId === attachment.attachmentId ? { ...att, deepShadowStatus: 'error' } : att
      )));
      if (nextAttempts <= MAX_DEEP_SHADOW_RETRIES) {
        const retryDelayMs = 1500 * nextAttempts;
        setTimeout(() => kickOffDeepShadowExtraction(attachment), retryDelayMs);
      }
      refreshSpeedDemonDiag();
    } finally {
      deepShadowInFlightRef.current.delete(attachment.attachmentId);
    }
  };

  const kickOffAttachmentShadow = async (attachment) => {
    if (!attachment?.attachmentId || !attachment?.file) return;
    setPendingAttachments(prev => prev.map(att => (
      att.attachmentId === attachment.attachmentId ? { ...att, shadowStatus: 'processing' } : att
    )));

    try {
      const shadowText = await extractShadowTextFromFile(attachment.file, {
        mode: shadowModeRef.current
      });

      setPendingAttachments(prev => prev.map(att => (
        att.attachmentId === attachment.attachmentId ? { ...att, shadowStatus: 'ready', shadowText } : att
      )));

      if (attachment.chatId && shadowText) {
        const preSenderName = userData?.name || (userData?.email || '').split('@')[0] || 'User';
        upsertShadowDocuments([{
          id: `shadow_pre_${attachment.chatId}_${attachment.attachmentId}`,
          chatId: attachment.chatId,
          source: 'file-shadow',
          text: `[Sent by ${preSenderName}] ${shadowText}`,
          ts: Date.now()
        }]);
      }

      // Stage 2.1 deep extraction pass (on-device OCR / ASR) in full mode.
      kickOffDeepShadowExtraction({
        ...attachment,
        shadowText
      });
    } catch (err) {
      console.warn('Shadow extraction failed:', err);
      setPendingAttachments(prev => prev.map(att => (
        att.attachmentId === attachment.attachmentId ? { ...att, shadowStatus: 'error' } : att
      )));
    }
  };

  const buildPendingAttachment = (file) => {
    const previewUrl = URL.createObjectURL(file);
    let fileType = 'file';
    if (file.type.startsWith('image')) fileType = 'image';
    else if (file.type.startsWith('audio')) fileType = 'audio';
    else if (file.type.startsWith('video')) fileType = 'video';
    return {
      file,
      previewUrl,
      fileType,
      uploadedUrl: null,
      attachmentId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fingerprint: fingerprintFile(file),
      chatId: activeChat?.id || null,
      shadowText: '',
      shadowStatus: 'queued',
      deepShadowStatus: 'idle'
    };
  };

  const handleChatFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files || files.length === 0) return;

    // Create local previews for each file and defer upload until sendMessage
    try {
      const toAdd = files.map(buildPendingAttachment);
      setPendingAttachments(prev => [...prev, ...toAdd]);
      toAdd.forEach(kickOffAttachmentShadow);
      // clear the input value so the same files can be selected again if removed
      e.target.value = '';
    } catch (err) {
      console.error('Failed to create file preview', err);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    try {
      const files = [];
      // Prefer items when available (more reliable for drag from other apps)
      const items = e.dataTransfer?.items;
      let file = null;
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.kind === 'file') { file = it.getAsFile(); break; }
        }
      }
      if (!file) {
        if (e.dataTransfer?.files?.length) {
          for (let i = 0; i < e.dataTransfer.files.length; i++) files.push(e.dataTransfer.files[i]);
        }
      } else {
        files.push(file);
      }
      if (files.length === 0) return;
      const toAdd = files.map(buildPendingAttachment);
      setPendingAttachments(prev => [...prev, ...toAdd]);
      toAdd.forEach(kickOffAttachmentShadow);
    } catch (err) { console.error('Failed to handle drop file', err); }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } catch (e) { }
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = (dragCounterRef.current || 0) + 1;
    try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } catch (e) { }
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, (dragCounterRef.current || 0) - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  };

  const handlePaste = (e) => {
    try {
      if (e && e.stopPropagation) e.stopPropagation();
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            const next = buildPendingAttachment(file);
            setPendingAttachments(prev => [...prev, next]);
            kickOffAttachmentShadow(next);
            e.preventDefault();
            break;
          }
        }
      }
    } catch (err) { console.error('Paste handling failed', err); }
  };

  // Attach a global paste listener so pasted images are captured even
  // if the input isn't focused (helps desktop paste from clipboard)
  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    // Also prevent the browser from navigating when files are dropped outside the app
    const preventDefault = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  const startRecording = async () => {
    setUploadError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: audioChunksRef.current[0]?.type || 'audio/webm' });
        const fileObj = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
        const next = buildPendingAttachment(fileObj);
        setPendingAttachments(prev => [...prev, next]);
        kickOffAttachmentShadow(next);
        // stop all tracks
        try { stream.getTracks().forEach(t => t.stop()); } catch (e) { }
        mediaRecorderRef.current = null;
        audioChunksRef.current = [];
        setIsRecording(false);
      };
      mr.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone access denied or error', err);
      setUploadError('Microphone access denied');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      setIsRecording(false);
    }
  };

  const uploadFileToStorage = async (file) => {
    if (!WORKER_URL || WORKER_URL.includes('your-worker-subdomain')) {
      throw new Error("Storage Worker URL not configured in .env.local");
    }

    const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;

    const headers = {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': filename
    };
    if (STORAGE_UPLOAD_TOKEN) {
      headers.Authorization = `Bearer ${STORAGE_UPLOAD_TOKEN}`;
    }

    const res = await fetch(`${WORKER_URL}/upload`, {
      method: 'POST',
      headers,
      body: file
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    return data.url;
  };

  const sendMessage = async (dataOverride = null) => {
    if (isSending && !pendingAttachments.length) return; // Allow sending if it's just text while others are sending
    const text = dataOverride?.text ?? messageInput;
    if (!activeChat) return;

    const tempId = Math.random().toString(36).substring(7);
    const optimisticBase = {
      tempId,
      senderEmail: userData.email,
      text: text?.trim(),
      created: Date.now(),
      status: 'sending',
      replyTo: replyTo ? { text: replyTo.text, sender: replyTo.senderEmail } : null
    };

    // Add optimistic message(s)
    let toSend = [];
    if (text?.trim() && pendingAttachments.length === 1) {
      toSend.push({ ...optimisticBase, fileUrl: pendingAttachments[0].previewUrl, fileType: pendingAttachments[0].fileType, status: 'uploading' });
    } else {
      if (text?.trim()) toSend.push({ ...optimisticBase });
      pendingAttachments.forEach(att => {
        toSend.push({ ...optimisticBase, text: att.file?.name || '', fileUrl: att.previewUrl, fileType: att.fileType, status: 'uploading', tempId: Math.random().toString(36).substring(7) });
      });
    }

    setOptimisticMessages(prev => [...prev, ...toSend]);
    setMessageInput("");
    setReplyTo(null);
    setShowEmojiPicker(false);
    const currentAttachments = [...pendingAttachments];
    setPendingAttachments([]);

    try {
      // Background processing
      if (currentAttachments.length > 0) {
        for (let i = 0; i < currentAttachments.length; i++) {
          const att = currentAttachments[i];
          if (!att.uploadedUrl && att.file) {
            try {
              const fileUrl = await uploadFileToStorage(att.file);
              att.uploadedUrl = fileUrl;
              // update status in optimistic
              setOptimisticMessages(prev => prev.map(m => m.fileUrl === att.previewUrl ? { ...m, status: 'sending' } : m));
            } catch (err) {
              console.error('Attachment upload failed', err);
              setOptimisticMessages(prev => prev.map(m => m.fileUrl === att.previewUrl ? { ...m, status: 'error' } : m));
              return;
            }
          }
        }
      }

      const isEphemeralSelfChat = String(activeChat.id || '').startsWith('self_');
      const syncEphemeralSelfMeta = (lastMessageText) => {
        if (!isEphemeralSelfChat) return;
        const nextChat = {
          ...activeChat,
          lastMessage: lastMessageText || activeChat.lastMessage || '',
          lastSender: userData.email
        };
        setChats((prev) => {
          const exists = prev.some((c) => c.id === nextChat.id);
          if (!exists) return [nextChat, ...prev];
          return prev.map((c) => (c.id === nextChat.id ? { ...c, ...nextChat } : c));
        });
        setActiveChat(nextChat);
        try { localStorage.setItem(LOCAL_SELF_CHAT_KEY, JSON.stringify(nextChat)); } catch (e) { }
      };
      // --- E2EE: Build public key map for all participants ---
      const participantsPublicKeysMap = {};
      for (const pEmail of (activeChat.participants || [])) {
        const pUser = userLookup[pEmail.toLowerCase()];
        if (pUser?.publicKey) participantsPublicKeysMap[pEmail.toLowerCase()] = pUser.publicKey;
      }
      const hasE2EE = Object.keys(participantsPublicKeysMap).length > 0;

      // Helper to create a PB message record (with optional E2EE)
      const createPBMessage = async (msgData) => {
        if (isEphemeralSelfChat) {
          const localKey = `${LOCAL_SELF_CHAT_MSG_PREFIX}${activeChat.id}`;
          const localMsg = {
            id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            contact: activeChat.id,
            senderEmail: userData.email,
            text: msgData.text,
            fileUrl: msgData.fileUrl || null,
            fileType: msgData.fileType || null,
            replyTo: msgData.replyTo || null,
            tempId: msgData.tempId,
            created: new Date().toISOString()
          };
          try {
            const raw = localStorage.getItem(localKey);
            const prev = raw ? JSON.parse(raw) : [];
            const next = Array.isArray(prev) ? [...prev, localMsg] : [localMsg];
            localStorage.setItem(localKey, JSON.stringify(next));
          } catch (e) { }
          return;
        }
        if (hasE2EE) {
          const payloadJson = JSON.stringify({ text: msgData.text, fileUrl: msgData.fileUrl, fileType: msgData.fileType, replyTo: msgData.replyTo });
          const { encryptedPayload, encryptedKeys } = await encryptMessagePayloadForUsers(payloadJson, participantsPublicKeysMap);
          await pb.collection('messages').create({
            contact: activeChat.id,
            senderEmail: userData.email,
            encryptedPayload,
            encryptedKeys: JSON.stringify(encryptedKeys),
            tempId: msgData.tempId
          });
        } else {
          await pb.collection('messages').create({
            contact: activeChat.id,
            text: msgData.text,
            fileUrl: msgData.fileUrl || null,
            fileType: msgData.fileType || null,
            senderEmail: userData.email,
            replyTo: msgData.replyTo ? JSON.stringify(msgData.replyTo) : null,
            tempId: msgData.tempId
          });
        }
      };

      if (text?.trim() && currentAttachments.length === 1) {
        const att = currentAttachments[0];
        const msgData = {
          text: text.trim(),
          fileUrl: att.uploadedUrl || null,
          fileType: att.fileType || null,
          replyTo: optimisticBase.replyTo,
          tempId
        };
        await createPBMessage(msgData);
        const shadowBits = [att.shadowText, msgData.text, att.file?.name, att.fileType].filter(Boolean).join(' | ');
        if (shadowBits) {
          upsertShadowDocuments([{
            id: `shadow_sent_${activeChat.id}_${msgData.tempId || Date.now()}`,
            chatId: activeChat.id,
            source: 'file-shadow',
            text: shadowBits,
            ts: Date.now()
          }]);
        }
        if (!isEphemeralSelfChat) {
          await pb.collection('contacts').update(activeChat.id, { lastMessage: msgData.fileUrl ? `📎 ${msgData.text}` : msgData.text, lastSender: userData.email });
        } else {
          syncEphemeralSelfMeta(msgData.fileUrl ? `📎 ${msgData.text}` : msgData.text);
        }
      } else {
        if (text?.trim()) {
          const msgData = {
            text: text.trim(),
            fileUrl: null,
            fileType: null,
            replyTo: optimisticBase.replyTo,
            tempId
          };
          await createPBMessage(msgData);
          if (!isEphemeralSelfChat) {
            await pb.collection('contacts').update(activeChat.id, { lastMessage: msgData.text, lastSender: userData.email });
          } else {
            syncEphemeralSelfMeta(msgData.text);
          }
        }

        for (let i = 0; i < currentAttachments.length; i++) {
          const att = currentAttachments[i];
          const msgData = {
            text: att.file?.name || '',
            fileUrl: att.uploadedUrl || null,
            fileType: att.fileType || null,
            replyTo: null,
            tempId: toSend.find(ts => ts.fileUrl === att.previewUrl)?.tempId || Math.random().toString(36).substring(7)
          };
          await createPBMessage(msgData);
          const shadowBits = [att.shadowText, msgData.text, att.file?.name, att.fileType].filter(Boolean).join(' | ');
          if (shadowBits) {
            upsertShadowDocuments([{
              id: `shadow_sent_${activeChat.id}_${msgData.tempId || `${Date.now()}_${i}`}`,
              chatId: activeChat.id,
              source: 'file-shadow',
              text: shadowBits,
              ts: Date.now()
            }]);
          }
          if (!isEphemeralSelfChat) {
            await pb.collection('contacts').update(activeChat.id, { lastMessage: msgData.fileUrl ? `📎 ${msgData.text}` : msgData.text, lastSender: userData.email });
          } else {
            syncEphemeralSelfMeta(msgData.fileUrl ? `📎 ${msgData.text}` : msgData.text);
          }
        }
      }
    } catch (err) {
      console.error('SendMessage failed', err);
      showToast('Failed to send message', 'error');
    } finally {
      // isSending handled if we want to block, but here we allow concurrent.
      // cleanup local blobs?
    }
  };

  // --- WEBRTC CALLING LOGIC (PocketBase Signaling + Adaptive Bitrate) ---
  const servers = {
    iceServers: buildIceServers(),
    iceCandidatePoolSize: 10,
  };

  const [isRelayConnection, setIsRelayConnection] = useState(false);

  // Adaptive Bitrate: check connection type and cap resolution if relay
  const checkConnectionAndAdapt = useCallback(async (pc, callId) => {
    if (!pc || pc.connectionState === 'closed') return;
    try {
      const stats = await pc.getStats();
      let isRelay = false;
      stats.forEach(report => {
        if (report.type === 'local-candidate' && report.candidateType === 'relay') {
          isRelay = true;
        }
        if (report.type === 'remote-candidate' && report.candidateType === 'relay') {
          isRelay = true;
        }
      });

      if (isRelay && !isRelayConnection) {
        setIsRelayConnection(true);
        showToast("Low Bandwidth Mode: Call routed via relay, limited to 360p for stability.", "info");
        // Cap video to 360p
        const senders = pc.getSenders();
        for (const sender of senders) {
          if (sender.track?.kind === 'video') {
            await sender.track.applyConstraints({ width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 360 } });
          }
        }
        // Inform peer via PocketBase
        try {
          await pb.collection('calls').update(callId, { relayDetected: true, maxResolution: '360p' });
        } catch (e) { console.warn('Could not update signaling for relay', e); }
      } else if (!isRelay && isRelayConnection) {
        // Direct path promotion: remove 360p cap
        setIsRelayConnection(false);
        showToast("Connection upgraded to direct path! HD enabled.", "success");
        const senders = pc.getSenders();
        for (const sender of senders) {
          if (sender.track?.kind === 'video') {
            await sender.track.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 } });
          }
        }
        try {
          await pb.collection('calls').update(callId, { relayDetected: false, maxResolution: '720p' });
        } catch (e) { }
      }
    } catch (e) { console.warn('getStats failed', e); }
  }, [isRelayConnection]);

  const endCall = async () => {
    console.log("DEBUG: Ending call and cleaning up...");

    // Cleanup PocketBase subscriptions for calls
    unsubsRef.current.forEach(u => { try { u(); } catch (e) { } });
    unsubsRef.current = [];

    if (pcRef.current) {
      try { pcRef.current.close(); } catch (e) { }
      pcRef.current = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    setRemoteStream(null);
    setIsRelayConnection(false);

    if (call?.id) {
      handledCallsRef.current.add(call.id);
      try {
        await pb.collection('calls').update(call.id, { status: 'ended', endedAt: new Date().toISOString() });
      } catch (e) { }
    }
    setCall(null);
    candidateQueueRef.current = [];
    setIsMicMuted(false);
    setIsCameraOff(false);
    notificationShownRef.current = null;
  };

  const startCall = async (type = 'video') => {
    if (!activeChat || !userData || call) return;
    console.log("DEBUG: Starting call of type:", type);

    const receiverEmail = activeChat.isGroup ? null : activeChat.participants.find(p => p !== userData.email);
    if (!receiverEmail) {
      showToast("Calls are currently only supported in 1-on-1 chats", "info");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video'
      });
      setLocalStream(stream);

      const pc = new RTCPeerConnection(servers);
      pcRef.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        console.log("DEBUG: Received remote track");
        setRemoteStream(event.streams[0]);
      };

      const offerDescription = await pc.createOffer();
      await pc.setLocalDescription(offerDescription);

      // Create call record in PocketBase
      const callRecord = await pb.collection('calls').create({
        type,
        caller: userData.email,
        receiver: receiverEmail,
        status: 'dialing',
        offer: JSON.stringify({ sdp: offerDescription.sdp, type: offerDescription.type })
      });

      setCall({ id: callRecord.id, type, caller: userData.email, receiver: receiverEmail, status: 'dialing', isIncoming: false });

      // Timeout for no answer (30 seconds)
      const timeout = setTimeout(() => {
        if (pcRef.current && pcRef.current.signalingState !== 'stable') {
          showToast("Call timed out: No answer", "info");
          endCall();
        }
      }, 30000);

      // Listen for call updates via PocketBase realtime
      await pb.collection('calls').subscribe(callRecord.id, async (e) => {
        const data = e.record;
        if (!data || !pcRef.current) return;

        setCall(prev => prev ? { ...prev, ...data } : null);

        // Check for relay connection and adapt
        if (data.relayDetected && pcRef.current) {
          const senders = pcRef.current.getSenders();
          for (const sender of senders) {
            if (sender.track?.kind === 'video') {
              await sender.track.applyConstraints({ width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 360 } });
            }
          }
          setIsRelayConnection(true);
        }

        if (!pcRef.current.currentRemoteDescription && data.answer) {
          clearTimeout(timeout);
          console.log("DEBUG: Call answered, setting remote description");
          const answerData = typeof data.answer === 'string' ? JSON.parse(data.answer) : data.answer;
          const answerDescription = new RTCSessionDescription(answerData);
          await pcRef.current.setRemoteDescription(answerDescription);

          // Process queued candidates
          console.log(`DEBUG: Processing ${candidateQueueRef.current.length} queued candidates`);
          candidateQueueRef.current.forEach(cand => {
            if (pcRef.current) pcRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.error("ICE Queue Error:", e));
          });
          candidateQueueRef.current = [];
        }

        if (data.status === 'ended' || data.status === 'rejected') {
          clearTimeout(timeout);
          endCall();
        }
      });
      unsubsRef.current.push(() => pb.collection('calls').unsubscribe(callRecord.id));

      // Listen for ICE candidates from receiver via PocketBase
      await pb.collection('ice_candidates').subscribe('*', (e) => {
        if (e.action === 'create' && e.record.callId === callRecord.id && e.record.sender === 'receiver' && pcRef.current) {
          const candData = typeof e.record.candidate === 'string' ? JSON.parse(e.record.candidate) : e.record.candidate;
          if (pcRef.current.currentRemoteDescription) {
            pcRef.current.addIceCandidate(new RTCIceCandidate(candData)).catch(err => console.error("ICE Add Error:", err));
          } else {
            candidateQueueRef.current.push(candData);
          }
        }
      });
      unsubsRef.current.push(() => pb.collection('ice_candidates').unsubscribe('*'));

      // Send local ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          pb.collection('ice_candidates').create({
            callId: callRecord.id,
            sender: 'caller',
            candidate: JSON.stringify(event.candidate.toJSON())
          }).catch(e => console.warn('ICE candidate send failed', e));
        }
      };

      // Start adaptive bitrate monitoring after connection
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          checkConnectionAndAdapt(pc, callRecord.id);
          // Re-check periodically
          const interval = setInterval(() => {
            if (pcRef.current && pcRef.current.connectionState === 'connected') {
              checkConnectionAndAdapt(pcRef.current, callRecord.id);
            } else {
              clearInterval(interval);
            }
          }, 10000);
        }
      };

    } catch (err) {
      console.error("Start call failed:", err);
      showToast("Could not start call: " + err.message, "error");
      endCall();
    }
  };

  const joinCall = async (incomingCall) => {
    console.log("DEBUG: Joining incoming call:", incomingCall.id);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: incomingCall.type === 'video'
      });
      setLocalStream(stream);

      const pc = new RTCPeerConnection(servers);
      pcRef.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
      };

      setCall(prev => ({ ...prev, status: 'connecting' }));
      await pb.collection('calls').update(incomingCall.id, { status: 'connecting' });

      const offerData = typeof incomingCall.offer === 'string' ? JSON.parse(incomingCall.offer) : incomingCall.offer;
      const offerDescription = new RTCSessionDescription(offerData);
      await pc.setRemoteDescription(offerDescription);
      console.log("DEBUG: Remote description set on join");

      // Process any queued candidates
      candidateQueueRef.current.forEach(cand => {
        pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.log("ICE Queue Error:", e));
      });
      candidateQueueRef.current = [];

      const answerDescription = await pc.createAnswer();
      await pc.setLocalDescription(answerDescription);

      await pb.collection('calls').update(incomingCall.id, {
        answer: JSON.stringify({ type: answerDescription.type, sdp: answerDescription.sdp }),
        status: 'ongoing'
      });

      // Send local ICE candidates to caller
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          pb.collection('ice_candidates').create({
            callId: incomingCall.id,
            sender: 'receiver',
            candidate: JSON.stringify(event.candidate.toJSON())
          }).catch(e => console.warn('ICE candidate send failed', e));
        }
      };

      // Listen for ICE candidates from caller
      await pb.collection('ice_candidates').subscribe('*', (e) => {
        if (e.action === 'create' && e.record.callId === incomingCall.id && e.record.sender === 'caller' && pcRef.current) {
          const candData = typeof e.record.candidate === 'string' ? JSON.parse(e.record.candidate) : e.record.candidate;
          if (pcRef.current.currentRemoteDescription) {
            pcRef.current.addIceCandidate(new RTCIceCandidate(candData)).catch(err => console.log("ICE Join Error:", err));
          } else {
            candidateQueueRef.current.push(candData);
          }
        }
      });
      unsubsRef.current.push(() => pb.collection('ice_candidates').unsubscribe('*'));

      // Listen for call updates
      await pb.collection('calls').subscribe(incomingCall.id, (e) => {
        const data = e.record;
        if (!data) return;
        setCall(prev => prev ? { ...prev, ...data } : null);

        // Check for relay detection from peer
        if (data.relayDetected && pcRef.current) {
          const senders = pcRef.current.getSenders();
          senders.forEach(async sender => {
            if (sender.track?.kind === 'video') {
              await sender.track.applyConstraints({ width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 360 } });
            }
          });
          setIsRelayConnection(true);
          showToast("Low Bandwidth Mode: Peer detected relay, capping to 360p.", "info");
        }

        if (data.status === 'ended' || data.status === 'rejected') {
          endCall();
        }
      });
      unsubsRef.current.push(() => pb.collection('calls').unsubscribe(incomingCall.id));

      // Start adaptive bitrate monitoring
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          checkConnectionAndAdapt(pc, incomingCall.id);
          const interval = setInterval(() => {
            if (pcRef.current && pcRef.current.connectionState === 'connected') {
              checkConnectionAndAdapt(pcRef.current, incomingCall.id);
            } else {
              clearInterval(interval);
            }
          }, 10000);
        }
      };

    } catch (err) {
      console.error("Join call failed:", err);
      showToast("Could not join call: " + err.message, "error");
      rejectCall(incomingCall);
    }
  };

  const rejectCall = async (incomingCall) => {
    console.log("DEBUG: Rejecting call:", incomingCall.id);
    handledCallsRef.current.add(incomingCall.id);
    setCall(null);
    try {
      await pb.collection('calls').update(incomingCall.id, { status: 'rejected' });
    } catch (e) { }
  };

  // Listen for incoming calls via PocketBase realtime
  useEffect(() => {
    if (!userData?.email) return;

    const checkIncoming = async () => {
      try {
        const sixtySecondsAgo = new Date(Date.now() - 60000).toISOString();
        const records = await pb.collection('calls').getList(1, 1, {
          filter: `receiver = "${userData.email}" && status = "dialing" && created >= "${sixtySecondsAgo}"`
        });
        if (records.items.length > 0 && !call) {
          const rec = records.items[0];
          if (!handledCallsRef.current.has(rec.id)) {
            console.log("DEBUG: Setting incoming call state for ID:", rec.id);
            setCall({ id: rec.id, isIncoming: true, ...rec });
          }
        }
      } catch (e) { }
    };

    checkIncoming();

    // Subscribe to new calls targeting this user
    pb.collection('calls').subscribe('*', (e) => {
      if (e.action === 'create' && e.record.receiver === userData.email && e.record.status === 'dialing' && !call) {
        if (!handledCallsRef.current.has(e.record.id)) {
          console.log("DEBUG: Setting incoming call state for ID:", e.record.id);
          setCall({ id: e.record.id, isIncoming: true, ...e.record });
        }
      }
    }).catch((err) => {
      console.warn('Realtime subscribe failed: calls', err);
    });

    return () => { pb.collection('calls').unsubscribe('*'); };
  }, [userData?.email, !!call]);

  // Video element sync
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, call]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(e => console.log("Remote play blocked:", e));
    }
  }, [remoteStream, call]);

  // --- SOUNDS & NOTIFICATIONS ---
  useEffect(() => {
    if (!call) {
      ringtoneRef.current?.pause();
      dialtoneRef.current?.pause();
      if (ringtoneRef.current) ringtoneRef.current.currentTime = 0;
      if (dialtoneRef.current) dialtoneRef.current.currentTime = 0;
      return;
    }

    if (call.status === 'dialing') {
      if (call.isIncoming) {
        // Incoming call: play ringtone and show notification
        ringtoneRef.current?.play().catch(() => console.log('Ringtone blocked by browser'));

        if (Notification.permission === 'granted' && notificationShownRef.current !== call.id) {
          notificationShownRef.current = call.id;
          const notif = new Notification("Cove Incoming Call", {
            body: `${call.caller.split('@')[0]} is calling you!`,
            icon: ASSETS.logoNavy,
            tag: 'cove-call'
          });
          notif.onclick = () => { window.focus(); };
        }
      } else {
        // Outgoing call: play dialtone
        dialtoneRef.current?.play().catch(() => console.log('Dialtone blocked by browser'));
      }
    } else {
      // Ongoing or ended: stop sounds
      ringtoneRef.current?.pause();
      dialtoneRef.current?.pause();
    }
  }, [call]);

  // Request notification permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      const askPermission = () => {
        Notification.requestPermission();
        window.removeEventListener('click', askPermission);
      };
      window.addEventListener('click', askPermission);
    }
  }, []);

  const toggleMic = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMicMuted(!isMicMuted);
    }
  };

  const toggleCamera = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsCameraOff(!isCameraOff);
    }
  };

  const forwardToChat = async (targetChat) => {
    if (!forwardItem) return;

    await pb.collection('messages').create({
      contact: targetChat.id,
      text: forwardItem.text,
      fileUrl: forwardItem.fileUrl || null,
      fileType: forwardItem.fileType || null,
      senderEmail: userData.email,
      isForwarded: true
    });

    await pb.collection('contacts').update(targetChat.id, {
      lastMessage: forwardItem.fileUrl ? `📎 ${forwardItem.text}` : forwardItem.text,
      lastSender: userData.email
    });
    setForwardItem(null);
  };

  if (!user) {
    return (
      <div className={`fixed inset-0 h-[calc(var(--vh,1vh)*100)] md:h-[100dvh] flex items-center justify-center p-4 safe-px transition-colors duration-500 ${darkMode ? 'bg-[#0f172a]' : 'bg-slate-50'}`}>
        <div className={`p-10 rounded-[40px] w-full max-w-sm shadow-2xl border transition-all duration-300 ${darkMode ? 'bg-slate-900 border-white/10' : 'bg-white border-slate-100'} flex flex-col items-center relative z-10`}>
          <img src={darkMode ? ASSETS.logoNameWhite : ASSETS.logoNameNavy} alt="Cove Messenger" className="h-20 object-contain mb-12" />

          <div className="space-y-4 w-full">
            {isSignUp && (
              <div className="relative group animate-msg-in">
                <User className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${darkMode ? 'text-slate-500 group-focus-within:text-blue-400' : 'text-slate-300 group-focus-within:text-[#00337C]'}`} size={18} />
                <input className={`w-full p-4 pl-12 rounded-2xl outline-none font-bold transition-all ${darkMode ? 'bg-white/5 text-white focus:bg-white/10' : 'bg-slate-50 text-slate-900 focus:bg-white focus:ring-2 focus:ring-[#00337C]/10'}`} placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
              </div>
            )}
            <div className="relative group">
              <MessageSquare className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${darkMode ? 'text-slate-500 group-focus-within:text-blue-400' : 'text-slate-300 group-focus-within:text-[#00337C]'}`} size={18} />
              <input className={`w-full p-4 pl-12 rounded-2xl outline-none font-bold transition-all ${darkMode ? 'bg-white/5 text-white focus:bg-white/10' : 'bg-slate-50 text-slate-900 focus:bg-white focus:ring-2 focus:ring-[#00337C]/10'}`} placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="relative group">
              <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${darkMode ? 'text-slate-500 group-focus-within:text-blue-400' : 'text-slate-300 group-focus-within:text-[#00337C]'}`} size={18} />
              <input type="password" className={`w-full p-4 pl-12 rounded-2xl outline-none font-bold transition-all ${darkMode ? 'bg-white/5 text-white focus:bg-white/10' : 'bg-slate-50 text-slate-900 focus:bg-white focus:ring-2 focus:ring-[#00337C]/10'}`} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <button
              onClick={handleAuth}
              disabled={authLoading}
              className={`w-full py-4 bg-gradient-to-r from-[#00337C] to-[#0055A4] text-white rounded-2xl font-black shadow-lg shadow-blue-900/20 active:scale-95 transition-all uppercase tracking-widest mt-4 flex items-center justify-center gap-2 ${authLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {authLoading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Connecting...
                </>
              ) : (
                isSignUp ? "Create Account" : "Sign In to Cove"
              )}
            </button>
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className={`w-full text-xs font-bold uppercase tracking-widest opacity-60 hover:opacity-100 transition-opacity p-2 ${darkMode ? 'text-white' : 'text-slate-900'}`}
            >
              {isSignUp ? "Already have an account? Sign In" : "Don't have an account? Create one"}
            </button>
          </div>
          <p className={`mt-8 text-[11px] font-bold uppercase tracking-widest opacity-40 ${darkMode ? 'text-white' : 'text-slate-900'}`}>Secure • Private • Fast</p>
        </div>
      </div>
    );
  }

  const isChatsTab = activeTab === 'chats';
  const isSearchTab = activeTab === 'search';
  const isRequestsTab = activeTab === 'requests';
  const hasPendingRequests = pendingInvites.length > 0;
  const showConvoList = !isMobile || (!activeChat && (isChatsTab || isRequestsTab || isSearchTab));
  const showChatWindow = !isMobile || activeChat || isSearchTab;
  const showSettingsTab = isMobile && activeTab === 'settings' && !activeChat;

  const openTopNavDestination = (destination) => {
    setShowTopNavMenu(false);
    setShowChatMenu(false);

    if (destination === 'settings') {
      setActiveChat(null);
      if (isMobile) {
        setActiveTab('settings');
      } else {
        setActiveTab('chats');
        setShowSettings(true);
      }
      return;
    }

    setShowSettings(false);

    if (destination === 'search') {
      setActiveTab('search');
      setActiveChat(null);
      setCoveSearchTab('ask');
      return;
    }

    if (destination === 'requests') {
      setActiveTab('requests');
      setActiveChat(null);
      return;
    }

    setActiveTab('chats');
    if (isMobile) setActiveChat(null);
  };

  const topNavItems = [
    {
      key: 'chats',
      label: 'Chats',
      icon: MessageSquare,
      active: isChatsTab && !showSettings
    },
    {
      key: 'search',
      label: 'Cove Search',
      icon: Brain,
      active: isSearchTab
    },
    {
      key: 'requests',
      label: 'Requests',
      icon: UserPlus,
      active: isRequestsTab,
      badge: hasPendingRequests
    },
    {
      key: 'settings',
      label: 'Settings',
      icon: Settings,
      active: showSettings || activeTab === 'settings'
    }
  ];

  const renderTopNavControls = (panelAlign = 'right', searchTarget = 'cove') => {
    const panelPosition = panelAlign === 'left' ? 'left-0' : 'right-0';
    const topSearchActive = searchTarget === 'chat' ? chatSearchExpanded : isSearchTab;
    const topSearchTitle = searchTarget === 'chat' ? 'Find in conversation' : 'Cove Search';
    const handleTopSearch = (event) => {
      event?.stopPropagation();
      setShowTopNavMenu(false);

      if (searchTarget === 'chat') {
        setChatSearchExpanded((prev) => {
          if (prev) updateChatSearch('');
          return !prev;
        });
        return;
      }

      openTopNavDestination('search');
    };

    return (
      <div className="relative z-[70] flex shrink-0 items-center gap-1.5 md:gap-2" ref={topNavMenuRef}>
        <div className="relative">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setChatSearchExpanded(false);
              setShowTopNavMenu((prev) => !prev);
            }}
            aria-label={showTopNavMenu ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={showTopNavMenu}
            className={[
              'relative z-30 flex h-8 w-8 md:h-10 md:w-10 items-center justify-center overflow-hidden border shadow-sm',
              'transition-all duration-200 active:scale-95',
              showTopNavMenu ? 'rounded-[18px]' : 'rounded-full',
              darkMode
                ? 'border-white/10 bg-[#111114] text-white shadow-black/30'
                : 'border-slate-200 bg-white text-[#00337C] shadow-slate-200/70'
            ].join(' ')}
            title="Navigation"
          >
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/15 to-transparent" />
            <Menu
              size={18}
              strokeWidth={2.25}
              className={`absolute transition-all duration-200 ${showTopNavMenu ? 'rotate-90 scale-75 opacity-0' : 'rotate-0 scale-100 opacity-100'}`}
            />
            <X
              size={18}
              strokeWidth={2.25}
              className={`absolute transition-all duration-200 ${showTopNavMenu ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-75 opacity-0'}`}
            />
          </button>

          {showTopNavMenu && (
            <div
              className={[
                `absolute ${panelPosition} top-full z-[90] mt-2 w-[260px] max-w-[calc(100vw-2rem)] rounded-[28px] border p-2.5 shadow-[0_28px_90px_rgba(0,0,0,0.28)] backdrop-blur-2xl animate-menu-in`,
                darkMode ? 'border-white/10 bg-[#101012]/95' : 'border-slate-200 bg-white/95'
              ].join(' ')}
            >
              <div className="pointer-events-none absolute inset-0 rounded-[28px] bg-gradient-to-b from-white/12 to-transparent" />
              <div className="relative flex flex-col gap-1">
                {topNavItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => openTopNavDestination(item.key)}
                      className={[
                        'relative flex h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[15px] font-bold transition-colors',
                        item.active
                          ? darkMode ? 'text-white' : 'text-[#00337C]'
                          : darkMode ? 'text-white/60 hover:text-white' : 'text-slate-500 hover:text-[#00337C]'
                      ].join(' ')}
                    >
                      {item.active && (
                        <span className={`absolute inset-0 rounded-2xl ${darkMode ? 'bg-white/[0.075]' : 'bg-[#00337C]/[0.075]'}`} />
                      )}
                      <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-xl ${darkMode ? 'bg-white/[0.055]' : 'bg-[#00337C]/[0.06]'}`}>
                        <Icon size={18} strokeWidth={2.1} />
                      </span>
                      <span className="relative z-10 truncate">{item.label}</span>
                      {item.badge && <span className="relative z-10 ml-auto h-2 w-2 rounded-full bg-red-500" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={handleTopSearch}
            aria-label={topSearchTitle}
            className={[
              'flex h-8 w-8 md:h-10 md:w-10 items-center justify-center rounded-full border shadow-sm transition-all active:scale-95',
              topSearchActive
                ? darkMode ? 'border-blue-400/20 bg-blue-500/20 text-blue-200' : 'border-[#00337C]/10 bg-[#00337C]/10 text-[#00337C]'
                : darkMode ? 'border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10' : 'border-slate-200 bg-white text-slate-500 hover:text-[#00337C] hover:bg-slate-50'
            ].join(' ')}
            title={topSearchTitle}
          >
            <Search size={17} strokeWidth={2.25} />
          </button>

          {searchTarget === 'chat' && chatSearchExpanded && (
            <div
              className={[
                `absolute ${panelPosition} top-full z-[90] mt-2 w-[min(82vw,340px)] rounded-[24px] border p-2 shadow-[0_22px_70px_rgba(0,0,0,0.25)] backdrop-blur-2xl animate-menu-in`,
                darkMode ? 'border-white/10 bg-[#101012]/95' : 'border-slate-200 bg-white/95'
              ].join(' ')}
            >
              <div className={`flex items-center gap-2 rounded-[18px] px-3 py-2 ${darkMode ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-900'}`}>
                <Search size={16} className={darkMode ? 'text-slate-400' : 'text-slate-400'} />
                <input
                  autoFocus
                  value={chatSearch}
                  onChange={(e) => updateChatSearch(e.target.value)}
                  placeholder="Find in conversation..."
                  className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none placeholder:font-medium placeholder:opacity-60"
                />
                {chatSearch && searchMatches.length > 0 && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => gotoMatch(-1)} title="Previous" className={`rounded px-1 py-0.5 text-[10px] ${darkMode ? 'hover:bg-white/10' : 'hover:bg-slate-200'}`}>◀</button>
                    <span className="text-[10px] opacity-70">{`${currentMatchIndex + 1}/${searchMatches.length}`}</span>
                    <button onClick={() => gotoMatch(1)} title="Next" className={`rounded px-1 py-0.5 text-[10px] ${darkMode ? 'hover:bg-white/10' : 'hover:bg-slate-200'}`}>▶</button>
                  </div>
                )}
                <button
                  onClick={() => {
                    updateChatSearch('');
                    setChatSearchExpanded(false);
                  }}
                  title="Close"
                  className={`shrink-0 rounded p-1 opacity-70 ${darkMode ? 'hover:bg-white/10' : 'hover:bg-slate-200'}`}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`fixed inset-0 h-[calc(var(--vh,1vh)*100)] md:h-[100dvh] flex overflow-hidden safe-px ${darkMode ? 'bg-[#0a0f1e] text-white' : 'bg-white text-slate-900'}`}>
      <Head>
        <title>Cove | Secure Private Messaging</title>
        <meta name="description" content="Secure, private, and fast communication with Cove Messenger." />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#00337C" />
        <link rel="icon" href={ASSETS.logoNavy} />
      </Head>

      {/* FAR-LEFT ICON RAIL */}
      <div className={`w-[72px] md:w-[82px] h-full border-r px-2 py-3 md:py-4 flex flex-col safe-p-top safe-p-bottom ${darkMode ? 'bg-[#0d1528] border-white/5' : 'bg-[#F8FAFC] border-slate-100'}`}>
        <div className="w-full flex justify-center mt-1 mb-5">
          <img src={darkMode ? ASSETS.logoWhite : ASSETS.logoNavy} alt="Cove" className="w-8 h-8 object-contain opacity-90" />
        </div>
        <div className="w-full flex flex-col items-center gap-3">
          <button
            onClick={() => {
              setActiveTab('chats');
              setShowSettings(false);
            }}
            className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${isChatsTab ? (darkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-[#00337C]/10 text-[#00337C]') : (darkMode ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-400 hover:text-[#00337C] hover:bg-slate-100')}`}
            title="Chats"
          >
            <MessageSquare size={18} />
          </button>
          <button
            onClick={() => {
              setActiveTab('requests');
              setActiveChat(null);
              setShowSettings(false);
            }}
            className={`w-11 h-11 rounded-2xl flex items-center justify-center relative transition-colors ${isRequestsTab ? (darkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-[#00337C]/10 text-[#00337C]') : (darkMode ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-400 hover:text-[#00337C] hover:bg-slate-100')}`}
            title="Requests"
          >
            <UserPlus size={18} />
            {hasPendingRequests && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />}
          </button>
        </div>

        <div className="mt-auto mb-1 w-full flex justify-center">
          <button
            onClick={() => {
              if (isMobile) {
                setActiveTab('settings');
              } else {
                setShowSettings((prev) => !prev);
              }
            }}
            className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${(showSettings || activeTab === 'settings') ? (darkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-[#00337C]/10 text-[#00337C]') : (darkMode ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-400 hover:text-[#00337C] hover:bg-slate-100')}`}
            title="Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* SIDEBAR / CONVO LIST */}
      <div className={`${isMobile ? 'flex-1' : 'w-[350px]'} h-full flex flex-col border-r ${darkMode ? 'bg-[#111827] border-white/5' : 'bg-white border-slate-100'} ${!showConvoList ? 'hidden' : 'flex'}`}>
        <div className="p-4 md:p-6 safe-px safe-p-top">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
              <img
                src={darkMode ? ASSETS.logoNameWhite : ASSETS.logoNameNavy}
                alt="Cove"
                className="h-10 md:h-8 object-contain"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {renderTopNavControls('right', 'cove')}
              {isChatsTab && (
                <>
                  <button onClick={() => setShowGroupModal(true)} className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-colors ${darkMode ? 'bg-white/5 text-slate-300 hover:text-white hover:bg-white/10' : 'bg-slate-100 text-slate-500 hover:text-[#00337C] hover:bg-slate-200'}`} title="Create Group">
                    <Users size={18} />
                  </button>
                  <button onClick={() => setShowInviteModal(true)} className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-colors ${darkMode ? 'bg-white/5 text-slate-300 hover:text-white hover:bg-white/10' : 'bg-slate-100 text-slate-500 hover:text-[#00337C] hover:bg-slate-200'}`} title="New Chat">
                    <PlusCircle size={18} />
                  </button>
                </>
              )}
              {isSearchTab && (
                <button onClick={startNewCoveSearchConversation} className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-colors ${darkMode ? 'bg-white/5 text-slate-300 hover:text-white hover:bg-white/10' : 'bg-slate-100 text-slate-500 hover:text-[#00337C] hover:bg-slate-200'}`} title="New AI Chat">
                  <PlusCircle size={18} />
                </button>
              )}
              {!isMobile && isChatsTab && (
                <button onClick={() => setShowSettings(!showSettings)} className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-colors ${showSettings ? (darkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-[#00337C]/10 text-[#00337C]') : (darkMode ? 'bg-white/5 text-slate-300 hover:text-white hover:bg-white/10' : 'bg-slate-100 text-slate-500 hover:text-[#00337C] hover:bg-slate-200')}`}>
                  <Settings size={18} />
                </button>
              )}
            </div>
          </div>
          {isChatsTab && (
            <div className="relative">
              <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${darkMode ? 'text-slate-500' : 'text-slate-300'}`} size={16} />
              <input className={`w-full py-3 pl-12 pr-4 rounded-2xl text-sm outline-none transition-colors ${darkMode ? 'bg-slate-800 text-white placeholder:text-slate-500' : 'bg-slate-100 text-slate-900'}`} placeholder="Search..." />
            </div>
          )}
          {isRequestsTab && (
            <p className={`text-[11px] font-black uppercase tracking-[0.18em] ${darkMode ? 'text-blue-400' : 'text-[#00337C]'}`}>Contact Requests</p>
          )}
          {isSearchTab && (
            <p className={`text-[11px] font-black uppercase tracking-[0.18em] ${darkMode ? 'text-blue-400' : 'text-[#00337C]'}`}>AI Conversations</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3">
          {isRequestsTab && pendingInvites.length > 0 && (
            <div className="mb-6 px-2">
              <p className={`text-[10px] font-black uppercase mb-3 ml-2 tracking-widest ${darkMode ? 'text-blue-400' : 'text-[#00337C]'}`}>Incoming Requests</p>
              {pendingInvites.map(inv => (
                <div key={inv.id} className={`p-4 rounded-3xl mb-2 flex items-center justify-between ${darkMode ? 'bg-white/5' : 'bg-[#00337C]/5'}`}>
                  <span className="text-xs font-bold truncate uppercase">{inv.from.split('@')[0]}</span>
                  <div className="flex gap-2">
                    <button onClick={() => handleInviteResponse(inv, true)} className="p-2 bg-[#00337C] text-white rounded-xl"><Check size={14} /></button>
                    <button onClick={() => handleInviteResponse(inv, false)} className={`p-2 rounded-xl border ${darkMode ? 'bg-slate-800 border-white/10 text-red-400' : 'bg-white text-red-500 border-slate-100'}`}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {isChatsTab && <p className="text-[10px] font-black uppercase text-slate-300 mb-3 ml-4 tracking-widest">Conversations</p>}
          {isSearchTab && <p className="text-[10px] font-black uppercase text-slate-300 mb-3 ml-4 tracking-widest">Speed Demon</p>}
          <div className="flex-1 overflow-y-auto pr-1">
            {isRequestsTab ? (
              pendingInvites.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 opacity-40 select-none">
                  <UserPlus size={40} className="mb-4" />
                  <p className="text-[10px] uppercase font-black tracking-[0.2em]">No Pending Requests</p>
                </div>
              ) : null
            ) : isChatsTab ? (
              isAppLoading && chats.length === 0 ? (
                <NeuralPulse />
              ) : chats.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 opacity-30 select-none">
                  <MessageSquare size={40} className="mb-4" />
                  <p className="text-[10px] uppercase font-black tracking-[0.2em]">Zero Links Active</p>
                </div>
              ) : (
                <>
                  {chats.map(chat => {
                    const isGroup = chat.isGroup;
                    const partnerEmail = !isGroup ? (chat.participants.find(p => p !== userData?.email) || userData?.email) : null;
                    const partnerName = isGroup ? chat.groupName : ((partnerEmail || '').split('@')[0] || userData?.name?.split(' ')[0]);
                    const isSelected = activeChat?.id === chat.id;
                    const isUnread = chat.lastSender !== userData?.email && activeChat?.id !== chat.id;
                    return (
                      <div
                        key={chat.id}
                        onClick={() => {
                          if (forwardItem) {
                            forwardToChat(chat);
                          } else {
                            setActiveChat(chat);
                            setShowSettings(false);
                          }
                        }}
                        className={`group p-4 rounded-[24px] flex gap-4 items-center cursor-pointer mb-1 transition-all ${isSelected && !showSettings ? 'bg-[#00337C] text-white shadow-lg' : darkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50'} ${forwardItem ? 'border-2 border-dashed border-blue-200' : ''}`}
                      >
                        {(() => {
                          if (isGroup) {
                            if (chat.groupPhoto) {
                              return <img src={chat.groupPhoto} alt={chat.groupName} className={`w-11 h-11 rounded-2xl shrink-0 object-cover ${isSelected && !showSettings ? 'ring-2 ring-white/30' : ''}`} />;
                            }
                            return (
                              <div className={`w-11 h-11 rounded-2xl shrink-0 flex items-center justify-center font-black ${isSelected && !showSettings ? 'bg-white/20 text-white' : darkMode ? 'bg-white/10 text-white' : 'bg-[#00337C]/5 text-[#00337C]'}`}>
                                <Users size={18} />
                              </div>
                            );
                          }
                          const partnerUser = (userLookup || {})[(partnerEmail || userData?.email)?.toLowerCase()];
                          const resolvedPhoto = partnerUser?.photoURL || ((partnerEmail || '').toLowerCase() === userData?.email?.toLowerCase() ? userData?.photoURL : null);
                          if (resolvedPhoto) {
                            return (
                              <img src={resolvedPhoto} alt={partnerUser?.name || partnerName} title={resolvedPhoto} className={`w-11 h-11 rounded-2xl shrink-0 object-cover ${isSelected && !showSettings ? 'ring-2 ring-white/30' : ''}`} />
                            );
                          }
                          return (
                            <div className={`w-11 h-11 rounded-2xl shrink-0 flex items-center justify-center font-black ${isSelected && !showSettings ? 'bg-white/20 text-white' : darkMode ? 'bg-white/10 text-white' : 'bg-[#00337C]/5 text-[#00337C]'}`}>
                              {partnerName?.charAt(0).toUpperCase()}
                            </div>
                          );
                        })()}
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-[10px] uppercase tracking-widest opacity-80">{partnerName}</p>
                              {isGroup && <Users size={10} className={isSelected ? 'text-white/60' : 'opacity-40'} />}
                              {chat.pinnedBy?.includes(userData?.email?.toLowerCase()) && <Pin size={10} className="text-white fill-white" />}
                            </div>
                            <div className="flex items-center gap-2">
                              <Trash2
                                size={14}
                                className={`opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-red-500 ${isSelected ? 'text-white' : 'text-slate-300'}`}
                                onClick={(e) => deleteChat(chat.id, e)}
                              />
                              {isUnread && <div className="w-2 h-2 bg-blue-500 rounded-full" />}
                            </div>
                          </div>
                          <p className={`text-xs truncate font-bold ${isSelected ? 'text-white' : darkMode ? 'text-slate-400' : 'text-slate-900'}`}>{chat.lastMessage}</p>
                        </div>
                      </div>
                    );
                  })}
                  {hasMoreChats && chats.length > 0 && (
                    <div
                      ref={(el) => {
                        if (el) {
                          const observer = new IntersectionObserver((entries) => {
                            if (entries[0].isIntersecting) loadMoreChats();
                          }, { threshold: 1 });
                          observer.observe(el);
                        }
                      }}
                      className="h-10 w-full flex items-center justify-center opacity-0"
                    />
                  )}
                </>
              )
            ) : isSearchTab ? (
              coveSearchConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 opacity-30 select-none">
                  <Brain size={40} className="mb-4" />
                  <p className="text-[10px] uppercase font-black tracking-[0.2em]">No AI Chats Yet</p>
                </div>
              ) : (
                coveSearchConversations.map((conv) => {
                  const isSelected = activeCoveSearchConversationId === conv.id;
                  const history = Array.isArray(conv.history) ? conv.history : [];
                  const latest = history.length ? history[history.length - 1] : null;
                  const preview = latest?.text ? String(latest.text) : 'Start a new Cove Search chat';
                  return (
                    <div
                      key={conv.id}
                      onClick={() => hydrateCoveConversation(conv.id)}
                      className={`group p-4 rounded-[24px] flex gap-3 items-center cursor-pointer mb-1 transition-all ${isSelected ? 'bg-[#00337C] text-white shadow-lg' : darkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50'}`}
                    >
                      <div className={`w-11 h-11 rounded-2xl shrink-0 flex items-center justify-center font-black ${isSelected ? 'bg-white/20 text-white' : darkMode ? 'bg-white/10 text-white' : 'bg-[#00337C]/5 text-[#00337C]'}`}>
                        <Brain size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-[10px] uppercase tracking-widest opacity-80 truncate">{conv.title || 'New Chat'}</p>
                        <p className={`text-xs truncate font-bold ${isSelected ? 'text-white' : darkMode ? 'text-slate-400' : 'text-slate-900'}`}>{preview}</p>
                      </div>
                    </div>
                  );
                })
              )
            ) : null}
          </div>
        </div>
      </div>

      {/* MAIN VIEW / SETTINGS TAB ON MOBILE */}
      <div className={`flex-1 flex flex-col transition-colors relative ${darkMode ? 'bg-[#0a0f1e]' : 'bg-[#F8FAFC]'} ${!showChatWindow && !showSettingsTab ? 'hidden' : 'flex'}`}>
        {showSettings || showSettingsTab ? (
          <div className="flex-1 p-4 md:p-12 max-w-xl mx-auto w-full overflow-y-auto">
            {isMobile && (
              <button onClick={() => { setShowSettings(false); setActiveTab('chats'); }} className={`mb-6 flex items-center gap-2 font-bold transition-colors ${darkMode ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-navy'}`}>
                <ArrowRight size={18} className="rotate-180" /> Back to Chats
              </button>
            )}
            <h2 className={`text-xl md:text-3xl font-black mb-6 md:mb-8 ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>Account Settings</h2>
            <div className={`p-6 md:p-8 rounded-[30px] md:rounded-[40px] shadow-sm space-y-6 ${darkMode ? 'bg-[#111827] border border-white/5' : 'bg-white'}`}>
              <div className="flex flex-col md:flex-row items-center gap-6">
                <input type="file" ref={profileInputRef} hidden onChange={handleProfileUpdate} accept="image/*" />
                <div onClick={() => profileInputRef.current?.click()} className="cursor-pointer">
                  {userData?.photoURL ? (
                    <img src={userData.photoURL} alt={userData?.name} className="w-20 h-20 rounded-[24px] object-cover" />
                  ) : (
                    <div className="w-20 h-20 rounded-[24px] bg-[#00337C] flex items-center justify-center text-white text-3xl font-black">{userData?.name?.charAt(0).toUpperCase()}</div>
                  )}
                </div>
                <div className="text-center md:text-left">
                  <p className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-slate-900'}`}>{userData?.name}</p>
                  <p className="text-sm text-slate-400">{userData?.email}</p>
                  <div className="mt-3 flex gap-3 justify-center md:justify-start">
                    <button onClick={() => profileInputRef.current?.click()} className="py-2 px-3 rounded-2xl bg-[#00337C] text-white font-bold text-sm">Change</button>
                    {userData?.photoURL && <button onClick={async () => { try { await pb.collection('users').update(user.id, { photoURL: null }); } catch (e) { console.error(e); } }} className={`py-2 px-3 rounded-2xl border font-bold text-sm ${darkMode ? 'border-white/10 text-white' : 'border-slate-200'}`}>Remove</button>}
                  </div>
                </div>
              </div>
              <button onClick={() => { setDarkMode(!darkMode); try { localStorage.setItem('cove_dark_mode', String(!darkMode)); } catch (e) { } }} className={`w-full p-4 rounded-2xl font-bold flex justify-between items-center transition-colors ${darkMode ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-600'}`}>Appearance <span>{darkMode ? <Moon size={18} /> : <Sun size={18} />}</span></button>
              {deferredPrompt && (
                <button onClick={installPWA} className={`w-full p-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors ${darkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-[#00337C]'}`}>
                  <Download size={18} /> Add Cove to Home Screen
                </button>
              )}
              {creditsInfo && !creditsInfo.isPro && (
                <div className={`w-full p-4 rounded-2xl transition-colors ${darkMode ? 'bg-white/5' : 'bg-slate-50'}`}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-sm">AI Credits</span>
                    <span className={`text-xs font-black px-2 py-1 rounded-full ${creditsInfo.credits > 3 ? 'bg-green-500/20 text-green-500' : creditsInfo.credits > 0 ? 'bg-yellow-500/20 text-yellow-500' : 'bg-red-500/20 text-red-500'}`}>{creditsInfo.credits}/{creditsInfo.maxCredits}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#00337C] to-[#0055A4] transition-all" style={{ width: `${(creditsInfo.credits / creditsInfo.maxCredits) * 100}%` }} />
                  </div>
                  <button onClick={() => window.open(getPaymentUrl(), '_blank')} className="mt-3 w-full py-2 bg-gradient-to-r from-[#00337C] to-[#0055A4] text-white rounded-xl font-bold text-sm">Upgrade to Pro — $2.99</button>
                </div>
              )}
              <button onClick={() => pb.authStore.clear()} className={`w-full p-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors ${darkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-500'}`}>Sign Out</button>
            </div>
          </div>
        ) : activeChat ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            <div className={`p-3 md:p-4 border-b flex items-center justify-between transition-all duration-300 z-30 relative overflow-visible max-w-full ${darkMode ? 'bg-[#111827] border-white/5' : 'bg-white border-slate-100'}`}>
              <div className="flex items-center gap-1.5 md:gap-4 flex-1 min-w-0 overflow-visible">
                {isMobile && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => setActiveChat(null)} className={`p-2 rounded-full ${darkMode ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-500'}`}>
                      <ArrowRight size={20} className="rotate-180" />
                    </button>
                    {renderTopNavControls('left', 'chat')}
                  </div>
                )}
                {(() => {
                  const isGroup = activeChat.isGroup;
                  if (isGroup) {
                    return (
                      <div className="flex items-center gap-4 cursor-pointer" onClick={() => setShowGroupInfo(true)}>
                        {activeChat.groupPhoto ? (
                          <img src={activeChat.groupPhoto} alt={activeChat.groupName} className="w-8 h-8 md:w-12 md:h-12 rounded-xl object-cover" />
                        ) : (
                          <div className="w-8 h-8 md:w-12 md:h-12 rounded-xl bg-[#00337C] text-white flex items-center justify-center">
                            <Users size={20} />
                          </div>
                        )}
                        <div>
                          <p className={`font-black text-base uppercase tracking-wider ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>{activeChat.groupName}</p>
                          <p className="text-xs opacity-60">{activeChat.participants.length} members</p>
                        </div>
                      </div>
                    );
                  }
                  const partnerEmail = activeChat.participants.find(p => p !== userData.email) || userData.email;
                  const partnerUser = userLookup[(partnerEmail || userData.email).toLowerCase()];
                  const partnerName = partnerUser?.name || (partnerEmail || '').split('@')[0] || userData?.name?.split(' ')[0];
                  const resolvedPhoto = partnerUser?.photoURL || ((partnerEmail || '').toLowerCase() === userData?.email?.toLowerCase() ? userData?.photoURL : null);
                  return (
                    <div className="flex items-center gap-1 md:gap-4 truncate">
                      {resolvedPhoto ? (
                        <img src={resolvedPhoto} alt={partnerUser?.name || partnerName} className="w-8 h-8 md:w-12 md:h-12 rounded-xl object-cover" />
                      ) : (
                        <div className="w-8 h-8 md:w-12 md:h-12 rounded-xl bg-[#00337C] text-white flex items-center justify-center font-black text-[10px] md:text-lg">
                          {partnerName?.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className={`font-black text-sm md:text-base uppercase tracking-wider truncate ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>{partnerUser?.name || partnerName}</p>
                        {!isMobile && <p className="text-xs opacity-60 truncate">{partnerEmail}</p>}
                      </div>
                    </div>
                  );
                })()}
                <div className="ml-auto flex items-center justify-end gap-0.5 md:gap-4 relative shrink-0">
                  {!activeChat.isGroup && (
                    <div className="flex items-center gap-0.5 md:gap-4 mr-0.5 md:mr-2 relative z-[40]">
                      <button
                        onClick={() => { console.log('DEBUG: Audio call button clicked'); startCall('audio'); }}
                        className={`w-8 h-8 md:w-12 md:h-12 flex items-center justify-center rounded-full transition-all active:scale-90 cursor-pointer ${darkMode ? 'bg-white/5 hover:bg-white/10 text-blue-400' : 'bg-slate-50 hover:bg-slate-100 text-[#00337C]'} border ${darkMode ? 'border-white/5' : 'border-slate-100'}`}
                        title="Voice Call"
                      >
                        <Phone size={18} />
                      </button>
                      <button
                        onClick={() => { console.log('DEBUG: Video call button clicked'); startCall('video'); }}
                        className={`w-8 h-8 md:w-12 md:h-12 flex items-center justify-center rounded-full transition-all active:scale-90 cursor-pointer ${darkMode ? 'bg-white/5 hover:bg-white/10 text-blue-400' : 'bg-slate-50 hover:bg-slate-100 text-[#00337C]'} border ${darkMode ? 'border-white/5' : 'border-slate-100'}`}
                        title="Video Call"
                      >
                        <Video size={18} />
                      </button>
                    </div>
                  )}
                  {!isMobile && (
                    <div ref={desktopChatSearchRef} className={`flex items-center rounded-full shadow-sm transition-all duration-300 ease-in-out overflow-hidden ${darkMode ? 'bg-white/5' : 'bg-white'} ${chatSearchExpanded ? 'flex-1 max-w-[140px] md:max-w-[260px] px-2 md:px-4 py-2 opacity-100' : 'w-9 h-9 md:w-10 md:h-10 px-0 opacity-80 hover:opacity-100 cursor-pointer justify-center'}`} onClick={() => { if (!chatSearchExpanded) setChatSearchExpanded(true); }}>
                      <Search size={18} className={`shrink-0 transition-all duration-300 ${chatSearchExpanded ? 'opacity-60 mr-2' : 'opacity-100'}`} onClick={(e) => { if (chatSearchExpanded && !chatSearch) { e.stopPropagation(); setChatSearchExpanded(false); updateChatSearch(''); } }} />

                      <div className={`flex items-center gap-2 overflow-hidden transition-all duration-300 ${chatSearchExpanded ? 'w-full opacity-100' : 'w-0 opacity-0'}`}>
                        <input value={chatSearch} onChange={(e) => updateChatSearch(e.target.value)} placeholder="Find in conversation..." className="bg-transparent outline-none text-sm placeholder:opacity-60 w-full" />
                        {chatSearch && searchMatches.length > 0 && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => gotoMatch(-1)} title="Previous" className="px-1 py-0.5 rounded hover:bg-slate-100/50 text-[10px]">◀</button>
                            <span className="text-[10px] opacity-70">{`${currentMatchIndex + 1}/${searchMatches.length}`}</span>
                            <button onClick={() => gotoMatch(1)} title="Next" className="px-1 py-0.5 rounded hover:bg-slate-100/50 text-[10px]">▶</button>
                          </div>
                        )}
                        {chatSearchExpanded && (
                          <button onClick={(e) => { e.stopPropagation(); updateChatSearch(''); setChatSearchExpanded(false); }} title="Close" className="px-1 py-0.5 rounded hover:bg-slate-100/50 opacity-60 ml-1">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="relative z-40" ref={chatMenuRef}>
                    <button onClick={() => setShowChatMenu(!showChatMenu)} className={`w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center transition-colors ${darkMode ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-white hover:bg-slate-50 text-slate-700'} shadow-sm shrink-0`}>
                      <MoreVertical size={18} />
                    </button>
                    {showChatMenu && (
                      <div className={`absolute right-0 top-full mt-2 w-56 rounded-2xl shadow-xl z-50 overflow-hidden border backdrop-blur-xl animate-menu-in ${darkMode ? 'bg-[#1e293b]/90 border-white/10' : 'bg-white/90 border-slate-100'}`}>
                        <div className="p-1 flex flex-col">
                          {activeChat.isGroup && (
                            <button className={`w-full text-left px-4 py-3 text-sm font-bold flex items-center gap-3 transition-colors ${darkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50'}`} onClick={() => { setShowChatMenu(false); setShowGroupInfo(true); }}>
                              <Users size={16} /> Group Info
                            </button>
                          )}
                          <button className={`w-full text-left px-4 py-3 text-sm font-bold flex items-center gap-3 transition-colors ${darkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50'}`} onClick={() => { setShowChatMenu(false); whatsappInputRef.current?.click(); }}>
                            <UploadIcon size={16} /> Import WhatsApp
                          </button>
                          <input type="file" ref={whatsappInputRef} hidden accept=".txt" onChange={handleWhatsAppImport} />
                          {(() => {
                            const isPinned = activeChat.pinnedBy?.includes(userData.email.toLowerCase());
                            return (
                              <button className={`w-full text-left px-4 py-3 text-sm font-bold flex items-center gap-3 transition-colors ${darkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50'}`} onClick={() => { setShowChatMenu(false); togglePinChat(activeChat.id); }}>
                                <Pin size={16} className={isPinned ? 'text-blue-500 fill-blue-500' : ''} /> {isPinned ? 'Unpin' : 'Pin'}
                              </button>
                            );
                          })()}
                          {activeChat.isGroup && (
                            <button className={`w-full text-left px-4 py-3 text-sm font-bold flex items-center gap-3 transition-colors text-red-500 ${darkMode ? 'hover:bg-red-500/10' : 'hover:bg-red-50'}`} onClick={() => { setShowChatMenu(false); leaveGroup(activeChat.id); }}>
                              <LogOut size={16} /> Leave Group
                            </button>
                          )}
                          <button className={`w-full text-left px-4 py-3 text-sm font-bold flex items-center gap-3 transition-colors text-red-500 ${darkMode ? 'hover:bg-red-500/10' : 'hover:bg-red-50'}`} onClick={(e) => { setShowChatMenu(false); deleteChat(activeChat.id, e); }}>
                            <Trash2 size={16} /> Delete
                          </button>
                          <div className={`h-px w-full my-1 ${darkMode ? 'bg-white/10' : 'bg-slate-100'}`} />
                          <button className={`w-full text-left px-4 py-3 text-sm font-bold flex items-center gap-3 transition-colors text-orange-500 ${darkMode ? 'hover:bg-orange-500/10' : 'hover:bg-orange-50'}`} onClick={() => { setShowChatMenu(false); reportAbuse(activeChat.id); }}>
                            <AlertTriangle size={16} /> Report
                          </button>
                          {!activeChat.isGroup && (() => {
                            const partnerEmail = activeChat.participants.find(p => p !== userData.email);
                            const isBlocked = userData.blocked?.includes(partnerEmail?.toLowerCase());
                            return (
                              <button className={`w-full text-left px-4 py-3 text-sm font-bold flex items-center gap-3 transition-colors ${isBlocked ? 'text-blue-500 hover:bg-blue-500/10' : 'text-red-600 hover:bg-red-600/10'}`} onClick={() => { setShowChatMenu(false); toggleBlockContact(activeChat.id); }}>
                                <Ban size={16} /> {isBlocked ? 'Unblock' : 'Block'}
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {uploading && <div className="text-[10px] font-black text-blue-500 animate-pulse">UPLOADING FILE...</div>}
            </div>

            <div className="flex-1 flex flex-col min-h-0 relative">
              {isChatLoading && messages.length === 0 ? (
                <div className="flex-1 flex flex-col justify-center items-center py-20 animate-pulse text-slate-400">
                  <div className="w-12 h-12 bg-blue-500/10 rounded-full mb-4 flex items-center justify-center">
                    <Loader2 size={24} className="animate-spin text-blue-500" />
                  </div>
                  <p className="text-[10px] uppercase font-black tracking-widest">Syncing Messages...</p>
                </div>
              ) : (
                <div
                  ref={messagesContainerRef}
                  onScroll={handleScroll}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  className="flex-1 overflow-y-auto overflow-x-hidden space-y-6 relative flex flex-col"
                >
                  {hasMoreMessages && (
                    <div className="flex justify-center py-4 relative z-10">
                      <Loader2 className="animate-spin opacity-50" size={20} />
                    </div>
                  )}
                  {/* DRAP & DROP OVERLAY */}
                  <div className={`absolute inset-0 z-20 flex items-center justify-center transition-opacity ${isDragging ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
                    <div className={`w-[80%] max-w-4xl h-44 rounded-3xl flex items-center justify-center px-6 backdrop-blur-md ${isDragging ? 'bg-white/40 dark:bg-black/40' : 'bg-white/5 dark:bg-black/5'} border-2 border-dashed ${isDragging ? 'border-slate-300/80' : 'border-slate-300/30'}`}>
                      <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">Drag & drop an image to upload</p>
                    </div>
                  </div>

                  {/* MESSAGE LIST */}
                  {(() => {
                    const all = [...messages, ...optimisticMessages].sort((a, b) => {
                      const ta = a.timestamp?.seconds ? a.timestamp.seconds * 1000 : (a.created ? new Date(a.created).getTime() : Date.now());
                      const tb = b.timestamp?.seconds ? b.timestamp.seconds * 1000 : (b.created ? new Date(b.created).getTime() : Date.now());
                      return ta - tb;
                    });

                    return (
                      <>
                        {all.map((msg, i) => {
                          const isGroupChat = activeChat?.isGroup;
                          const isOwnMessage = msg.senderEmail === userData.email;
                          const senderUser = (userLookup || {})[msg.senderEmail?.toLowerCase()];
                          const senderName = senderUser?.name || (msg.senderEmail || '').split('@')[0];
                          const senderPhoto = senderUser?.photoURL || null;
                          const messageKey = msg.id || msg.tempId || `idx_${i}`;
                          const isExpanded = expandedMessageKeys.has(messageKey);
                          const renderInfo = getMessageRenderInfo(msg.text, isExpanded);
                          return (
                            <div key={msg.id || msg.tempId || i} data-id={msg.id} ref={el => messagesRefs.current[i] = el} className={`flex w-full px-4 md:px-8 gap-2 relative z-10 ${!msg.id && msg.tempId ? 'animate-msg-in' : ''} ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                              {isGroupChat && !isOwnMessage && (
                                <div className="flex flex-col justify-end pb-1">
                                  {senderPhoto ? (
                                    <img src={senderPhoto} alt={senderName} className="w-8 h-8 rounded-xl object-cover" />
                                  ) : (
                                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black ${darkMode ? 'bg-white/10 text-white' : 'bg-[#00337C]/10 text-[#00337C]'}`}>
                                      {senderName.charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className={`group relative max-w-[80%] md:max-w-[70%] ${isOwnMessage ? 'flex flex-col items-end' : ''}`}>
                                <div className={`absolute -top-8 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity ${isOwnMessage ? 'right-0' : 'left-0'}`}>
                                  <button onClick={() => setForwardItem(msg)} title="Forward" className={`p-1.5 rounded-full shadow-sm text-slate-400 hover:text-green-500 ${darkMode ? 'bg-slate-800' : 'bg-white'}`}><ArrowRight size={14} /></button>
                                  <button onClick={() => setReplyTo(msg)} title="Reply" className={`p-1.5 rounded-full shadow-sm text-slate-400 hover:text-blue-500 ${darkMode ? 'bg-slate-800' : 'bg-white'}`}><Reply size={14} /></button>
                                  {msg.senderEmail === userData.email && msg.id && <button onClick={() => startEditMessage(msg)} title="Edit" className={`p-1.5 rounded-full shadow-sm text-slate-400 hover:text-yellow-400 ${darkMode ? 'bg-slate-800' : 'bg-white'}`}><MoreVertical size={14} /></button>}
                                  {msg.senderEmail === userData.email && msg.id && <button onClick={() => deleteMessageWithConfirm(msg.id)} className={`p-1.5 rounded-full shadow-sm text-slate-400 hover:text-red-500 ${darkMode ? 'bg-slate-800' : 'bg-white'}`}><Trash2 size={14} /></button>}
                                </div>
                                <div className={`p-2.5 md:p-4 rounded-[22px] shadow-sm transition-all duration-200 hover:shadow-md ${msg.senderEmail === userData.email ? 'bg-gradient-to-br from-[#00337C] to-[#002a66] text-white rounded-tr-none' : darkMode ? 'bg-[#1e293b]/80 backdrop-blur-sm text-white rounded-tl-none border border-white/5' : 'bg-white/90 backdrop-blur-sm text-slate-800 rounded-tl-none border border-slate-100/50'}`}>
                                  {isGroupChat && !isOwnMessage && (
                                    <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${darkMode ? 'text-blue-400' : 'text-[#00337C]'}`}>{senderName}</p>
                                  )}
                                  {msg.isForwarded && <div className="text-[9px] uppercase font-black opacity-50 mb-1 flex items-center gap-1"><ArrowRight size={10} /> Forwarded</div>}
                                  {msg.replyTo && <div className={`mb-2 p-2 rounded-xl text-[10px] border-l-4 italic ${darkMode ? 'bg-black/20 border-white/20' : 'bg-black/10 border-white/30'}`}>Replying to: {msg.replyTo.text}</div>}

                                  {msg.fileUrl && (
                                    <div className="mb-2 relative overflow-hidden rounded-xl w-full">
                                      {msg.status === 'uploading' && (
                                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10 backdrop-blur-[2px]">
                                          <Loader2 className="animate-spin text-white mb-2" size={24} />
                                          <span className="text-[10px] text-white font-bold opacity-80">Uploading...</span>
                                        </div>
                                      )}
                                      {msg.fileType === 'image' ? (
                                        <img onClick={() => { if (msg.status !== 'uploading') { pauseAllMediaInMessages(); setMediaModal({ url: msg.fileUrl, type: 'image', text: msg.text }); } }} src={msg.fileUrl} className={`cursor-pointer w-full md:w-auto md:max-w-full max-h-[300px] h-auto rounded-xl border border-white/10 shadow-sm object-contain transition-opacity ${msg.status === 'uploading' ? 'opacity-30 grayscale' : 'opacity-100'}`} alt="attachment" />
                                      ) : msg.fileType === 'audio' ? (
                                        <audio src={msg.fileUrl} controls className="w-full" />
                                      ) : msg.fileType === 'video' ? (
                                        <div className="relative inline-block w-full">
                                          <video src={msg.fileUrl} controls className={`cursor-pointer max-w-full max-h-[360px] rounded-xl ${msg.status === 'uploading' ? 'opacity-30 grayscale' : 'opacity-100'}`} />
                                          {msg.status !== 'uploading' && (
                                            <button onClick={() => { pauseAllMediaInMessages(); setMediaModal({ url: msg.fileUrl, type: 'video', text: msg.text }); }} title="Open" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                              <Maximize size={18} />
                                            </button>
                                          )}
                                        </div>
                                      ) : (
                                        <a href={msg.status === 'uploading' ? '#' : msg.fileUrl} target="_blank" rel="noreferrer" className={`flex items-center gap-2 p-0.5 rounded-xl transition-colors ${darkMode ? 'bg-black/20 hover:bg-black/40' : 'bg-black/10 hover:bg-black/20'} ${msg.status === 'uploading' ? 'cursor-wait opacity-50' : ''}`}>
                                          <div className="p-0.5">
                                            <FileText size={14} className="shrink-0" />
                                          </div>
                                          <div className="flex-1 overflow-hidden">
                                            <p className="text-xs font-bold truncate">{msg.text}</p>
                                            <p className="text-[10px] opacity-60 uppercase">{msg.status === 'uploading' ? 'Uploading' : 'View File'}</p>
                                          </div>
                                        </a>
                                      )}
                                    </div>
                                  )}

                                  {msg.text && (
                                    msg.fileType === 'image' ? (
                                      <div className="mt-2">
                                        <p className={`text-[14px] whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${msg.senderEmail === userData.email ? 'text-white' : (darkMode ? 'text-white' : 'text-slate-900')}`}>{highlightText(renderInfo.text)}</p>
                                        {(renderInfo.truncated || isExpanded) && (
                                          <button
                                            onClick={() => {
                                              setExpandedMessageKeys(prev => {
                                                const next = new Set(prev);
                                                if (next.has(messageKey)) next.delete(messageKey);
                                                else next.add(messageKey);
                                                return next;
                                              });
                                            }}
                                            className={`mt-1 text-[10px] font-bold uppercase tracking-widest ${msg.senderEmail === userData.email ? 'text-white/80 hover:text-white' : (darkMode ? 'text-blue-300 hover:text-blue-200' : 'text-[#00337C] hover:text-[#002a66]')}`}
                                          >
                                            {isExpanded ? 'Show less' : 'Show more'}
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <div>
                                        <p className="text-[15px] font-medium leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{highlightText(renderInfo.text)}</p>
                                        {(renderInfo.truncated || isExpanded) && (
                                          <button
                                            onClick={() => {
                                              setExpandedMessageKeys(prev => {
                                                const next = new Set(prev);
                                                if (next.has(messageKey)) next.delete(messageKey);
                                                else next.add(messageKey);
                                                return next;
                                              });
                                            }}
                                            className={`mt-1 text-[10px] font-bold uppercase tracking-widest ${msg.senderEmail === userData.email ? 'text-white/80 hover:text-white' : (darkMode ? 'text-blue-300 hover:text-blue-200' : 'text-[#00337C] hover:text-[#002a66]')}`}
                                          >
                                            {isExpanded ? 'Show less' : 'Show more'}
                                          </button>
                                        )}
                                      </div>
                                    )
                                  )}

                                  <div className="mt-2 text-[11px] opacity-60 flex items-center gap-2 justify-end">
                                    <span>{formatTimestamp(msg.timestamp || msg.created)}</span>
                                    {msg.senderEmail === userData.email && (
                                      <span className="flex items-center gap-1">
                                        {msg.status === 'uploading' ? (
                                          <Check size={14} className="text-slate-400 opacity-60" />
                                        ) : (!msg.id || !msg.seenAt) ? (
                                          <CheckCheck size={14} className="text-slate-400" />
                                        ) : (
                                          <CheckCheck size={14} className="text-blue-400" />
                                        )}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef} />
                      </>
                    );
                  })()}
                </div>
              )}

              <div
                className={`px-2 md:px-8 py-2 md:py-4 pb-4 md:pb-8 relative z-10 safe-p-bottom w-full ${darkMode ? 'bg-[#0a0f1e]' : 'bg-[#F8FAFC]'}`}
                style={isMobile ? { paddingBottom: `calc(env(safe-area-inset-bottom) + ${keyboardOffset + 12}px)` } : undefined}
              >
                {replyTo && (
                  <div className={`max-w-4xl mx-auto mb-2 p-3 border-l-4 rounded-xl flex justify-between items-center ${darkMode ? 'bg-blue-500/10 border-blue-500' : 'bg-blue-50 border-[#00337C]'}`}>
                    <p className={`text-xs font-bold ${darkMode ? 'text-blue-300' : 'text-[#00337C]'}`}>Replying to: <span className="font-normal opacity-70 truncate max-w-[200px]">{replyTo.text}</span></p>
                    <X size={14} className="cursor-pointer" onClick={() => setReplyTo(null)} />
                  </div>
                )}
                {forwardItem && (
                  <div className={`max-w-4xl mx-auto mb-2 p-3 border-l-4 rounded-xl flex justify-between items-center ${darkMode ? 'bg-green-500/10 border-green-500' : 'bg-green-50 border-green-500'}`}>
                    <p className={`text-xs font-bold uppercase tracking-widest ${darkMode ? 'text-green-300' : 'text-green-700'}`}>Select a chat to forward message</p>
                    <X size={14} className={`cursor-pointer ${darkMode ? 'text-green-300' : 'text-green-700'}`} onClick={() => setForwardItem(null)} />
                  </div>
                )}
                {pendingAttachments && pendingAttachments.length > 0 && (
                  <div className={`max-w-4xl mx-auto mb-2 p-3 rounded-xl flex flex-col gap-3 ${darkMode ? 'bg-white/5' : 'bg-slate-50'}`}>
                    {pendingAttachments.map((att, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {att.fileType === 'image' ? (
                            <img src={att.previewUrl} alt="preview" className="w-20 h-20 object-cover rounded-md" />
                          ) : att.fileType === 'audio' ? (
                            <audio src={att.previewUrl} controls className="w-48" />
                          ) : (
                            <div className={`w-20 h-20 rounded-md flex items-center justify-center bg-slate-100 ${darkMode ? 'bg-black/20' : ''}`}>{att.file?.name?.slice(0, 6)}</div>
                          )}
                          <div>
                            <p className="font-bold truncate max-w-xs">{att.file?.name}</p>
                            <p className="text-xs opacity-60">{att.fileType}</p>
                            <p className={`text-[10px] mt-1 font-bold uppercase tracking-widest ${
                              att.shadowStatus === 'ready'
                                ? (darkMode ? 'text-green-300' : 'text-green-600')
                                : att.shadowStatus === 'error'
                                  ? (darkMode ? 'text-red-300' : 'text-red-600')
                                  : (darkMode ? 'text-blue-300' : 'text-blue-600')
                            }`}>
                              {att.shadowStatus === 'ready'
                                ? 'Shadow Indexed'
                                : att.shadowStatus === 'error'
                                  ? 'Shadow Failed'
                                  : att.shadowStatus === 'processing'
                                    ? 'Shadow Processing...'
                                    : 'Shadow Queued'}
                            </p>
                            <p className={`text-[10px] mt-1 font-bold uppercase tracking-widest ${
                              att.deepShadowStatus === 'ready'
                                ? (darkMode ? 'text-green-300' : 'text-green-600')
                                : att.deepShadowStatus === 'error'
                                  ? (darkMode ? 'text-red-300' : 'text-red-600')
                                  : att.deepShadowStatus === 'processing'
                                    ? (darkMode ? 'text-blue-300' : 'text-blue-600')
                                    : 'opacity-40'
                            }`}>
                              {att.deepShadowStatus === 'ready'
                                ? 'Deep Shadow Ready'
                                : att.deepShadowStatus === 'error'
                                  ? 'Deep Shadow Unavailable'
                                  : att.deepShadowStatus === 'processing'
                                    ? 'Deep Shadow Running...'
                                    : 'Deep Shadow Idle'}
                            </p>
                            <p className="text-[10px] opacity-50">
                              Retries: {(deepShadowQueue?.[att.attachmentId]?.attempts || 0)}/{MAX_DEEP_SHADOW_RETRIES}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2">
                            {att.deepShadowStatus === 'error' && (
                              <button
                                onClick={() => kickOffDeepShadowExtraction(att, { force: true })}
                                className="p-2 rounded-md text-sm font-bold text-blue-600"
                              >
                                Re-run Deep Shadow
                              </button>
                            )}
                            <button onClick={() => {
                              try { att.previewUrl && URL.revokeObjectURL(att.previewUrl); } catch (e) { }
                              setPendingAttachments(prev => prev.filter((_, i) => i !== idx));
                              setDeepShadowQueue(prev => {
                                const next = { ...(prev || {}) };
                                delete next[att.attachmentId];
                                return next;
                              });
                              setUploadError(null);
                            }} className="p-2 rounded-md text-sm font-bold text-red-500">Remove</button>
                            {uploadError && <button onClick={() => handleRetryUpload(idx)} className="p-2 rounded-md text-sm font-bold text-blue-600">Retry</button>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {uploadError && (
                  <div className={`max-w-4xl mx-auto mb-2 p-3 rounded-xl text-sm ${darkMode ? 'bg-black/20 text-red-300' : 'bg-red-50 text-red-600'}`}>{uploadError}</div>
                )}
                <div className={`max-w-4xl mx-auto rounded-[30px] shadow-lg flex items-center gap-2 md:gap-3 p-2 md:p-3 px-3 md:px-5 relative transition-all duration-200 ${darkMode ? 'bg-[#111827] border border-white/5' : 'bg-white border border-slate-100'} ${isRecording ? 'ring-4 ring-[#00337C]/30' : ''}`}>
                  {isRecording && (
                    <div className="absolute -top-10 left-6 flex items-center gap-2 transition-all duration-200 ease-out">
                      <span className="w-2 h-2 bg-[#00337C] rounded-full animate-pulse" />
                      <p className="text-xs font-black" style={{ color: '#00337C' }}>Recording…</p>
                    </div>
                  )}
                  <input type="file" ref={chatFileInputRef} hidden multiple onChange={handleChatFileUpload} />
                  <button onClick={() => chatFileInputRef.current.click()} className={`w-9 h-9 md:w-11 md:h-11 rounded-2xl flex items-center justify-center text-slate-400 hover:text-blue-400 shrink-0 ${darkMode ? 'hover:bg-white/5' : 'hover:bg-slate-100'}`}><Paperclip size={isMobile ? 16 : 20} /></button>
                  <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className={`w-9 h-9 md:w-11 md:h-11 rounded-2xl flex items-center justify-center text-slate-400 hover:text-blue-400 shrink-0 ${darkMode ? 'hover:bg-white/5' : 'hover:bg-slate-100'}`}><Smile size={isMobile ? 16 : 20} /></button>
                  <button onClick={() => isRecording ? stopRecording() : startRecording()} className={`w-9 h-9 md:w-11 md:h-11 rounded-2xl flex items-center justify-center shrink-0 ${isRecording ? 'text-red-400' : 'text-slate-400'} hover:text-blue-400 ${darkMode ? 'hover:bg-white/5' : 'hover:bg-slate-100'}`} title={isRecording ? 'Stop recording' : 'Start recording'}>
                    <Mic size={isMobile ? 16 : 20} />
                  </button>

                  {showEmojiPicker && (
                    <div className={`absolute bottom-20 left-4 p-4 rounded-3xl shadow-2xl border z-50 transition-colors ${darkMode ? 'bg-[#1e293b] border-white/10' : 'bg-white border-slate-100'}`} style={{ width: 360 }}>
                      <div className="mb-3">
                        <input
                          value={emojiSearch}
                          onChange={e => setEmojiSearch(e.target.value)}
                          placeholder="Search emojis..."
                          className={`w-full p-2 rounded-lg text-sm outline-none ${darkMode ? 'bg-black/20 text-white placeholder:text-slate-500' : 'bg-slate-100 text-slate-900'}`}
                        />
                      </div>

                      <div className="flex gap-2 mb-3">
                        <button onClick={() => setEmojiTab('recents')} className={`flex-1 py-2 rounded-lg font-bold ${emojiTab === 'recents' ? 'bg-[#00337C] text-white' : (darkMode ? 'bg-black/20 text-white' : 'bg-slate-50 text-slate-600')}`}>Recents</button>
                        <button onClick={() => setEmojiTab('recommended')} className={`flex-1 py-2 rounded-lg font-bold ${emojiTab === 'recommended' ? 'bg-[#00337C] text-white' : (darkMode ? 'bg-black/20 text-white' : 'bg-slate-50 text-slate-600')}`}>Recommended</button>
                        <button onClick={() => setEmojiTab('all')} className={`flex-1 py-2 rounded-lg font-bold ${emojiTab === 'all' ? 'bg-[#00337C] text-white' : (darkMode ? 'bg-black/20 text-white' : 'bg-slate-50 text-slate-600')}`}>All</button>
                      </div>

                      <div className="max-h-48 overflow-y-auto p-1">
                        {(() => {
                          const items = getEmojiCandidates();
                          if (!items || items.length === 0) {
                            return <div className={`p-4 text-sm italic ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>No emojis found</div>;
                          }
                          return items.map(e => (
                            <button key={e} onClick={() => handleEmojiSelect(e)} className="text-2xl p-2 m-1 rounded-lg hover:scale-110 transition-transform">{e}</button>
                          ));
                        })()}
                      </div>
                    </div>
                  )}

                  <input
                    className={`flex-1 min-w-0 px-2 outline-none font-bold text-sm bg-transparent ${darkMode ? 'text-white placeholder:text-slate-500' : 'text-slate-900'}`}
                    placeholder={uploading ? "Uploading..." : "Type a message..."}
                    value={messageInput}
                    disabled={uploading || isSending}
                    onChange={e => setMessageInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!isSending) sendMessage();
                      }
                    }}
                    onPaste={handlePaste}
                  />
                  <button onClick={() => sendMessage()} disabled={isSending || uploading} className={`p-3 md:p-4 ${isSending || uploading ? 'opacity-50 cursor-not-allowed' : 'bg-gradient-to-br from-[#00337C] to-[#0055A4] hover:shadow-blue-900/30 hover:shadow-xl'} text-white rounded-[20px] active:scale-90 transition-all duration-200 shadow-md`}><Send size={isMobile ? 14 : 18} /></button>
                </div>
              </div>
            </div>
          </div>
        ) : isSearchTab ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            <div className={`p-3 md:p-4 border-b flex items-center justify-between transition-all duration-300 z-30 relative overflow-hidden max-w-full ${darkMode ? 'bg-[#111827] border-white/5' : 'bg-white border-slate-100'}`}>
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-8 h-8 md:w-12 md:h-12 rounded-xl flex items-center justify-center ${darkMode ? 'bg-blue-500/10 text-blue-300' : 'bg-[#00337C]/10 text-[#00337C]'}`}>
                  <Brain size={20} />
                </div>
                <div className="min-w-0">
                  <p className={`font-black text-sm md:text-base uppercase tracking-wider truncate ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>Cove Search</p>
                  <p className="text-xs opacity-60 truncate">AI assistant{speedDemonDiag.lastSearchMs > 0 ? ` • Last response ${speedDemonDiag.lastSearchMs}ms` : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setCoveSearchTab('ask')} className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${coveSearchTab === 'ask' ? (darkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-[#00337C]/10 text-[#00337C]') : (darkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}`}>Ask</button>
                <button onClick={() => setCoveSearchTab('settings')} className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${coveSearchTab === 'settings' ? (darkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-[#00337C]/10 text-[#00337C]') : (darkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}`}>Settings</button>
              </div>
            </div>
            {coveSearchTab === 'ask' ? (
              <>
                {aiStatus === 'loading' && (
                  <div className={`mx-4 md:mx-8 mt-3 p-3 rounded-2xl border text-xs font-bold ${darkMode ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300' : 'bg-yellow-50 border-yellow-200 text-yellow-700'}`}>
                    One-time AI setup in progress ({Math.round(aiProgress * 100)}%). You can switch app tabs, but do not close or reload this browser tab.
                  </div>
                )}
                <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-6 relative flex flex-col py-4">
                  {aiStatus === 'loading' && coveSearchHistory.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center px-6">
                      <div className={`w-full max-w-xl rounded-3xl border p-6 md:p-8 text-center ${darkMode ? 'bg-[#111827] border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'}`}>
                        <div className={`w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center ${darkMode ? 'bg-blue-500/15 text-blue-300' : 'bg-[#00337C]/10 text-[#00337C]'}`}>
                          <Brain size={26} />
                        </div>
                        <p className={`text-[10px] uppercase tracking-[0.2em] font-black mb-2 ${darkMode ? 'text-slate-300' : 'text-slate-500'}`}>Speed Demon Setup</p>
                        <p className="text-4xl md:text-5xl font-black leading-none mb-4">{Math.round(aiProgress * 100)}%</p>
                        <div className={`w-full h-2 rounded-full overflow-hidden mb-4 ${darkMode ? 'bg-white/10' : 'bg-slate-200'}`}>
                          <div
                            className="h-full bg-gradient-to-r from-[#00337C] to-[#0055A4] transition-all duration-300"
                            style={{ width: `${Math.max(0, Math.min(100, Math.round(aiProgress * 100)))}%` }}
                          />
                        </div>
                        <p className={`text-xs font-bold ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                          First-time setup can take a few minutes. Keep this browser tab open.
                        </p>
                      </div>
                    </div>
                  ) : coveSearchHistory.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-center opacity-40 select-none">
                      <div>
                        <Brain size={36} className="mx-auto mb-3" />
                        <p className="text-[10px] uppercase font-black tracking-[0.2em]">Start Cove Search</p>
                      </div>
                    </div>
                  ) : (
                    coveSearchHistory.map((msg) => (
                      <div key={msg.id} className={`flex w-full px-4 md:px-8 gap-2 relative z-10 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`group relative max-w-[80%] md:max-w-[70%] ${msg.role === 'user' ? 'flex flex-col items-end' : ''}`}>
                          <div className={`p-2.5 md:p-4 rounded-[22px] shadow-sm ${msg.role === 'user' ? 'bg-gradient-to-br from-[#00337C] to-[#002a66] text-white rounded-tr-none' : darkMode ? 'bg-[#1e293b]/80 text-white rounded-tl-none border border-white/5' : 'bg-white/90 text-slate-800 rounded-tl-none border border-slate-100/50'}`}>
                            <p className="text-[15px] font-medium leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.text}</p>
                            {msg.role === 'assistant' && msg.meta && !msg.loading && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${msg.meta.confidence === 'high' ? 'bg-green-500/15 text-green-500' : msg.meta.confidence === 'medium' ? 'bg-yellow-500/15 text-yellow-500' : 'bg-red-500/15 text-red-500'}`}>Confidence: {msg.meta.confidence}</span>
                                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${darkMode ? 'bg-white/10 text-slate-200' : 'bg-slate-200 text-slate-700'}`}>Sources: {msg.meta.sourceCount || 0}</span>
                                {Number(msg.meta.searchMs || 0) > 0 && <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${darkMode ? 'bg-cyan-500/15 text-cyan-300' : 'bg-cyan-50 text-cyan-700'}`}>Response: {Math.round(Number(msg.meta.searchMs || 0))}ms</span>}
                                {msg.meta.fromCache && <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${darkMode ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-50 text-blue-600'}`}>Cached</span>}
                                <button
                                  onClick={() => {
                                    setCorrectAnswerIds((prev) => {
                                      const next = new Set(prev);
                                      const wasMarked = next.has(msg.id);
                                      if (wasMarked) {
                                        next.delete(msg.id);
                                      } else {
                                        next.add(msg.id);
                                        // Persist verified answer as a trusted fact in shadow docs
                                        const turnText = String(msg.text || '').trim();
                                        const userTurn = (coveSearchHistory || []).slice().reverse().find(t => t.role === 'user' && t.createdAt < msg.createdAt);
                                        const userQuery = String(userTurn?.text || '').trim();
                                        if (turnText && userQuery) {
                                          upsertShadowDocuments([{
                                            id: `verified_${msg.id}`,
                                            chatId: activeChat?.id || 'cove_search',
                                            source: 'fact',
                                            text: `VERIFIED FACT: Q: ${userQuery} A: ${turnText}`,
                                            ts: Date.now()
                                          }]);
                                          // Also save to library cache with high quality
                                          saveLibraryAnswer(userQuery, turnText, { sourceCount: 1, qualityScore: 0.95 });
                                        }
                                      }
                                      return next;
                                    });
                                  }}
                                  className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${correctAnswerIds.has(msg.id)
                                    ? (darkMode ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-700')
                                    : (darkMode ? 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')
                                    }`}
                                >
                                  {correctAnswerIds.has(msg.id) ? 'Right' : 'Mark Right'}
                                </button>
                              </div>
                            )}
                            {msg.role === 'assistant' && Array.isArray(msg.sources) && msg.sources.length > 0 && !msg.loading && (
                              <div className="mt-2">
                                <button
                                  onClick={() => setExpandedSourceMessageIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(msg.id)) next.delete(msg.id); else next.add(msg.id);
                                    return next;
                                  })}
                                  className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${darkMode ? 'bg-white/10 text-slate-200 hover:bg-white/20' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                                >
                                  {expandedSourceMessageIds.has(msg.id) ? 'Hide Sources' : 'Show Sources'}
                                </button>
                                {expandedSourceMessageIds.has(msg.id) && (
                                  <div className="mt-2 grid gap-2">
                                    {msg.sources.map((src) => (
                                      <div key={src.id} className={`p-2 rounded-lg text-xs ${darkMode ? 'bg-white/5 text-slate-200' : 'bg-slate-50 text-slate-700'}`}>
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="font-black uppercase tracking-widest">{src.label}</span>
                                          <div className="flex items-center gap-2">
                                            <span className="opacity-60">score {Math.round((src.score || 0) * 100)}%</span>
                                            {src.chatId && <button onClick={() => jumpToSearchSource(src)} className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${darkMode ? 'bg-blue-500/15 text-blue-300 hover:bg-blue-500/25' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>Jump</button>}
                                          </div>
                                        </div>
                                        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{src.snippet}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={coveSearchEndRef} />
                </div>
                <div className={`px-2 md:px-8 py-2 md:py-4 pb-4 md:pb-8 relative z-10 safe-p-bottom w-full ${darkMode ? 'bg-[#0a0f1e]' : 'bg-[#F8FAFC]'}`}>
                  <div className={`max-w-4xl mx-auto rounded-[30px] shadow-lg flex items-center gap-2 md:gap-3 p-2 md:p-3 px-3 md:px-5 relative transition-all duration-200 ${darkMode ? 'bg-[#111827] border border-white/5' : 'bg-white border border-slate-100'}`}>
                    <textarea
                      rows={1}
                      value={coveSearchInput}
                      onChange={(e) => setCoveSearchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          runCoveSearch();
                        }
                      }}
                      placeholder="Message Cove Search..."
                      className={`flex-1 min-w-0 px-2 outline-none font-bold text-sm bg-transparent resize-none ${darkMode ? 'text-white placeholder:text-slate-500' : 'text-slate-900'}`}
                    />
                    <button
                      onClick={startNewCoveSearchConversation}
                      className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${darkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      New Chat
                    </button>
                    <button onClick={runCoveSearch} disabled={coveSearchRunning || aiStatus === 'loading' || aiStatus === 'generating'} className={`p-3 md:p-4 ${coveSearchRunning || aiStatus === 'loading' || aiStatus === 'generating' ? 'opacity-50 cursor-not-allowed' : 'bg-gradient-to-br from-[#00337C] to-[#0055A4] hover:shadow-blue-900/30 hover:shadow-xl'} text-white rounded-[20px] active:scale-90 transition-all duration-200 shadow-md`}>
                      <Send size={isMobile ? 14 : 18} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 md:p-8">
                <div className={`max-w-3xl mx-auto rounded-2xl border p-4 ${darkMode ? 'border-white/10 bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <p className={`text-sm mb-3 ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>Cove Search Settings</p>
                  <p className={`text-xs mb-4 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Use a password to protect maintenance actions from accidental taps.</p>
                  <div className="grid md:grid-cols-2 gap-3 mb-4">
                    <input type="password" value={settingsNewPassword} onChange={(e) => setSettingsNewPassword(e.target.value)} placeholder={settingsPasswordHash ? 'New password (optional)' : 'Set password'} className={`p-3 rounded-xl outline-none text-sm ${darkMode ? 'bg-white/5 text-white placeholder:text-slate-500' : 'bg-white text-slate-900 border border-slate-200'}`} />
                    <input type="password" value={settingsConfirmPassword} onChange={(e) => setSettingsConfirmPassword(e.target.value)} placeholder="Confirm password" className={`p-3 rounded-xl outline-none text-sm ${darkMode ? 'bg-white/5 text-white placeholder:text-slate-500' : 'bg-white text-slate-900 border border-slate-200'}`} />
                  </div>
                  <button onClick={saveCoveSearchSettingsPassword} className="mb-4 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-gradient-to-r from-[#00337C] to-[#0055A4] text-white">Save Password</button>
                  {settingsError && <p className="text-xs text-red-500 mb-3">{settingsError}</p>}
                  <div className="flex flex-wrap gap-2 mb-4">
                    <button onClick={() => openProtectedAction('reindex')} className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${darkMode ? 'bg-blue-500/15 text-blue-300 hover:bg-blue-500/25' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>Re-index Chat</button>
                    <button onClick={() => openProtectedAction('clearCache')} className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${darkMode ? 'bg-yellow-500/15 text-yellow-300 hover:bg-yellow-500/25' : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'}`}>Clear Cache</button>
                    <button onClick={() => openProtectedAction('clearAll')} className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${darkMode ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-red-50 text-red-700 hover:bg-red-100'}`}>Clear All</button>
                  </div>
                  <button onClick={() => setShowTechDiagnostics(v => !v)} className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest ${darkMode ? 'bg-white/5 text-slate-200 hover:bg-white/10' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{showTechDiagnostics ? 'Hide Diagnostics' : 'Show Diagnostics'}</button>
                  {showTechDiagnostics && (
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div className={`p-2 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white border border-slate-200'}`}>Searches: <span className="font-black">{speedDemonDiag.totalSearches}</span></div>
                      <div className={`p-2 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white border border-slate-200'}`}>Cache Hit Rate: <span className="font-black">{speedDemonDiag.cacheHitRate}%</span></div>
                      <div className={`p-2 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white border border-slate-200'}`}>Shadow Docs: <span className="font-black">{speedDemonDiag.shadowDocCount}</span></div>
                      <div className={`p-2 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white border border-slate-200'}`}>Library Cache: <span className="font-black">{speedDemonDiag.cacheEntryCount}</span></div>
                      <div className={`p-2 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white border border-slate-200'}`}>Cache Quality: <span className="font-black">{speedDemonDiag.avgCacheQuality}%</span></div>
                      <div className={`p-2 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white border border-slate-200'}`}>Deep Failed: <span className="font-black">{speedDemonDiag.deepFailed}</span></div>
                      <div className={`p-2 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white border border-slate-200'}`}>Auto-Heals: <span className="font-black">{speedDemonDiag.autoHeals}</span></div>
                      <div className={`p-2 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white border border-slate-200'}`}>Avg Search: <span className="font-black">{speedDemonDiag.avgSearchMs}ms</span></div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : isRequestsTab ? (
          <div className="flex-1 flex flex-col items-center justify-center px-8 text-center safe-px">
            <div className={`w-20 h-20 rounded-[24px] mb-6 flex items-center justify-center ${darkMode ? 'bg-blue-500/10 text-blue-300' : 'bg-[#00337C]/10 text-[#00337C]'}`}>
              <UserPlus size={36} />
            </div>
            <h2 className={`text-xl md:text-3xl font-black mb-3 ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>Requests</h2>
            <p className={`max-w-lg text-sm md:text-base ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>Review invite requests from the left pane and accept to start a secure chat.</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center select-none safe-px">
            <img src={darkMode ? ASSETS.logoNameWhite : ASSETS.logoNameNavy} alt="Cove Logo" className="w-[280px] mb-6 opacity-15 transition-all duration-500" />
            <p className={`text-sm font-bold uppercase tracking-[0.3em] opacity-15 ${darkMode ? 'text-blue-300' : 'text-slate-500'}`}>Select a conversation to start messaging</p>
          </div>
        )}
      </div>

      {pendingProtectedAction && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-[120]">
          <div className={`p-6 rounded-[24px] w-full max-w-sm shadow-2xl ${darkMode ? 'bg-[#111827] border border-white/10' : 'bg-white border border-slate-200'}`}>
            <h3 className={`text-lg font-black mb-2 ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>Enter Settings Password</h3>
            <p className={`text-xs mb-4 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Required to run this protected Cove Search action.</p>
            <input
              type="password"
              value={settingsPasswordInput}
              onChange={(e) => setSettingsPasswordInput(e.target.value)}
              placeholder="Password"
              className={`w-full p-3 rounded-xl outline-none text-sm mb-3 ${darkMode ? 'bg-white/5 text-white placeholder:text-slate-500' : 'bg-slate-50 text-slate-900 border border-slate-200'}`}
            />
            {settingsError && <p className="text-xs text-red-500 mb-3">{settingsError}</p>}
            <div className="flex gap-2">
              <button onClick={runProtectedAction} className="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-gradient-to-r from-[#00337C] to-[#0055A4] text-white">Confirm</button>
              <button onClick={() => { setPendingProtectedAction(null); setSettingsError(''); setSettingsPasswordInput(''); }} className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest ${darkMode ? 'bg-white/5 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* INVITE MODAL */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className={`p-10 rounded-[40px] w-full max-w-sm shadow-2xl transition-colors ${darkMode ? 'bg-[#111827] border border-white/10' : 'bg-white'}`}>
            <h2 className={`text-xl font-black mb-6 ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>New Connection</h2>
            <input className={`w-full p-4 rounded-2xl mb-6 outline-none font-bold ${darkMode ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-900'}`} placeholder="Email address" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
            <button onClick={sendInvite} className="w-full py-4 bg-[#00337C] text-white rounded-2xl font-bold shadow-xl uppercase tracking-widest">Send Invite</button>
            <button onClick={() => setShowInviteModal(false)} className="w-full mt-4 text-sm font-bold text-slate-400 uppercase tracking-widest hover:text-white transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* CREATE GROUP MODAL */}
      {showGroupModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className={`p-10 rounded-[40px] w-full max-w-sm shadow-2xl transition-colors ${darkMode ? 'bg-[#111827] border border-white/10' : 'bg-white'}`}>
            <h2 className={`text-xl font-black mb-6 ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>Create Group</h2>
            <input className={`w-full p-4 rounded-2xl mb-4 outline-none font-bold ${darkMode ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-900'}`} placeholder="Group name" value={groupName} onChange={e => setGroupName(e.target.value)} />
            <textarea className={`w-full p-4 rounded-2xl mb-6 outline-none font-bold text-sm resize-none ${darkMode ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-900'}`} rows={3} placeholder={"Add members (comma-separated emails)\ne.g. alice@mail.com, bob@mail.com"} value={groupEmails} onChange={e => setGroupEmails(e.target.value)} />
            <button onClick={createGroupChat} className="w-full py-4 bg-gradient-to-r from-[#00337C] to-[#0055A4] text-white rounded-2xl font-bold shadow-xl uppercase tracking-widest">Create Group</button>
            <button onClick={() => { setShowGroupModal(false); setGroupName(''); setGroupEmails(''); }} className="w-full mt-4 text-sm font-bold text-slate-400 uppercase tracking-widest hover:text-white transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* GROUP INFO MODAL */}
      {showGroupInfo && activeChat?.isGroup && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className={`p-8 rounded-[40px] w-full max-w-md shadow-2xl transition-colors max-h-[85vh] overflow-y-auto ${darkMode ? 'bg-[#111827] border border-white/10' : 'bg-white'}`}>
            <div className="flex items-center gap-4 mb-6">
              {isMobile && (
                <button onClick={() => setShowGroupInfo(false)} className={`p-2 rounded-full ${darkMode ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-500'}`}>
                  <ArrowRight size={20} className="rotate-180" />
                </button>
              )}
              <h2 className={`text-xl font-black flex-1 ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>{activeChat.groupName}</h2>
              {!isMobile && <button onClick={() => setShowGroupInfo(false)} className="p-2 rounded-full hover:bg-slate-100/10"><X size={18} /></button>}
            </div>

            {/* Group Photo */}
            <div className="flex items-center gap-4 mb-8">
              <input type="file" ref={groupPhotoInputRef} hidden accept="image/*" onChange={(e) => { if (e.target.files?.[0]) updateGroupPhoto(activeChat.id, e.target.files[0]); }} />
              <div className="relative cursor-pointer group" onClick={() => groupPhotoInputRef.current?.click()}>
                {activeChat.groupPhoto ? (
                  <img src={activeChat.groupPhoto} alt="Group" className="w-20 h-20 rounded-2xl object-cover" />
                ) : (
                  <div className={`w-20 h-20 rounded-2xl flex items-center justify-center ${darkMode ? 'bg-white/10' : 'bg-[#00337C]/10'}`}>
                    <Users size={28} className={darkMode ? 'text-white/40' : 'text-[#00337C]/40'} />
                  </div>
                )}
                <div className="absolute inset-0 rounded-2xl bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera size={18} className="text-white" />
                </div>
              </div>
              <div>
                <p className={`font-bold ${darkMode ? 'text-white' : 'text-slate-900'}`}>{activeChat.participants.length} members</p>
                <p className="text-xs opacity-60">Created by {activeChat.createdBy?.split('@')[0]}</p>
              </div>
            </div>

            {/* Add Member */}
            {activeChat.admins?.includes(userData.email.toLowerCase()) && (
              <div className="mb-6">
                <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${darkMode ? 'text-blue-400' : 'text-[#00337C]'}`}>Add Member</p>
                <div className="flex gap-2">
                  <input className={`flex-1 p-3 rounded-xl outline-none text-sm font-bold ${darkMode ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-900'}`} placeholder="Email address" value={addMemberEmail} onChange={e => setAddMemberEmail(e.target.value)} />
                  <button onClick={() => addGroupMember(activeChat.id, addMemberEmail)} className="p-3 bg-[#00337C] text-white rounded-xl"><UserPlus size={16} /></button>
                </div>
              </div>
            )}

            {/* Members List */}
            <p className={`text-[10px] font-black uppercase tracking-widest mb-3 ${darkMode ? 'text-blue-400' : 'text-[#00337C]'}`}>Members</p>
            <div className="space-y-2">
              {activeChat.participants.map(email => {
                const memberUser = userLookup[email.toLowerCase()];
                const memberName = memberUser?.name || email.split('@')[0];
                const isAdmin = activeChat.admins?.includes(email.toLowerCase());
                const isMe = email.toLowerCase() === userData.email.toLowerCase();
                const iAmAdmin = activeChat.admins?.includes(userData.email.toLowerCase());
                return (
                  <div key={email} className={`p-3 rounded-2xl flex items-center gap-3 ${darkMode ? 'bg-white/5' : 'bg-slate-50'}`}>
                    {memberUser?.photoURL ? (
                      <img src={memberUser.photoURL} alt={memberName} className="w-9 h-9 rounded-xl object-cover" />
                    ) : (
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm ${darkMode ? 'bg-white/10 text-white' : 'bg-[#00337C]/10 text-[#00337C]'}`}>{memberName.charAt(0).toUpperCase()}</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{memberName} {isMe && <span className="opacity-40">(you)</span>}</p>
                      <p className="text-[10px] opacity-50 truncate">{email}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {isAdmin && <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full ${darkMode ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-50 text-yellow-600'}`}>Admin</span>}
                      {iAmAdmin && !isMe && (
                        <>
                          <button onClick={() => toggleAdmin(activeChat.id, email)} title={isAdmin ? 'Remove admin' : 'Make admin'} className={`p-1.5 rounded-lg transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}>
                            <Crown size={14} className={isAdmin ? 'text-yellow-500' : 'opacity-30'} />
                          </button>
                          <button onClick={() => removeGroupMember(activeChat.id, email)} title="Remove" className={`p-1.5 rounded-lg transition-colors hover:bg-red-500/10`}>
                            <UserMinus size={14} className="text-red-500" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button onClick={() => { leaveGroup(activeChat.id); setShowGroupInfo(false); }} className={`w-full mt-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors ${darkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-500'}`}>
              <LogOut size={16} /> Leave Group
            </button>
          </div>
        </div>
      )}

      {editingMessageId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className={`p-8 rounded-[24px] w-full max-w-2xl shadow-2xl transition-colors ${darkMode ? 'bg-[#0b1220] border border-white/5' : 'bg-white'}`}>
            <h3 className={`text-xl font-black mb-4 ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>Edit Message</h3>
            <textarea rows={6} value={editingText} onChange={e => setEditingText(e.target.value)} className={`w-full p-4 rounded-xl resize-none ${darkMode ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-900'}`} />
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={saveEditedMessage} className="px-5 py-3 bg-[#00337C] text-white rounded-xl font-bold">Save</button>
            </div>
          </div>
        </div>
      )}

      {mediaModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className={`rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden ${darkMode ? 'bg-black' : 'bg-white'}`}>
            <div className="flex justify-end p-3">
              <button onClick={() => setMediaModal(null)} className="p-2 rounded-full bg-black/20 text-white">X</button>
            </div>
            <div className="p-4 flex items-center justify-center">
              {mediaModal.type === 'image' ? (
                <img src={mediaModal.url} alt="preview" className="max-h-[80vh] max-w-full object-contain rounded-lg" />
              ) : mediaModal.type === 'video' ? (
                <video src={mediaModal.url} controls autoPlay className="max-h-[80vh] max-w-full rounded-lg" />
              ) : null}
            </div>
            {mediaModal.text && (
              <div className={`p-3 text-sm ${darkMode ? 'text-white/80' : 'text-slate-700'}`}>{mediaModal.text}</div>
            )}
          </div>
        </div>
      )}
      {/* CREDIT WALL MODAL */}
      {showCreditWall && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xl flex items-center justify-center p-6 z-[200]">
          <div className={`p-10 rounded-[40px] w-full max-w-sm shadow-2xl text-center transition-colors ${darkMode ? 'bg-[#111827] border border-white/10' : 'bg-white'}`}>
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#00337C] to-[#0055A4] mx-auto mb-6 flex items-center justify-center">
              <Brain size={36} className="text-white" />
            </div>
            <h2 className={`text-2xl font-black mb-2 ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>Credits Exhausted</h2>
            <p className={`text-sm mb-6 opacity-60 ${darkMode ? 'text-white' : 'text-slate-600'}`}>{"You've used all your free AI credits this week. Upgrade to Pro for unlimited access."}</p>
            <button onClick={() => window.open(getPaymentUrl(), '_blank')} className="w-full py-4 bg-gradient-to-r from-[#00337C] to-[#0055A4] text-white rounded-2xl font-black shadow-lg shadow-blue-900/20 active:scale-95 transition-all uppercase tracking-widest mb-3">
              Upgrade to Pro — $2.99
            </button>
            <p className={`text-[11px] mb-3 ${darkMode ? 'text-blue-300' : 'text-[#00337C]'}`}>🧠 Unlock Infinite Brain • No delays • Full AI power</p>
            <button onClick={() => setShowCreditWall(false)} className="text-sm font-bold text-slate-400 uppercase tracking-widest hover:text-white transition-colors">Maybe Later</button>
          </div>
        </div>
      )}

      {/* WHATSAPP IMPORT PROGRESS */}
      {waImportProgress && (
        <div
          className="fixed left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-2xl z-[100] flex items-center gap-3 border bg-blue-600 text-white border-blue-400"
          style={{ bottom: `calc(env(safe-area-inset-bottom) + ${keyboardOffset + 28}px)` }}
        >
          <Loader2 className="animate-spin" size={16} />
          <span className="text-sm font-bold">{waImportProgress}</span>
        </div>
      )}

      {/* SYNC MISMATCH POPUP */}
      {showSyncMismatch && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-[150]">
          <div className={`p-8 rounded-[30px] w-full max-w-sm shadow-2xl transition-colors ${darkMode ? 'bg-[#111827] border border-white/10' : 'bg-white'}`}>
            <h3 className={`text-lg font-black mb-3 ${darkMode ? 'text-white' : 'text-[#00337C]'}`}>Sync Mismatch Detected</h3>
            <p className={`text-sm mb-6 opacity-70 ${darkMode ? 'text-white' : 'text-slate-600'}`}>{showSyncMismatch.chatName}{"'s conversation looks a little different from the cloud backup."}</p>
            <div className="flex gap-3">
              <button onClick={() => { showToast('Syncing...', 'info'); setShowSyncMismatch(null); }} className="flex-1 py-3 bg-[#00337C] text-white rounded-xl font-bold">Sync</button>
              <button onClick={() => setShowSyncMismatch(null)} className={`flex-1 py-3 rounded-xl font-bold border ${darkMode ? 'border-white/10 text-white' : 'border-slate-200 text-slate-600'}`}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-2xl z-[100] animate-bounce-subtle flex items-center gap-3 border ${darkMode ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-100 text-slate-900'}`}
          style={{ bottom: `calc(env(safe-area-inset-bottom) + ${keyboardOffset + 24}px)` }}
        >
          <div className={`w-2 h-2 rounded-full ${toast.type === 'success' ? 'bg-green-500 animate-pulse' : toast.type === 'error' ? 'bg-red-500' : 'bg-blue-500'}`} />
          <span className="text-sm font-bold truncate">{toast.message}</span>
        </div>
      )}

      <style>{`
        ::-webkit-scrollbar {
          width: 5px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'};
          border-radius: 10px;
        }
      `}</style>

      {/* CALL OVERLAY */}
      {call && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/90 backdrop-blur-xl flex items-center justify-center p-4" style={{ pointerEvents: 'auto' }}>
          <div className="w-full max-w-4xl aspect-video bg-black rounded-[40px] overflow-hidden shadow-2xl relative border border-white/10">
            {/* Remote Stream */}
            <div className="absolute inset-0 flex items-center justify-center">
              {call.type === 'video' && remoteStream ? (
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-32 h-32 rounded-full bg-blue-600 flex items-center justify-center text-white text-5xl font-black animate-pulse">
                    {(call.isIncoming ? call.caller : call.receiver)?.charAt(0).toUpperCase()}
                  </div>
                  <p className="text-xl font-bold text-white uppercase tracking-widest">{call.isIncoming ? call.caller.split('@')[0] : call.receiver.split('@')[0]}</p>
                  <p className="text-blue-400 font-bold animate-pulse uppercase tracking-[0.2em] text-xs">
                    {call.status === 'dialing' ? 'Dialing...' : call.status === 'ongoing' ? 'Ongoing Call' : 'Connecting...'}
                  </p>
                </div>
              )}
            </div>

            {/* Local Stream (PIP) */}
            {call.type === 'video' && localStream && (
              <div className="absolute top-6 right-6 w-32 md:w-48 aspect-video bg-slate-800 rounded-2xl overflow-hidden border-2 border-white/20 shadow-xl z-10">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'rotateY(180deg)' }} />
              </div>
            )}

            {/* Call Controls */}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-4 md:gap-8 z-50">
              {call.isIncoming && call.status === 'dialing' ? (
                <div className="flex items-center gap-6 md:gap-10">
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); console.log('DEBUG: Accept button clicked'); joinCall(call); }}
                      className="w-20 h-20 rounded-full bg-green-500 text-white flex items-center justify-center shadow-[0_0_30px_rgba(34,197,94,0.4)] hover:scale-110 active:scale-90 transition-all cursor-pointer relative z-[60]"
                    >
                      <Phone size={32} />
                    </button>
                    <span className="text-[10px] font-black text-white uppercase tracking-widest">Accept</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); console.log('DEBUG: Reject button clicked'); rejectCall(call); }}
                      className="w-20 h-20 rounded-full bg-red-500 text-white flex items-center justify-center shadow-[0_0_30px_rgba(239,44,44,0.4)] hover:scale-110 active:scale-90 transition-all cursor-pointer relative z-[60]"
                    >
                      <PhoneOff size={32} />
                    </button>
                    <span className="text-[10px] font-black text-white uppercase tracking-widest">Decline</span>
                  </div>
                </div>
              ) : (
                <>
                  <button onClick={toggleMic} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isMicMuted ? 'bg-red-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'}`}>
                    {isMicMuted ? <MicOff size={24} /> : <Mic size={24} />}
                  </button>
                  {call.type === 'video' && (
                    <button onClick={toggleCamera} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isCameraOff ? 'bg-red-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'}`}>
                      {isCameraOff ? <VideoOff size={24} /> : <Video size={24} />}
                    </button>
                  )}
                  <button onClick={endCall} className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all">
                    <PhoneOff size={28} />
                  </button>
                </>
              )}
            </div>
          </div>


        </div>
      )}
    </div>
  );
}
