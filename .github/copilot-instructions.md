<!-- copilot-instructions.md — concise, actionable guidance for AI coding agents working on Cove PWA -->
# Cove PWA — Copilot Instructions

Purpose
- Help an AI agent be productive quickly: architecture, conventions, data flows, and edit hotspots.

Big picture
- Single Next.js client-heavy app (see `pages/index.js`). There is no server API layer in this repo — Firebase is the backend.
- Firebase services used: Authentication and Firestore. Realtime updates are implemented with `onSnapshot` listeners.
- File uploads use Cloudinary (constants at the top of `pages/index.js`). UI built with Tailwind + `lucide-react` icons.

Key files to inspect first
- `pages/index.js` — the entire app lives here (UI + Firebase logic + listeners). Changes to behavior usually go here.
- `pages/_app.js` — global CSS import; minimal wrapper.
- `package.json` — dev/start/build scripts: `npm run dev`, `npm run build`, `npm start`.
- `styles/globals.css`, `tailwind.config.js`, `postcss.config.js` — styling pipeline.

Data model & flows (discoverable from code)
- Collections: `users`, `contacts`, `pending_requests`.
- Messages are a subcollection: `contacts/{contactId}/messages`.
- Common operations:
  - Create chat: `addDoc(collection(db, 'contacts'), { participants, lastMessage, timestamp: serverTimestamp() })`
  - Listen to chats/messages: `onSnapshot(query(...), callback)` inside `useEffect`.
  - Send message: `addDoc(collection(db, 'contacts', id, 'messages'), msgData)` then `updateDoc` the parent contact.
  - Batched delete: uses `writeBatch` when deleting all messages for a contact (see `deleteChat`).

Project-specific conventions & gotchas
- The app uses a client-side-only flow: Firebase config is currently embedded in `pages/index.js` (not in env). Be cautious when changing credentials.
- Auth uses a hard-coded dummy password (`DUMMY_PW`) and attempts sign-in then creates the user if not found. Look for `handleAuth`.
- Cloudinary upload presets are constants: `CLOUD_NAME`, `UPLOAD_PRESET`, `CLOUDINARY_URL` at top of `pages/index.js` — change there when switching accounts.
- UI and state are colocated in `pages/index.js` (React hooks + many local states). Prefer small, focused edits rather than large refactors unless splitting into components.
- `@google/generative-ai` is a dependency in `package.json` but unused in the current codebase — use caution before removing or integrating.

Development workflows
- Start dev server: `npm run dev` (Next.js dev mode).
- Build for production: `npm run build` then `npm start`.
- Lint: `npm run lint` (uses `eslint` / `eslint-config-next`).
- Debugging: open browser devtools and Firebase Console (projectId: `cove-chat` in code) to inspect Firestore and auth state.

Editing guidance & examples
- To add a new realtime listener: mimic existing `useEffect` that calls `onSnapshot` and return the unsubscribe function.
  Example pattern: `useEffect(() => { const unsub = onSnapshot(query(...), setState); return unsub; }, [deps]);`
- To send a message programmatically: call the same sequence as `sendMessage` — `addDoc` to messages subcollection + `updateDoc` on parent contact.
- To add a new UI control that triggers Firestore writes, follow the existing error-handling style: try/catch and console.error.

Integration points
- Firebase (client SDK): initialized in `pages/index.js` with `initializeApp`.
- Cloudinary: uploads via unsigned preset to `https://api.cloudinary.com/v1_1/<CLOUD_NAME>/auto/upload`.
- Icons: `lucide-react` for UI icons.

What to avoid / be careful about
- Don't assume a server-side API exists; changes that require secrets or server logic should be implemented via Cloud Functions or moved out of client code.
- Avoid changing Firebase config in-place without updating environment management; the current code exposes keys in source.

If you need more context
- Open `pages/index.js` and search for the following functions to find canonical patterns: `handleAuth`, `sendMessage`, `deleteChat`, `handleProfileUpdate`, `handleChatFileUpload`.

Next step for me
- I can merge or refine these instructions if you want more examples or prefer the secrets moved to environment variables — tell me which parts to expand.

---
Please review and tell me which areas need more detail or examples.
