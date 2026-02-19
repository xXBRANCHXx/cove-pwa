import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, addDoc, query, orderBy, serverTimestamp, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { Send, X, User, Sparkles, MessageSquare, PlusCircle, Settings, Check, Trash2, Clock, Moon, Sun } from 'lucide-react';

const firebaseConfig = {
  apiKey: "AIzaSyBEBpmZXx-wV_Y-Y7pBH3eUfjrjD95VVrA",
  authDomain: "cove-chat.firebaseapp.com",
  projectId: "cove-chat",
  storageBucket: "cove-chat.firebasestorage.app",
  messagingSenderId: "362797536309",
  appId: "1:362797536309:web:c43a36a5a080acd5290d7c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const CoveLogo = ({ className }) => (
  <svg viewBox="0 0 100 100" className={className} fill="none">
    <rect x="10" y="10" width="80" height="80" rx="28" className="fill-[#00337C]" />
    <path d="M68 35C62 28 48 28 40 35C32 42 32 58 40 65C48 72 62 72 68 65" stroke="white" strokeWidth="6" strokeLinecap="round" />
    <circle cx="56" cy="50" r="4" fill="white" />
  </svg>
);

export default function App() {
  const [view, setView] = useState('chats');
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState({});
  const [activeChat, setActiveChat] = useState(null);
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [aiMessages, setAiMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showIdentity, setShowIdentity] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [identity, setIdentity] = useState({ name: '', email: '' });
  const [darkMode, setDarkMode] = useState(false);
  const messagesEndRef = useRef(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, aiMessages]);

  // Initialize auth
  useEffect(() => {
    signInAnonymously(auth);
    onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          snap.exists() ? setUserData(snap.data()) : setShowIdentity(true);
        } catch (e) {
          console.error('Auth error:', e);
        }
      }
    });
  }, []);

  // Load chats
  useEffect(() => {
    if (!user || !userData.email) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'contacts'), orderBy('timestamp', 'desc')),
      (snap) => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const filtered = all.filter(c => c.fromId === user.uid || c.toEmail === userData.email);
        setChats(filtered);
      },
      (error) => console.error('Chats error:', error)
    );
    return unsubscribe;
  }, [user, userData.email]);

  // Load messages for active chat
  useEffect(() => {
    if (!user || !activeChat) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'contacts', activeChat.id, 'messages'), orderBy('timestamp', 'asc')),
      (snap) => {
        setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      (error) => console.error('Messages error:', error)
    );
    return unsubscribe;
  }, [user, activeChat]);

  // Load AI messages
  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'ai_messages'), orderBy('timestamp', 'asc')),
      (snap) => {
        setAiMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      (error) => console.error('AI messages error:', error)
    );
    return unsubscribe;
  }, [user]);

  const send = async () => {
    const text = messageInput.trim();
    if (!text || !user) return;
    setMessageInput("");

    // AI mode
    if (view === 'ai') {
      try {
        await addDoc(collection(db, 'ai_messages'), {
          role: 'user',
          text,
          uid: user.uid,
          timestamp: serverTimestamp()
        });

        setAiLoading(true);
        const token = await user.getIdToken();
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ prompt: text })
        });

        if (!res.ok) throw new Error('API error');
        const data = await res.json();

        await addDoc(collection(db, 'ai_messages'), {
          role: 'assistant',
          text: data.text,
          uid: 'system',
          timestamp: serverTimestamp()
        });
      } catch (e) {
        setError('AI Error: ' + e.message);
      } finally {
        setAiLoading(false);
      }
      return;
    }

    // Chat mode
    if (!activeChat) return;
    if (activeChat.status === 'pending' && activeChat.toEmail !== userData.email) return;

    try {
      await addDoc(collection(db, 'contacts', activeChat.id, 'messages'), {
        text,
        senderId: user.uid,
        senderName: userData.name,
        timestamp: serverTimestamp()
      });
      await updateDoc(doc(db, 'contacts', activeChat.id), {
        lastMessage: text,
        timestamp: serverTimestamp()
      });
    } catch (e) {
      setError('Send error: ' + e.message);
    }
  };

  const saveIdentity = async () => {
    if (!identity.name || !identity.email) return;
    try {
      await setDoc(doc(db, 'users', user.uid), {
        name: identity.name,
        email: identity.email.toLowerCase(),
        uid: user.uid
      });
      setUserData({ name: identity.name, email: identity.email.toLowerCase(), uid: user.uid });
      setShowIdentity(false);
    } catch (e) {
      setError('Setup error: ' + e.message);
    }
  };

  const sendInvite = async () => {
    if (!inviteEmail) return;
    try {
      await addDoc(collection(db, 'contacts'), {
        fromId: user.uid,
        fromName: userData.name,
        fromEmail: userData.email,
        toEmail: inviteEmail.toLowerCase(),
        status: 'pending',
        timestamp: serverTimestamp(),
        lastMessage: 'Invitation sent'
      });
      setShowInvite(false);
      setInviteEmail("");
    } catch (e) {
      setError('Invite error: ' + e.message);
    }
  };

  const acceptContact = async (contactId) => {
    try {
      await updateDoc(doc(db, 'contacts', contactId), { status: 'accepted' });
    } catch (e) {
      setError('Error: ' + e.message);
    }
  };

  const removeContact = async (contactId) => {
    try {
      await deleteDoc(doc(db, 'contacts', contactId));
      setActiveChat(null);
    } catch (e) {
      setError('Error: ' + e.message);
    }
  };

  const bgClass = darkMode ? 'bg-slate-900 text-white' : 'bg-white text-slate-900';
  const borderClass = darkMode ? 'border-slate-700' : 'border-slate-200';
  const hoverClass = darkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-50';
  const inputClass = darkMode ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-900';

  return (
    <div className={`flex h-screen ${bgClass} overflow-hidden`}>
      {/* Sidebar */}
      <div className={`w-80 flex flex-col border-r ${borderClass}`}>
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CoveLogo className="w-8 h-8" />
            <h1 className="text-xl font-bold">Cove</h1>
          </div>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={`p-2 rounded-lg ${darkMode ? 'bg-slate-800' : 'bg-slate-100'}`}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${borderClass}`}>
          {[
            { id: 'chats', label: 'Messages', icon: MessageSquare },
            { id: 'ai', label: 'AI', icon: Sparkles },
            { id: 'settings', label: 'Settings', icon: Settings }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={`flex-1 py-3 px-4 flex items-center justify-center gap-2 font-medium transition-colors ${
                view === tab.id
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-slate-500'
              }`}
            >
              <tab.icon size={18} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {view === 'chats' && (
            <>
              <button
                onClick={() => setShowInvite(true)}
                className={`w-full py-3 px-4 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 flex items-center justify-center gap-2`}
              >
                <PlusCircle size={18} />
                New Chat
              </button>

              {chats.length === 0 ? (
                <p className="text-center text-slate-400 mt-8">No chats yet</p>
              ) : (
                chats.map(chat => {
                  const isOutgoing = chat.fromId === user.uid;
                  const name = isOutgoing ? chat.toEmail : chat.fromName;
                  const isPending = chat.status === 'pending';

                  return (
                    <div
                      key={chat.id}
                      onClick={() => setActiveChat(chat)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        activeChat?.id === chat.id
                          ? darkMode ? 'bg-slate-700' : 'bg-blue-50'
                          : hoverClass
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate text-sm">{name}</p>
                          <p className="text-xs text-slate-400 truncate">{chat.lastMessage}</p>
                        </div>
                        {isPending && <Clock size={14} className="text-amber-500 ml-2" />}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}

          {view === 'ai' && (
            <div className="space-y-3">
              {aiMessages.length === 0 ? (
                <p className="text-center text-slate-400 mt-8">Start a conversation with AI</p>
              ) : (
                aiMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-xs px-4 py-2 rounded-lg text-sm ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-none'
                          : darkMode ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-900'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
              {aiLoading && <p className="text-xs text-slate-400 animate-pulse">Thinking...</p>}
              <div ref={messagesEndRef} />
            </div>
          )}

          {view === 'settings' && (
            <div className="space-y-4 p-4">
              <div>
                <p className="text-xs text-slate-400 uppercase">Name</p>
                <p className="font-semibold text-lg">{userData.name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase">Email</p>
                <p className="font-semibold text-lg">{userData.email}</p>
              </div>
              <button
                onClick={() => {
                  setUserData({});
                  setShowIdentity(true);
                }}
                className="w-full mt-8 py-2 px-4 bg-slate-200 dark:bg-slate-700 rounded-lg text-sm font-medium"
              >
                Change Identity
              </button>
            </div>
          )}
        </div>

        {/* Input */}
        {(view === 'chats' || view === 'ai') && (
          <div className={`p-3 border-t ${borderClass}`}>
            <div className="flex gap-2">
              <input
                type="text"
                value={messageInput}
                onChange={e => setMessageInput(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && send()}
                placeholder="Message..."
                className={`flex-1 px-4 py-2 rounded-lg outline-none border-0 text-sm ${inputClass}`}
              />
              <button
                onClick={send}
                disabled={!messageInput.trim() || aiLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold disabled:opacity-50"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Chat View */}
      {activeChat && view === 'chats' && (
        <div className={`flex-1 flex flex-col border-l ${borderClass}`}>
          {/* Chat Header */}
          <div className={`p-4 border-b ${borderClass} flex items-center justify-between`}>
            <div>
              <p className="font-semibold">{activeChat.fromId === user.uid ? activeChat.toEmail : activeChat.fromName}</p>
              <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                {activeChat.status === 'pending' ? '⏳ Pending' : '✓ Connected'}
              </p>
            </div>
            <div className="flex gap-2">
              {activeChat.status === 'pending' && activeChat.toEmail === userData.email && (
                <>
                  <button
                    onClick={() => acceptContact(activeChat.id)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-bold"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => removeContact(activeChat.id)}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold"
                  >
                    Ignore
                  </button>
                </>
              )}
              {activeChat.status === 'accepted' && (
                <button
                  onClick={() => removeContact(activeChat.id)}
                  className={`p-2 ${darkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-100'} rounded-lg`}
                >
                  <Trash2 size={18} className="text-red-500" />
                </button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && activeChat.status === 'accepted' && (
              <p className="text-center text-slate-400 mt-8">No messages yet. Start the conversation!</p>
            )}
            {messages.length === 0 && activeChat.status === 'pending' && activeChat.toEmail !== userData.email && (
              <p className="text-center text-slate-400 mt-8">Waiting for {activeChat.toEmail} to accept...</p>
            )}
            {messages.length === 0 && activeChat.status === 'pending' && activeChat.toEmail === userData.email && (
              <p className="text-center text-slate-400 mt-8">Accept the invitation to start messaging!</p>
            )}

            {messages.map((msg, i) => {
              const isMe = msg.senderId === user.uid;
              return (
                <div key={i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-md px-4 py-2 rounded-lg ${
                    isMe
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : darkMode ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-900'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Modals */}
      {showIdentity && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`${bgClass} p-8 rounded-2xl w-96 space-y-4`}>
            <h2 className="text-2xl font-bold">Welcome to Cove</h2>
            <input
              placeholder="Your Name"
              value={identity.name}
              onChange={e => setIdentity({ ...identity, name: e.target.value })}
              className={`w-full px-4 py-2 rounded-lg outline-none border-0 ${inputClass}`}
            />
            <input
              type="email"
              placeholder="Your Email"
              value={identity.email}
              onChange={e => setIdentity({ ...identity, email: e.target.value })}
              className={`w-full px-4 py-2 rounded-lg outline-none border-0 ${inputClass}`}
            />
            <button
              onClick={saveIdentity}
              disabled={!identity.name || !identity.email}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-bold disabled:opacity-50"
            >
              Get Started
            </button>
          </div>
        </div>
      )}

      {showInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`${bgClass} p-8 rounded-2xl w-96 space-y-4`}>
            <h2 className="text-2xl font-bold">Invite Friend</h2>
            <input
              type="email"
              placeholder="friend@example.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              className={`w-full px-4 py-2 rounded-lg outline-none border-0 ${inputClass}`}
            />
            <div className="flex gap-2">
              <button
                onClick={sendInvite}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-bold"
              >
                Send Invite
              </button>
              <button
                onClick={() => {
                  setShowInvite(false);
                  setInviteEmail("");
                }}
                className={`flex-1 px-4 py-3 ${darkMode ? 'bg-slate-700' : 'bg-slate-200'} rounded-lg font-bold`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white px-6 py-4 rounded-lg flex items-center gap-2 z-50">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}