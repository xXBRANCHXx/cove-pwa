import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from 'firebase/auth';
import {
  getFirestore, collection, doc, setDoc, getDoc, onSnapshot, addDoc,
  query, orderBy, serverTimestamp, updateDoc, where, deleteDoc, getDocs, writeBatch, limit, limitToLast
} from 'firebase/firestore';
import {
  Send, X, User, PlusCircle, Moon, Sun, Search, Smile,
  Settings, LogOut, Camera, MessageSquare, MoreVertical, Check, Trash2, Reply, ArrowRight, Paperclip, FileText, Download, Mic, Maximize,
  Pin, Ban, AlertTriangle, CheckCheck, Loader2, Users, UserPlus, UserMinus, Crown, LogOut as LogOutIcon, Image, Lock,
  Phone, Video, PhoneOff, MicOff, VideoOff
} from 'lucide-react';

// --- CONFIG ---
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
// Use explicit image/upload endpoint for unsigned uploads
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

// NOTE: client requests a server-side signature from `/api/cloudinary-sign`.

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// Note: Firebase Storage fallback removed (not used)

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
  const [usersByEmail, setUsersByEmail] = useState({});
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
  const [pendingAttachments, setPendingAttachments] = useState([]); // array of { file, previewUrl, fileType, uploadedUrl }
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
  const [messagesLimit, setMessagesLimit] = useState(15);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [optimisticMessages, setOptimisticMessages] = useState([]);
  const lastScrollPosRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  const isLoadingMoreRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const [activeTab, setActiveTab] = useState('chats'); // 'chats' | 'settings'
  const [toast, setToast] = useState(null); // { message, type }

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

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(event.target)) {
        setShowChatMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    const checkSize = () => {
      setIsMobile(window.innerWidth < 1024);
      // Force a re-calc of vh for mobile browsers
      let vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    checkSize();
    window.addEventListener('resize', checkSize);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener('resize', checkSize);
    };
  }, []);

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

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');

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
      const url = await uploadFileToCloudinary(target.file);
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

  // --- DATA LISTENERS ---
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        onSnapshot(doc(db, 'users', u.uid), (snap) => setUserData(snap.data()));
      } else {
        setUser(null);
        setUserData(null);
      }
    });
  }, []);

  useEffect(() => {
    if (!userData?.email) return;
    const emailLow = userData.email.toLowerCase();
    const qChats = query(collection(db, 'contacts'), where('participants', 'array-contains', emailLow));
    return onSnapshot(qChats, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setChats(list.sort((a, b) => {
        const aPinned = a.pinnedBy?.includes(userData.email.toLowerCase()) ? 1 : 0;
        const bPinned = b.pinnedBy?.includes(userData.email.toLowerCase()) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0);
      }));
      // Keep activeChat in sync with latest data
      setActiveChat(prev => {
        if (!prev) return prev;
        const updated = list.find(c => c.id === prev.id);
        return updated || prev;
      });
    });
  }, [userData?.email]);

  // listen to users collection and build quick lookup by email
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const map = {};
      snap.docs.forEach(d => { const data = d.data(); if (data?.email) map[data.email.toLowerCase()] = { id: d.id, ...data }; });
      setUsersByEmail(map);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!userData?.email) return;
    const qInvites = query(collection(db, 'pending_requests'), where('to', '==', userData.email.toLowerCase()), where('status', '==', 'pending'));
    return onSnapshot(qInvites, (snap) => setPendingInvites(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [userData?.email]);

  useEffect(() => {
    if (!activeChat) return;
    setMessagesLimit(15);
    setHasMoreMessages(true);
    isInitialLoadRef.current = true;
  }, [activeChat?.id]);

  useEffect(() => {
    if (!activeChat) return;
    const q = query(
      collection(db, 'contacts', activeChat.id, 'messages'),
      orderBy('timestamp', 'asc'),
      limitToLast(messagesLimit)
    );
    return onSnapshot(q, (snap) => {
      const newMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // If we got fewer messages than the limit, we probably reached the end
      if (newMessages.length < messagesLimit) {
        setHasMoreMessages(false);
      }
      setMessages(newMessages);

      // Scroll handling
      if (isInitialLoadRef.current) {
        // Defer scroll to after React renders the messages
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
          if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
          }
        }, 50);
        isInitialLoadRef.current = false;
      } else if (lastScrollPosRef.current > 0 && messagesContainerRef.current) {
        // Maintain scroll position when loading older messages
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

      // Cleanup optimistic messages that have been confirmed by Firestore
      setOptimisticMessages(prev => prev.filter(om => !newMessages.some(m => m.tempId === om.tempId || (m.text === om.text && m.senderEmail === om.senderEmail && Math.abs((m.timestamp?.seconds || Date.now() / 1000) - om.created / 1000) < 5))));
    });
  }, [activeChat?.id, messagesLimit]);

  const handleScroll = () => {
    if (!messagesContainerRef.current || isLoadingMoreRef.current) return;
    const { scrollTop } = messagesContainerRef.current;
    if (scrollTop < 80 && hasMoreMessages && !isInitialLoadRef.current) {
      isLoadingMoreRef.current = true;
      lastScrollPosRef.current = messagesContainerRef.current.scrollHeight;
      setMessagesLimit(prev => prev + 15);
    }
  };

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
        const q = query(collection(db, 'contacts', activeChat.id, 'messages'), where('senderEmail', '!=', userData.email));
        const snap = await getDocs(q);
        const batch = writeBatch(db);
        let changed = false;
        snap.forEach(d => {
          const data = d.data();
          if (!data.seenAt) { batch.update(d.ref, { seenAt: serverTimestamp() }); changed = true; }
        });
        if (changed) await batch.commit();
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
    if (!firebaseConfig.apiKey) {
      showToast("Config Error: Check Vercel Env Vars", "error");
      return;
    }
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
        // Sign Up Flow
        const res = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        await setDoc(doc(db, 'users', res.user.uid), {
          uid: res.user.uid,
          name: username,
          email: cleanEmail,
          photoURL: null,
          createdAt: serverTimestamp()
        });
        showToast("Welcome to Cove!", "success");
      } else {
        // Login Flow
        const res = await signInWithEmailAndPassword(auth, cleanEmail, password);
        // Ensure user doc exists for profile picture sync
        const userRef = doc(db, 'users', res.user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: res.user.uid,
            name: cleanEmail.split('@')[0],
            email: cleanEmail,
            photoURL: null,
            createdAt: serverTimestamp()
          });
        }
      }
    } catch (err) {
      console.error("Auth Error:", err.code);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        showToast("Invalid email or password", "error");
      } else if (err.code === 'auth/email-already-in-use') {
        showToast("Email already registered. Try logging in.", "error");
      } else {
        showToast("Error: " + err.code, "error");
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
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this conversation?")) return;

    try {
      const messagesRef = collection(db, 'contacts', chatId, 'messages');
      const q = query(messagesRef);
      const querySnapshot = await getDocs(q);
      const batch = writeBatch(db);
      querySnapshot.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      await deleteDoc(doc(db, 'contacts', chatId));
      if (activeChat?.id === chatId) setActiveChat(null);
    } catch (err) {
      console.error("Error deleting chat:", err);
    }
  };

  const deleteMessageWithConfirm = async (msgId) => {
    if (!window.confirm('Delete this message? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'contacts', activeChat.id, 'messages', msgId));
      // After deleting, ensure the parent contact's lastMessage is still valid.
      try {
        const msgsRef = collection(db, 'contacts', activeChat.id, 'messages');
        const qLast = query(msgsRef, orderBy('timestamp', 'desc'), limit(1));
        // get the most recent message
        const snaps = await getDocs(qLast);
        let last = null;
        if (!snaps.empty) {
          // take first doc
          const docSnap = snaps.docs[0];
          last = docSnap.data();
        }
        if (last) {
          const newLastMessage = last.fileUrl ? `📎 ${last.text || ''}` : (last.text || '');
          await updateDoc(doc(db, 'contacts', activeChat.id), { lastMessage: newLastMessage, lastSender: last.senderEmail || null, timestamp: last.timestamp || serverTimestamp() });
        } else {
          // no messages left in this chat
          await updateDoc(doc(db, 'contacts', activeChat.id), { lastMessage: '', lastSender: null, timestamp: serverTimestamp() });
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
      await updateDoc(doc(db, 'contacts', activeChat.id, 'messages', editingMessageId), { text: editingText, edited: true, editedAt: serverTimestamp() });
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
      await updateDoc(doc(db, 'contacts', chatId), { pinnedBy: updatedPinnedBy });
    } catch (err) { console.error('Failed to toggle pin', err); }
  };

  const reportAbuse = async (chatId) => {
    if (!chatId || !userData?.email) return;
    if (!window.confirm("Report this conversation for abuse?")) return;
    try {
      await addDoc(collection(db, 'reports'), {
        chatId,
        reportedBy: userData.email,
        timestamp: serverTimestamp(),
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
      await updateDoc(doc(db, 'users', user.uid), { blocked: updatedBlocked });
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

  const handleInviteResponse = async (invite, approved) => {
    if (!approved) {
      if (!window.confirm('Decline and remove this invite?')) return;
    }
    if (approved) {
      await addDoc(collection(db, 'contacts'), {
        participants: [invite.from.toLowerCase(), invite.to.toLowerCase()],
        lastMessage: "Connection established",
        timestamp: serverTimestamp()
      });
    }
    await deleteDoc(doc(db, 'pending_requests', invite.id));
  };

  const sendInvite = async () => {
    if (!inviteEmail || !userData) return;
    const cleanEmail = inviteEmail.toLowerCase().trim();
    await addDoc(collection(db, 'pending_requests'), {
      from: userData.email,
      to: cleanEmail,
      status: 'pending',
      timestamp: serverTimestamp()
    });
    setShowInviteModal(false);
    setInviteEmail("");
  };

  // --- GROUP CHAT FUNCTIONS ---
  const createGroupChat = async () => {
    if (!groupName.trim() || !userData) return;
    const emails = groupEmails.split(',').map(e => e.trim().toLowerCase()).filter(e => e && e !== userData.email.toLowerCase());
    if (emails.length < 1) { showToast('Add at least one member', 'error'); return; }
    const participants = [userData.email.toLowerCase(), ...emails];
    try {
      const docRef = await addDoc(collection(db, 'contacts'), {
        participants,
        isGroup: true,
        groupName: groupName.trim(),
        groupPhoto: null,
        admins: [userData.email.toLowerCase()],
        createdBy: userData.email.toLowerCase(),
        lastMessage: `${userData.name || userData.email.split('@')[0]} created the group`,
        lastSender: userData.email,
        timestamp: serverTimestamp()
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
      await updateDoc(doc(db, 'contacts', chatId), {
        participants: [...chat.participants, clean],
        lastMessage: `${clean.split('@')[0]} was added`,
        lastSender: userData.email,
        timestamp: serverTimestamp()
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
      await updateDoc(doc(db, 'contacts', chatId), {
        participants: updated,
        admins: updatedAdmins,
        lastMessage: `${email.split('@')[0]} was removed`,
        lastSender: userData.email,
        timestamp: serverTimestamp()
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
      await updateDoc(doc(db, 'contacts', chatId), { admins: updatedAdmins });
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
      await updateDoc(doc(db, 'contacts', chatId), {
        participants: updated,
        admins: updatedAdmins.length > 0 ? updatedAdmins : (updated.length > 0 ? [updated[0]] : []),
        lastMessage: `${userData.name || userData.email.split('@')[0]} left the group`,
        lastSender: userData.email,
        timestamp: serverTimestamp()
      });
      setActiveChat(null);
      showToast('You left the group', 'info');
    } catch (err) { console.error(err); }
  };

  const updateGroupPhoto = async (chatId, file) => {
    if (!file || !chatId) return;
    try {
      const url = await uploadFileToCloudinary(file);
      if (url) {
        await updateDoc(doc(db, 'contacts', chatId), { groupPhoto: url });
        showToast('Group photo updated', 'success');
      }
    } catch (err) { console.error(err); showToast('Failed to update photo', 'error'); }
  };

  const handleProfileUpdate = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', UPLOAD_PRESET);
      const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Upload failed: ${res.status} ${text}`);
      }
      const data = await res.json();
      const url = data.secure_url || data.url || null;
      if (url) {
        await updateDoc(doc(db, 'users', user.uid), { photoURL: url });
      } else {
        throw new Error('Upload response missing url');
      }
    } catch (err) { console.error(err); }
    finally { setUploading(false); }
  };

  const handleChatFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files || files.length === 0) return;

    // Create local previews for each file and defer upload until sendMessage
    try {
      const toAdd = files.map(file => {
        const previewUrl = URL.createObjectURL(file);
        let fileType = 'file';
        if (file.type.startsWith('image')) fileType = 'image';
        else if (file.type.startsWith('audio')) fileType = 'audio';
        else if (file.type.startsWith('video')) fileType = 'video';
        return { file, previewUrl, fileType, uploadedUrl: null };
      });
      setPendingAttachments(prev => [...prev, ...toAdd]);
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
      const toAdd = files.map(file => {
        const previewUrl = URL.createObjectURL(file);
        let fileType = 'file';
        if (file.type.startsWith('image')) fileType = 'image';
        else if (file.type.startsWith('audio')) fileType = 'audio';
        else if (file.type.startsWith('video')) fileType = 'video';
        return { file, previewUrl, fileType, uploadedUrl: null };
      });
      setPendingAttachments(prev => [...prev, ...toAdd]);
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
            const previewUrl = URL.createObjectURL(file);
            let fileType = 'file';
            if (file.type.startsWith('image')) fileType = 'image';
            else if (file.type.startsWith('audio')) fileType = 'audio';
            else if (file.type.startsWith('video')) fileType = 'video';
            setPendingAttachments(prev => [...prev, { file, previewUrl, fileType, uploadedUrl: null }]);
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
        const previewUrl = URL.createObjectURL(blob);
        const fileObj = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
        setPendingAttachments(prev => [...prev, { file: fileObj, previewUrl, fileType: 'audio', uploadedUrl: null }]);
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

  const uploadFileToCloudinary = async (file) => {
    // Request a server-side signature for the upload (secure)
    let signResp = null;
    try {
      const r = await fetch('/api/cloudinary-sign', { method: 'POST' });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`Signature request failed: ${r.status} ${txt}`);
      }
      signResp = await r.json();
    } catch (err) {
      console.error('Failed to obtain Cloudinary signature:', err);
      throw err;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', signResp.upload_preset || UPLOAD_PRESET);
    formData.append('timestamp', signResp.timestamp);
    formData.append('signature', signResp.signature);
    formData.append('api_key', signResp.api_key);

    // Choose resource type / endpoint based on file mime type
    let resourceType = 'auto';
    if (file && file.type) {
      if (file.type.startsWith('image')) resourceType = 'image';
      else if (file.type.startsWith('video')) resourceType = 'video';
      else if (file.type.startsWith('audio')) resourceType = 'raw'; // Cloudinary often stores audio as raw
      else resourceType = 'raw';
    }

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`;
    const res = await fetch(uploadUrl, { method: 'POST', body: formData });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload failed (${uploadUrl}): ${res.status} ${text}`);
    }
    const data = await res.json();
    return data.secure_url || data.url || null;
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
              const fileUrl = await uploadFileToCloudinary(att.file);
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

      if (text?.trim() && currentAttachments.length === 1) {
        const att = currentAttachments[0];
        const msgData = {
          text: text.trim(),
          fileUrl: att.uploadedUrl || null,
          fileType: att.fileType || null,
          senderEmail: userData.email,
          timestamp: serverTimestamp(),
          replyTo: optimisticBase.replyTo,
          tempId
        };
        await addDoc(collection(db, 'contacts', activeChat.id, 'messages'), msgData);
        await updateDoc(doc(db, 'contacts', activeChat.id), { lastMessage: msgData.fileUrl ? `📎 ${msgData.text}` : msgData.text, lastSender: userData.email, timestamp: serverTimestamp() });
      } else {
        if (text?.trim()) {
          const msgData = {
            text: text.trim(),
            fileUrl: null,
            fileType: null,
            senderEmail: userData.email,
            timestamp: serverTimestamp(),
            replyTo: optimisticBase.replyTo,
            tempId
          };
          await addDoc(collection(db, 'contacts', activeChat.id, 'messages'), msgData);
          await updateDoc(doc(db, 'contacts', activeChat.id), { lastMessage: msgData.text, lastSender: userData.email, timestamp: serverTimestamp() });
        }

        for (let i = 0; i < currentAttachments.length; i++) {
          const att = currentAttachments[i];
          const msgData = {
            text: att.file?.name || '',
            fileUrl: att.uploadedUrl || null,
            fileType: att.fileType || null,
            senderEmail: userData.email,
            timestamp: serverTimestamp(),
            tempId: toSend.find(ts => ts.fileUrl === att.previewUrl)?.tempId || Math.random().toString(36).substring(7)
          };
          await addDoc(collection(db, 'contacts', activeChat.id, 'messages'), msgData);
          await updateDoc(doc(db, 'contacts', activeChat.id), { lastMessage: msgData.fileUrl ? `📎 ${msgData.text}` : msgData.text, lastSender: userData.email, timestamp: serverTimestamp() });
        }
      }
    } catch (err) {
      console.error('SendMessage failed', err);
    } finally {
      // isSending handled if we want to block, but here we allow concurrent. 
      // cleanup local blobs? 
    }
  };

  // --- WEBRTC CALLING LOGIC ---
  const servers = {
    iceServers: [
      { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    ],
    iceCandidatePoolSize: 10,
  };

  const endCall = async () => {
    console.log("DEBUG: Ending call and cleaning up...");

    // Cleanup listeners
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

    if (call?.id) {
      handledCallsRef.current.add(call.id);
      try {
        await updateDoc(doc(db, 'calls', call.id), { status: 'ended', endedAt: serverTimestamp() });
      } catch (e) { }
    }
    setCall(null);
    candidateQueueRef.current = [];
    setIsMicMuted(false);
    setIsCameraOff(false);
    notificationShownRef.current = null;
  };

  const startCall = async (type = 'video') => {
    if (!activeChat || !userData || call) return; // Don't start if already in a call
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
        console.log("DEBUG: Recieved remote track");
        setRemoteStream(event.streams[0]);
      };

      const callDoc = doc(collection(db, 'calls'));
      const offerDescription = await pc.createOffer();
      await pc.setLocalDescription(offerDescription);

      await setDoc(callDoc, {
        type,
        caller: userData.email,
        receiver: receiverEmail,
        status: 'dialing',
        offer: { sdp: offerDescription.sdp, type: offerDescription.type },
        createdAt: serverTimestamp(),
      });

      setCall({ id: callDoc.id, type, caller: userData.email, receiver: receiverEmail, status: 'dialing', isIncoming: false });

      // Timeout for no answer (30 seconds)
      const timeout = setTimeout(() => {
        if (pcRef.current && pcRef.current.signalingState !== 'stable') {
          showToast("Call timed out: No answer", "info");
          endCall();
        }
      }, 30000);

      // Listen for Firestore updates
      const unsubCall = onSnapshot(callDoc, async (snapshot) => {
        const data = snapshot.data();
        if (!data || !pcRef.current) return;

        setCall(prev => prev ? { ...prev, ...data } : null);

        if (!pcRef.current.currentRemoteDescription && data.answer) {
          clearTimeout(timeout);
          console.log("DEBUG: Call answered, setting remote description");
          const answerDescription = new RTCSessionDescription(data.answer);
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
      unsubsRef.current.push(unsubCall);

      // Listen for ICE candidates from receiver
      const unsubRecvICE = onSnapshot(collection(db, 'calls', callDoc.id, 'receiverCandidates'), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added' && pcRef.current) {
            const data = change.doc.data();
            if (pcRef.current.currentRemoteDescription) {
              pcRef.current.addIceCandidate(new RTCIceCandidate(data)).catch(e => console.error("ICE Add Error:", e));
            } else {
              candidateQueueRef.current.push(data);
            }
          }
        });
      });
      unsubsRef.current.push(unsubRecvICE);

      // Send local ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          addDoc(collection(db, 'calls', callDoc.id, 'callerCandidates'), event.candidate.toJSON());
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

      const callDoc = doc(db, 'calls', incomingCall.id);

      setCall(prev => ({ ...prev, status: 'connecting' }));
      await updateDoc(callDoc, { status: 'connecting' });

      const offerDescription = new RTCSessionDescription(incomingCall.offer);
      await pc.setRemoteDescription(offerDescription);
      console.log("DEBUG: Remote description set on join");

      // Process any queued candidates if any (though unlikely here)
      candidateQueueRef.current.forEach(cand => {
        pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.log("ICE Queue Error:", e));
      });
      candidateQueueRef.current = [];

      const answerDescription = await pc.createAnswer();
      await pc.setLocalDescription(answerDescription);

      await updateDoc(callDoc, {
        answer: { type: answerDescription.type, sdp: answerDescription.sdp },
        status: 'ongoing'
      });

      // Send local ICE candidates to caller
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          addDoc(collection(db, 'calls', incomingCall.id, 'receiverCandidates'), event.candidate.toJSON());
        }
      };

      // Listen for ICE candidates from caller
      const unsubCallerICE = onSnapshot(collection(db, 'calls', incomingCall.id, 'callerCandidates'), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added' && pcRef.current) {
            const data = change.doc.data();
            if (pcRef.current.currentRemoteDescription) {
              pcRef.current.addIceCandidate(new RTCIceCandidate(data)).catch(e => console.log("ICE Join Error:", e));
            } else {
              candidateQueueRef.current.push(data);
            }
          }
        });
      });
      unsubsRef.current.push(unsubCallerICE);

      // Listen for call updates
      const unsubCallUpdate = onSnapshot(callDoc, (snapshot) => {
        const data = snapshot.data();
        if (!data) return;
        setCall(prev => prev ? { ...prev, ...data } : null);
        if (data.status === 'ended' || data.status === 'rejected') {
          endCall();
        }
      });
      unsubsRef.current.push(unsubCallUpdate);

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
      await updateDoc(doc(db, 'calls', incomingCall.id), { status: 'rejected' });
    } catch (e) { }
  };

  // Listen for incoming calls
  useEffect(() => {
    if (!userData?.email) return;

    // Filter by timestamp to only see calls from the last 60 seconds
    const sixtySecondsAgo = new Date(Date.now() - 60000);

    const q = query(
      collection(db, 'calls'),
      where('receiver', '==', userData.email),
      where('status', '==', 'dialing'),
      where('createdAt', '>', sixtySecondsAgo),
      limit(1)
    );

    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty && !call) {
        const docSnap = snap.docs[0];
        if (handledCallsRef.current.has(docSnap.id)) {
          console.log("DEBUG: Call already handled, skipping listener trigger");
          return;
        }
        console.log("DEBUG: Setting incoming call state for ID:", docSnap.id);
        setCall({ id: docSnap.id, isIncoming: true, ...docSnap.data() });
      }
    });
    return unsub;
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

    const msgData = {
      text: forwardItem.text,
      fileUrl: forwardItem.fileUrl || null,
      fileType: forwardItem.fileType || null,
      senderEmail: userData.email,
      timestamp: serverTimestamp(),
      isForwarded: true
    };

    await addDoc(collection(db, 'contacts', targetChat.id, 'messages'), msgData);
    await updateDoc(doc(db, 'contacts', targetChat.id), {
      lastMessage: forwardItem.fileUrl ? `📎 ${forwardItem.text}` : forwardItem.text,
      lastSender: userData.email,
      timestamp: serverTimestamp()
    });
    setForwardItem(null);
  };

  if (!user) {
    return (
      <div className={`fixed inset-0 h-[100dvh] flex items-center justify-center p-4 transition-colors duration-500 ${darkMode ? 'bg-[#0f172a]' : 'bg-slate-50'}`}>
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

  const showConvoList = !isMobile || (activeTab === 'chats' && !activeChat);
  const showChatWindow = !isMobile || activeChat;
  const showSettingsTab = isMobile && activeTab === 'settings' && !activeChat;

  return (
    <div className={`fixed inset-0 h-[100dvh] flex overflow-hidden ${darkMode ? 'bg-[#0a0f1e] text-white' : 'bg-white text-slate-900'}`}>
      <Head>
        <title>Cove | Secure Private Messaging</title>
        <meta name="description" content="Secure, private, and fast communication with Cove Messenger." />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover" />
        <link rel="icon" href={ASSETS.logoNavy} />
      </Head>

      {/* SIDEBAR / CONVO LIST */}
      <div className={`${isMobile ? 'w-full' : 'w-[350px]'} h-full flex flex-col border-r ${darkMode ? 'bg-[#111827] border-white/5' : 'bg-white border-slate-100'} ${!showConvoList ? 'hidden' : 'flex'}`}>
        <div className="p-6 safe-px safe-p-top">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
              <img
                src={darkMode ? ASSETS.logoNameWhite : ASSETS.logoNameNavy}
                alt="Cove"
                className="h-10 md:h-8 object-contain"
              />
            </div>
            <div className="flex gap-2">
              <Users className={`cursor-pointer transition-colors ${darkMode ? 'text-slate-500 hover:text-white' : 'text-slate-300 hover:text-[#00337C]'}`} size={22} onClick={() => setShowGroupModal(true)} title="Create Group" />
              <PlusCircle className={`cursor-pointer transition-colors ${darkMode ? 'text-slate-500 hover:text-white' : 'text-slate-300 hover:text-[#00337C]'}`} onClick={() => setShowInviteModal(true)} title="New Chat" />
              {!isMobile && (
                <Settings className={`cursor-pointer transition-colors ${showSettings ? (darkMode ? 'text-white' : 'text-[#00337C]') : (darkMode ? 'text-slate-500' : 'text-slate-300')}`} onClick={() => setShowSettings(!showSettings)} />
              )}
            </div>
          </div>
          <div className="relative">
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${darkMode ? 'text-slate-500' : 'text-slate-300'}`} size={16} />
            <input className={`w-full py-3 pl-12 pr-4 rounded-2xl text-sm outline-none transition-colors ${darkMode ? 'bg-slate-800 text-white placeholder:text-slate-500' : 'bg-slate-100 text-slate-900'}`} placeholder="Search..." />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3">
          {pendingInvites.length > 0 && (
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

          <p className="text-[10px] font-black uppercase text-slate-300 mb-3 ml-4 tracking-widest">Conversations</p>
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
                  const partnerUser = usersByEmail[(partnerEmail || userData?.email)?.toLowerCase()];
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
        </div>

        {/* MOBILE BOTTOM NAV */}
        {isMobile && !activeChat && (
          <div className={`flex items-center justify-around p-4 border-t ${darkMode ? 'bg-[#111827] border-white/10' : 'bg-white border-slate-100'}`}>
            <button onClick={() => setActiveTab('chats')} className={`flex flex-col items-center gap-1 ${activeTab === 'chats' ? (darkMode ? 'text-blue-400' : 'text-[#00337C]') : 'text-slate-400'}`}>
              <MessageSquare size={20} />
              <span className="text-[10px] font-bold uppercase tracking-widest">Chats</span>
            </button>
            <button onClick={() => setActiveTab('settings')} className={`flex flex-col items-center gap-1 ${activeTab === 'settings' ? (darkMode ? 'text-blue-400' : 'text-[#00337C]') : 'text-slate-400'}`}>
              <Settings size={20} />
              <span className="text-[10px] font-bold uppercase tracking-widest">Settings</span>
            </button>
          </div>
        )}
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
                    {userData?.photoURL && <button onClick={async () => { try { await updateDoc(doc(db, 'users', user.uid), { photoURL: null }); } catch (e) { console.error(e); } }} className={`py-2 px-3 rounded-2xl border font-bold text-sm ${darkMode ? 'border-white/10 text-white' : 'border-slate-200'}`}>Remove</button>}
                  </div>
                </div>
              </div>
              <button onClick={() => { setDarkMode(!darkMode); try { localStorage.setItem('cove_dark_mode', String(!darkMode)); } catch (e) { } }} className={`w-full p-4 rounded-2xl font-bold flex justify-between items-center transition-colors ${darkMode ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-600'}`}>Appearance <span>{darkMode ? <Moon size={18} /> : <Sun size={18} />}</span></button>
              <button onClick={() => signOut(auth)} className={`w-full p-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors ${darkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-500'}`}>Sign Out</button>
            </div>
          </div>
        ) : activeChat ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            <div className={`p-2 border-b flex items-center justify-between transition-all duration-300 z-30 relative overflow-hidden max-w-full ${darkMode ? 'bg-[#111827] border-white/5' : 'bg-white border-slate-100'}`}>
              <div className="flex items-center gap-1 md:gap-4 flex-1 min-w-0 overflow-hidden">
                {isMobile && (
                  <button onClick={() => setActiveChat(null)} className={`p-2 rounded-full ${darkMode ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-500'}`}>
                    <ArrowRight size={20} className="rotate-180" />
                  </button>
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
                  const partnerUser = usersByEmail[(partnerEmail || userData.email).toLowerCase()];
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
                        <Phone size={isMobile ? 14 : 20} />
                      </button>
                      <button
                        onClick={() => { console.log('DEBUG: Video call button clicked'); startCall('video'); }}
                        className={`w-8 h-8 md:w-12 md:h-12 flex items-center justify-center rounded-full transition-all active:scale-90 cursor-pointer ${darkMode ? 'bg-white/5 hover:bg-white/10 text-blue-400' : 'bg-slate-50 hover:bg-slate-100 text-[#00337C]'} border ${darkMode ? 'border-white/5' : 'border-slate-100'}`}
                        title="Video Call"
                      >
                        <Video size={isMobile ? 14 : 20} />
                      </button>
                    </div>
                  )}
                  <div className={`flex items-center rounded-full shadow-sm transition-all duration-300 ease-in-out overflow-hidden ${darkMode ? 'bg-white/5' : 'bg-white'} ${chatSearchExpanded ? 'flex-1 max-w-[150px] md:max-w-[260px] px-2 md:px-4 py-1.5 md:py-2 opacity-100' : 'w-8 h-8 md:w-10 md:h-10 px-0 opacity-80 hover:opacity-100 cursor-pointer justify-center'}`} onClick={() => { if (!chatSearchExpanded) setChatSearchExpanded(true); }}>
                    <Search size={isMobile ? 14 : 18} className={`shrink-0 transition-all duration-300 ${chatSearchExpanded ? 'opacity-60 mr-2' : 'opacity-100'}`} onClick={(e) => { if (chatSearchExpanded && !chatSearch) { e.stopPropagation(); setChatSearchExpanded(false); updateChatSearch(''); } }} />

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

                  <div className="relative" ref={chatMenuRef}>
                    <button onClick={() => setShowChatMenu(!showChatMenu)} className={`w-7 h-7 md:w-10 md:h-10 rounded-full flex items-center justify-center transition-colors ${darkMode ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-white hover:bg-slate-50 text-slate-700'} shadow-sm shrink-0`}>
                      <MoreVertical size={isMobile ? 14 : 18} />
                    </button>
                    {showChatMenu && (
                      <div className={`absolute right-0 top-full mt-2 w-56 rounded-2xl shadow-xl z-50 overflow-hidden border backdrop-blur-xl animate-menu-in ${darkMode ? 'bg-[#1e293b]/90 border-white/10' : 'bg-white/90 border-slate-100'}`}>
                        <div className="p-1 flex flex-col">
                          {activeChat.isGroup && (
                            <button className={`w-full text-left px-4 py-3 text-sm font-bold flex items-center gap-3 transition-colors ${darkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50'}`} onClick={() => { setShowChatMenu(false); setShowGroupInfo(true); }}>
                              <Users size={16} /> Group Info
                            </button>
                          )}
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
              <div className={`absolute inset-0 z-20 flex items-center justify-center transition-opacity ${isDragging ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
                <div className={`w-[80%] max-w-4xl h-44 rounded-3xl flex items-center justify-center px-6 backdrop-blur-md ${isDragging ? 'bg-white/40 dark:bg-black/40' : 'bg-white/5 dark:bg-black/5'} border-2 border-dashed ${isDragging ? 'border-slate-300/80' : 'border-slate-300/30'}`}>
                  <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">Drag & drop an image to upload</p>
                </div>
              </div>
              {(() => {
                const all = [...messages, ...optimisticMessages].sort((a, b) => {
                  const ta = a.timestamp?.seconds ? a.timestamp.seconds * 1000 : (a.created || Date.now());
                  const tb = b.timestamp?.seconds ? b.timestamp.seconds * 1000 : (b.created || Date.now());
                  return ta - tb;
                });
                return all.map((msg, i) => {
                  const isGroupChat = activeChat?.isGroup;
                  const isOwnMessage = msg.senderEmail === userData.email;
                  const senderUser = usersByEmail[msg.senderEmail?.toLowerCase()];
                  const senderName = senderUser?.name || (msg.senderEmail || '').split('@')[0];
                  const senderPhoto = senderUser?.photoURL || null;
                  return (
                    <div key={msg.id || msg.tempId || i} ref={el => messagesRefs.current[i] = el} className={`flex w-full px-4 md:px-8 gap-2 relative z-10 ${!msg.id && msg.tempId ? 'animate-msg-in' : ''} ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
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
                              <p className={`text-[14px] mt-2 ${msg.senderEmail === userData.email ? 'text-white' : (darkMode ? 'text-white' : 'text-slate-900')}`}>{highlightText(msg.text)}</p>
                            ) : (
                              <p className="text-[15px] font-medium leading-relaxed">{highlightText(msg.text)}</p>
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
                });
              })()}
              <div ref={messagesEndRef} />
            </div>

            <div className={`px-2 md:px-8 py-2 md:py-4 pb-4 md:pb-8 relative z-10 safe-p-bottom w-full ${darkMode ? 'bg-[#0a0f1e]' : 'bg-[#F8FAFC]'}`}>
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
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2">
                          <button onClick={() => {
                            try { att.previewUrl && URL.revokeObjectURL(att.previewUrl); } catch (e) { }
                            setPendingAttachments(prev => prev.filter((_, i) => i !== idx));
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
              <div className={`max-w-4xl mx-auto rounded-[30px] shadow-lg flex items-center gap-1 md:gap-2 p-1 md:p-2 px-2 md:px-4 relative transition-all duration-200 ${darkMode ? 'bg-[#111827] border border-white/5' : 'bg-white border border-slate-100'} ${isRecording ? 'ring-4 ring-[#00337C]/30' : ''}`}>
                {isRecording && (
                  <div className="absolute -top-10 left-6 flex items-center gap-2 transition-all duration-200 ease-out">
                    <span className="w-2 h-2 bg-[#00337C] rounded-full animate-pulse" />
                    <p className="text-xs font-black" style={{ color: '#00337C' }}>Recording…</p>
                  </div>
                )}
                <input type="file" ref={chatFileInputRef} hidden multiple onChange={handleChatFileUpload} />
                <button onClick={() => chatFileInputRef.current.click()} className="p-0.5 md:p-3 text-slate-400 hover:text-blue-400 shrink-0"><Paperclip size={isMobile ? 14 : 20} /></button>
                <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-0.5 md:p-3 text-slate-400 hover:text-blue-400 shrink-0"><Smile size={isMobile ? 14 : 20} /></button>
                <button onClick={() => isRecording ? stopRecording() : startRecording()} className={`p-0.5 md:p-3 shrink-0 ${isRecording ? 'text-red-400' : 'text-slate-400'} hover:text-blue-400`} title={isRecording ? 'Stop recording' : 'Start recording'}>
                  <Mic size={isMobile ? 14 : 20} />
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
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center select-none safe-px">
            <img src={darkMode ? ASSETS.logoNameWhite : ASSETS.logoNameNavy} alt="Cove Logo" className="w-[280px] mb-6 opacity-15 transition-all duration-500" />
            <p className={`text-sm font-bold uppercase tracking-[0.3em] opacity-15 ${darkMode ? 'text-blue-300' : 'text-slate-500'}`}>Select a conversation to start messaging</p>
          </div>
        )}
      </div>

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
                const memberUser = usersByEmail[email.toLowerCase()];
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
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-2xl z-[100] animate-bounce-subtle flex items-center gap-3 border ${darkMode ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-100 text-slate-900'}`}>
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