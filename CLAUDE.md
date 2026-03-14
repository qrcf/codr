# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Codr is an Electron desktop app that provides a chat UI for interacting with the Claude Agent SDK. It has a companion web client (`packages/web/`) that connects to the desktop app via an external WebSocket relay server, enabling remote access to the same agent session.

## Commands

```bash
# Install dependencies (pnpm monorepo)
pnpm install

# Electron app
pnpm dev          # Run Electron app in dev mode with HMR
pnpm build        # Build Electron app (electron-vite)
pnpm start        # Preview built Electron app (electron-vite preview)
pnpm lint         # ESLint

# Build + package locally (downloads uv, runs electron-vite build + electron-builder)
pnpm dist

# Build, package, version bump, and publish to GitHub Releases
pnpm deploy --upload              # patch bump (default)
pnpm deploy --upload --minor      # minor bump
pnpm deploy --upload --major      # major bump

# Web client (packages/web)
pnpm web:dev      # Run web client dev server (Vite, port 5174)
pnpm web:build    # Build web client (tsc + vite build)
```

No test framework is configured. `src/main/runtime/session-records.ts` has a small test using Node's built-in `node:test` module.

## Project Structure

```
codr/
├── CLAUDE.md
├── package.json                      # Root monorepo package
├── pnpm-workspace.yaml               # Workspace: packages/*
├── .nvmrc                            # Node 22
├── .env / .env.prod                  # Dev / production env vars (gitignored)
├── electron.vite.config.ts           # electron-vite: main + preload + renderer builds
├── electron-builder.yml              # Electron Builder: macOS targets, signing, notarization, GitHub Releases
├── tsconfig.json                     # Project references root
├── tsconfig.main.json                # Main process (ES2022)
├── tsconfig.preload.json             # Preload (ES2022)
├── tsconfig.renderer.json            # Renderer (ES2022, JSX react-jsx)
├── tsconfig.node.json                # Build scripts (ES2023)
├── eslint.config.js                  # ESLint flat config (TS + React)
│
├── src/
│   ├── main/                         # Electron main process
│   │   ├── index.ts                  # App entry: window creation, IPC handlers, relay setup, auth
│   │   ├── agent.ts                  # Agent handler: provider orchestration, runQuery/interruptQuery
│   │   ├── permissions.ts            # Permission gate: tool approval, bash whitelist, remote security
│   │   ├── event-broadcaster.ts      # Dual-destination routing (IPC + relay), per-session state
│   │   ├── relay-client.ts           # WebSocket client to relay server, auto-reconnect
│   │   ├── sessions.ts              # Session listing, title generation, metadata merge
│   │   ├── auto-updater.ts           # electron-updater: check/install/notify
│   │   ├── window-state.ts           # Window position/size persistence
│   │   ├── types.ts                  # Shared types
│   │   │
│   │   ├── runtime/                  # Provider abstraction layer
│   │   │   ├── provider.ts           # AgentProvider interface, AgentQueryRequest, callbacks
│   │   │   ├── provider-config.ts    # Persists provider/model selection to JSON
│   │   │   ├── agent-runtime.ts      # Provider lifecycle orchestrator
│   │   │   ├── models.ts             # Model fetching & in-memory cache per provider
│   │   │   ├── session-index.ts      # SQLite DB for session metadata & raw messages
│   │   │   ├── session-records.ts    # Builds merged session list from multiple sources
│   │   │   ├── prompt-preprocessor.ts # @docs: and @file: token expansion
│   │   │   ├── codex-discovery.ts    # Reads Codex threads from ~/.codex/state_5.sqlite
│   │   │   ├── codex-rollout-parser.ts
│   │   │   └── providers/
│   │   │       ├── claude-provider.ts # @anthropic-ai/claude-agent-sdk integration
│   │   │       └── codex-provider.ts  # @openai/codex-sdk integration (dynamic import)
│   │   │
│   │   └── docs/                     # Documentation crawling & search
│   │       ├── manager.ts            # Doc source CRUD, crawl orchestration
│   │       ├── crawl4ai-bridge.ts    # Python worker IPC for HTML→Markdown crawling
│   │       ├── python-runtime.ts     # Python venv setup (uv + crawl4ai)
│   │       └── chunker.ts            # Markdown chunking for relay storage
│   │
│   ├── preload/
│   │   └── index.ts                  # Context bridge: exposes window.claude & window.agent APIs
│   │
│   └── renderer/
│       └── src/
│           ├── App.tsx               # Main orchestrator: wires hooks, handles send/interrupt/plan
│           ├── main.tsx              # Entry: AuthGate → CliGate → App
│           ├── types.ts              # ChatMessage, ToolCallInfo, ContentBlock, PlanReviewState
│           ├── index.css             # Global styles (Tailwind)
│           │
│           ├── hooks/
│           │   ├── useAgentConnection.ts  # Agent event listeners, message state, streaming
│           │   ├── useSessionManager.ts   # Active session, load/switch, project title
│           │   ├── useInputComposer.ts    # Textarea, @file/@docs mentions, drag-drop, paste
│           │   ├── useDialogs.ts          # Permissions, questions, plan review, mode state
│           │   ├── useDraftSessions.ts    # Temporary draft sessions (localStorage)
│           │   ├── useArchivedSessions.ts # Archived session IDs (localStorage)
│           │   └── useDocsAPI.ts          # Doc sources from relay API
│           │
│           ├── components/
│           │   ├── Sidebar.tsx            # Session list, project tree, provider selector
│           │   ├── ChatHeader.tsx         # Project name, session title, breadcrumb
│           │   ├── MessageList.tsx        # Message rendering with pagination
│           │   ├── InputArea.tsx          # Textarea, mode selector, model/reasoning pickers
│           │   ├── DialogsPanel.tsx       # Permission/question/plan dialog container
│           │   ├── MessageBubble.tsx      # Single message: text + grouped tool calls
│           │   ├── ToolCallBlock.tsx      # Individual tool card
│           │   ├── PermissionDialog.tsx   # Tool approval UI with diff preview
│           │   ├── QuestionDialog.tsx     # Agent question form
│           │   ├── PlanReview.tsx         # Plan approve/request changes
│           │   ├── AuthGate.tsx           # Auth check + sign-in prompt
│           │   ├── CliGate.tsx            # CLI installation check (Electron only)
│           │   ├── SettingsPanel.tsx      # Settings, docs sources, provider status
│           │   ├── ManageProjectPanel.tsx # CLAUDE.md editor
│           │   ├── SidebarProfile.tsx     # User avatar + sign out
│           │   ├── FileMentionDropdown.tsx # @file autocomplete
│           │   ├── ModelSelector.tsx      # Model dropdown
│           │   ├── ReasoningSelector.tsx  # Thinking budget: auto/low/medium/high
│           │   ├── ContextUsageBar.tsx    # Token usage visualization
│           │   ├── UpdateOverlay.tsx      # Auto-update notification
│           │   ├── CollapsibleDialog.tsx  # Collapsible panel wrapper
│           │   ├── DiffView.tsx           # Side-by-side code diff
│           │   ├── JsonHighlight.tsx      # JSON syntax highlighting
│           │   ├── AgentCard.tsx          # Nested agent card
│           │   ├── RemotePanel.tsx        # Web relay connection UI
│           │   ├── LabPanel.tsx           # Experimental features
│           │   ├── DocsPanel.tsx          # Docs sidebar
│           │   │
│           │   └── renderers/             # Tool-specific display components
│           │       ├── AgentRenderer.tsx
│           │       ├── AskUserQuestionRenderer.tsx
│           │       ├── BashRenderer.tsx
│           │       ├── EditRenderer.tsx
│           │       ├── GlobRenderer.tsx
│           │       ├── GrepRenderer.tsx
│           │       ├── ReadRenderer.tsx
│           │       ├── WriteRenderer.tsx
│           │       ├── TodoWriteRenderer.tsx
│           │       ├── PlanModeRenderer.tsx
│           │       └── PlanWriteRenderer.tsx
│           │
│           ├── toolRenderers.ts          # Registry: tool name → React component
│           │
│           └── utils/
│               ├── sessionParser.ts      # Raw JSONL → ChatMessage[] conversion
│               ├── formatMessage.ts      # Strip XML tags from system messages
│               └── timeAgo.ts            # Epoch → human-readable time
│
├── packages/
│   └── web/                          # Web client (React + Clerk + Vite)
│       ├── package.json
│       ├── tsconfig.json             # Path aliases to shared renderer components
│       ├── vite.config.ts            # Resolves @components, @utils, @app to renderer
│       ├── vercel.json               # SPA rewrites
│       ├── index.html
│       └── src/
│           ├── main.tsx              # Entry point
│           ├── AuthenticatedApp.tsx   # Clerk-authenticated wrapper
│           ├── ConnectionOverlay.tsx  # WebSocket connection status
│           ├── VersionMismatchOverlay.tsx # App version mismatch detection
│           └── claude-ws-adapter.ts  # WebSocket bridge implementing window.claude API
│
├── scripts/
│   ├── deploy.ts                     # Build, version bump, package, publish
│   └── download-uv.ts               # Download uv binary for current platform
│
├── resources/
│   ├── bin/uv                        # UV Python package manager (downloaded at build)
│   └── crawl4ai/
│       ├── worker.py                 # Python crawl worker
│       └── requirements.txt
│
├── build/
│   ├── icon.icns                     # macOS app icon
│   ├── icon.png
│   ├── entitlements.mac.plist        # macOS entitlements
│   └── entitlements.mac.inherit.plist
│
└── .github/workflows/
    └── release.yml                   # CI: build, sign, notarize, publish to GitHub Releases + Vercel
```

## Architecture

### Three-process Electron structure (`electron-vite`)

- **Main process** (`src/main/`) — Runs the Claude Agent SDK, manages permissions, connects to relay
- **Preload** (`src/preload/index.ts`) — Exposes `window.claude` API via context bridge
- **Renderer** (`src/renderer/`) — React UI with chat interface, sidebar, tool renderers

### Monorepo packages

- **`packages/web/`** — Web client (React + Clerk auth). Implements the same `window.claude` API as the preload script but over WebSocket (`claude-ws-adapter.ts`), allowing the shared `App.tsx` to run identically on both Electron and web. Path aliases in `vite.config.ts` resolve `@components`, `@utils`, `@app` to the Electron renderer source, so both surfaces share the same React components.
- **`@codr-works/types`** — External npm package defining shared message types (`DesktopToWebMessageType`, `WebToDesktopMessageType`, `SystemMessageType`, `ConversationStatePayload`, etc.)

The relay server is **not in this repo** — it's an external service. The desktop app connects to it as a client (`src/main/relay-client.ts`), and the relay exposes HTTP API endpoints (`/api/sessions`, `/api/docs`, `/api/docs/search`) plus WebSocket routing.

### Unified `window.claude` API

Both Electron and web surfaces use the same React `App.tsx` component. The abstraction layer is `window.claude`:
- **Electron**: Preload script bridges IPC calls to the main process
- **Web**: `claude-ws-adapter.ts` bridges WebSocket messages to the relay server, which forwards to the desktop's main process

### Data flow

```
User input → App.tsx → window.claude.query()
  → [Electron: IPC | Web: WebSocket → Relay → Desktop IPC]
  → Main process agent.ts → Provider (Claude SDK or Codex SDK)
  → Streaming responses → event-broadcaster.ts
  → [IPC to renderer] + [Relay to web clients]
```

### TypeScript config

Root `tsconfig.json` is a project-references setup with four configs: `tsconfig.main.json` (main process), `tsconfig.preload.json` (preload), `tsconfig.renderer.json` (renderer + JSX), `tsconfig.node.json` (build scripts).

## Main Process (`src/main/`)

### Entry point (`index.ts`)

Initializes the Electron app, creates the main window, and registers all IPC handlers. Key responsibilities:
- Auth token storage (encrypted with `safeStorage`)
- Deep link handling (`codr://auth/callback`)
- Instantiates `RelayClient` and `EventBroadcaster`
- Relay message routing (queries, permissions, requests from web clients)
- Clipboard file path reading (macOS native pasteboard)
- CLAUDE.md file I/O, plan file loading, user profile (Clerk API)

### Agent orchestration (`agent.ts`)

Exports `registerAgentHandlers()` which returns `{ runQuery, interruptQuery }`. Instantiates both `ClaudeProvider` and `CodexProvider`. The `runQuery` function resolves provider/model selection, orchestrates callbacks for session metadata, raw message indexing, and event broadcasting.

### Permission system (`permissions.ts`)

Implements the SDK's `CanUseTool` permission gate with these tiers:

1. **Auto-approved (read-only)**: Read, Glob, Grep, WebSearch, WebFetch, TodoWrite, Agent, EnterPlanMode
2. **Conditionally auto-approved**: Edit, Write, NotebookEdit (if `autoApproveEdits` enabled)
3. **Bash commands**: read-only prefixes auto-approved, configurable whitelist
4. **Everything else**: prompts the user via `EventBroadcaster`

Special tools:
- **AskUserQuestion** — intercepts and prompts user, returns `{ answers }` to SDK
- **ExitPlanMode** — triggers plan review flow

Settings structure:
```typescript
{
  autoApproveEdits: boolean       // default: false
  bashWhitelist: string[]         // default: ['ls', 'pwd', 'echo', 'git', 'node', 'pnpm', 'npm', 'npx', 'tsc']
  trustRemotePermissions: boolean // default: false
  remoteQueryPolicy: 'full' | 'ask-mode' | 'ask-all'  // default: 'ask-all'
}
```

Remote security: `trustRemotePermissions` controls whether remote permission responses are honored. Security-critical settings cannot be changed from remote origins.

### Event broadcaster (`event-broadcaster.ts`)

Dual-destination routing: every event goes to both the Electron renderer (IPC) and the relay server (WebSocket). Maps IPC channel names to WebSocket message types (e.g., `agent:message` → `agent_message`).

Tracks per-session `ConversationState`:
```typescript
{
  messages: ChatMessage[]
  isLoading: boolean
  streamingText: string
  streamingThinking: string
  streamingTools: ToolCallInfo[]
  permissionRequest: { id, tool, input } | null
  questionRequest: { id, questions } | null
  planReview: PlanReviewState | null
  querySessionId: string | null
  tokenUsage: TokenUsage | null
}
```

### Relay client (`relay-client.ts`)

WebSocket connection to the relay server with auto-reconnect (exponential backoff). Receives message types: `query`, `interrupt`, `permission_response`, `question_response`, `settings_update`, `request_state_sync`, `request`. Supports RPC-style request/response for calls like `list_sessions`, `get_account_info`.

### Session management (`sessions.ts`)

`listSessionsData()` merges sessions from three sources:
1. Claude SDK on disk (`~/.claude/projects`)
2. Relay database (`/api/sessions` endpoint)
3. Codex threads (`~/.codex/state_5.sqlite`)

Title priority: relay DB → indexed → SDK → first prompt. Titles are generated asynchronously (max 3 concurrent) using claude-haiku and stored on the relay via `PUT /api/sessions/:sessionId`. A watcher detects external session changes by checking mtimes.

### Auto-updater (`auto-updater.ts`)

Uses `electron-updater` (lazy loaded). Auto-checks every 4 hours. Sends IPC events to renderer on status change (available, downloaded, error).

### Window state (`window-state.ts`)

Persists window position, size, and maximized state to `app.getPath('userData')/window-state.json`. Debounced save on resize/move (500ms). Validates loaded state against display bounds.

### Runtime subsystem (`src/main/runtime/`)

Pluggable provider abstraction that lets the app run either Claude or Codex as the backend agent.

**Provider interface** (`provider.ts`): Defines `AgentProvider` with `runQuery(req, callbacks)` and `interrupt()`. Provider IDs: `'claude' | 'codex'`.

**Provider config** (`provider-config.ts`): Persists selected provider/model to `app.getPath('userData')/agent-runtime/provider-config.json`. Reads Claude Desktop defaults from `~/.claude/settings.json`.

**Models** (`models.ts`): For Claude, creates a probe query to discover `supportedModels()`. For Codex, reads `~/.codex/models_cache.json`. Caches results in memory per provider.

**Session index** (`session-index.ts`): SQLite database at `app.getPath('userData')/agent-runtime/sessions.db` with two tables: `sessions` (metadata) and `session_messages` (raw message snapshots). Uses write mutex for concurrency.

**Session records** (`session-records.ts`): Builds the merged session list by combining SDK, relay, indexed, and Codex sources.

**Prompt preprocessor** (`prompt-preprocessor.ts`): Parses `@docs:Name` tokens and fetches from relay `/api/docs/search`. Parses `@path/to/file` tokens and reads files locally (50KB limit). Wraps results in `<documentation_context>` and `<file_context>` XML tags.

**Claude provider** (`providers/claude-provider.ts`): Wraps `@anthropic-ai/claude-agent-sdk` query function. Creates the `CanUseTool` gate, preprocesses prompts, handles model/thinking budget config. Resolves SDK CLI path for packaged builds (`app.asar.unpacked`).

**Codex provider** (`providers/codex-provider.ts`): Dynamically imports `@openai/codex-sdk`. Maps Codex thread items (command_execution, file_change, mcp_tool_call, web_search, todo_list) to Claude SDK message format.

**Codex discovery** (`codex-discovery.ts`): Reads threads from `~/.codex/state_5.sqlite` using Node's built-in `node:sqlite` (requires Node 24+). Returns up to 100 non-archived threads.

### Docs subsystem (`src/main/docs/`)

**Manager** (`manager.ts`): CRUD for doc sources via relay API. Spawns `Crawl4AIBridge` worker for crawling, chunks markdown, uploads to relay. Broadcasts crawl progress to renderer.

**Crawl4AI bridge** (`crawl4ai-bridge.ts`): JSON IPC over stdin/stdout with a Python worker process. Streams page results during crawl.

**Python runtime** (`python-runtime.ts`): Downloads `uv`, creates isolated venv in `app.getPath('userData')/python-env`, installs Python 3.12 and crawl4ai. Writes setup marker with hash to avoid re-running.

**Chunker** (`chunker.ts`): Splits markdown into chunks for relay storage.

## Renderer (`src/renderer/`)

### App.tsx — Main orchestrator

Wires all hooks together via "bridge refs" — shared refs that let hooks communicate without direct dependencies:
- `activeSessionIdRef` — current session ID
- `awaitingNewSessionRef` — expect new session from first query
- `onSessionCapturedRef` — callback when agent assigns a session ID
- `resetInputRef` — clear input after send

Key handlers: `handleSend()` (compose prompt + @files + @docs, call `window.claude.query()`), `handleInterrupt()`, `handleCompact()`, `handlePlanApprove()`/`handlePlanRequestChanges()`.

Global keyboard: Shift+Tab cycles mode (plan → code → ask).

Render layout: `<Sidebar>` → `<ChatHeader>` → `<MessageList>` → `<DialogsPanel>` → `<InputArea>`.

### Hooks

**`useAgentConnection`** — Listens to all agent IPC events. Manages `messages`, `isLoading`, `streamingText`, `streamingThinking`, `streamingTools`, `tokenUsage`. Processes stream events (text_delta, thinking_delta, content_block_start), assistant messages, user messages (tool results), system messages (compacting). Handles session ID adoption for new queries. Supports pagination (loads 50 messages at a time).

**`useSessionManager`** — Manages `activeSessionId` (UUID or `draft-XXXXXX`), `activeSession` (SessionInfo with cwd, provider, model, thinkingBudget), `projectTitle`. Key functions: `loadSession()`, `handleNewChat()`, `handleChangeProject()`. Restores active session from localStorage on mount.

**`useInputComposer`** — Textarea state, `@file` and `@docs:` mention autocomplete, drag-drop file handling, clipboard paste (macOS Finder). Auto-resizes textarea up to 240px.

**`useDialogs`** — Permission requests, question requests, plan review state, mode state (`'plan' | 'code' | 'ask'`). Detects Write tool to `.claude/plans/` to trigger plan review. Handles ExitPlanMode with `allowedPrompts`.

**`useDraftSessions`** — Temporary localStorage-backed drafts (`draft-TIMESTAMP`). Auto-cleanup after 24 hours. Promoted to real sessions when agent assigns a UUID.

**`useArchivedSessions`** — Archive/unarchive session IDs in localStorage. Toggle visibility.

**`useDocsAPI`** — Fetches doc sources from relay API. Search, delete, list pages.

### Components

**Layout**: `Sidebar` (session list, project tree, provider selector), `ChatHeader` (project name, session title tooltip with metadata), `MessageList` (paginated messages + streaming), `InputArea` (textarea, mode/model/reasoning selectors, context bar, @mentions).

**Dialogs**: `DialogsPanel` (container), `PermissionDialog` (tool approval with diff preview for Edit), `QuestionDialog`, `PlanReview` (approve/request changes).

**Messages**: `MessageBubble` (text + grouped tool calls with summary), `ToolCallBlock` (individual tool card).

**Gates**: `AuthGate` (Clerk auth check + sign-in), `CliGate` (CLI installation check, Electron only).

**Panels**: `SettingsPanel`, `ManageProjectPanel` (CLAUDE.md editor), `RemotePanel`, `LabPanel`, `DocsPanel`.

**Tool renderers** (`components/renderers/`): Each tool has a dedicated display component. Mapped via `toolRenderers.ts` registry (tool name → React component). Tools: Agent, AskUserQuestion, Bash, Edit, Glob, Grep, Read, Write, TodoWrite, PlanMode (Enter/Exit), PlanWrite.

### Utilities

- `sessionParser.ts` — Converts raw JSONL to `ChatMessage[]`, extracts token usage and model from raw messages
- `formatMessage.ts` — Strips `<system-reminder>` blocks, formats `<command-name>` tags
- `timeAgo.ts` — Epoch to human-readable ("2m ago", "1h ago")

## Preload (`src/preload/`)

`index.ts` exposes two APIs via context bridge:

**`window.claude`** — Core agent API:
- Query: `query(prompt, opts)`, `interrupt()`, `getAgentState()`
- Provider: `getProvider()`, `setProvider()`, `getModels()`, `setModel()`, `getDefaults()`
- Events: `onMessage`, `onError`, `onDone`, `onPermissionRequest`, `onQuestionRequest`, `onStateSync`, `onTokenStored`, `onUpdateStatus`, `onSessionUpdated`, `onSessionRefreshHint`, `onRemoteStatusChange`, `onDocsCrawlProgress`
- Sessions: `listSessions()`, `getSessionMessages()`, `selectFolder()`, `getAccountInfo()`
- Settings: `updateSettings()`, `getAuthToken()`, `signOut()`, `openAuthInBrowser()`
- Docs: `addDocSource()`, `removeDocSource()`, `recrawlDocSource()`, `fetchDocTitle()`
- Files: `listFiles()`, `readClipboardFilePaths()`, `getPathForFile()`
- Project: `readClaudeMd()`, `writeClaudeMd()`, `readPlanFile()`
- Remote: `getRemoteStatus()`, `connectRemote()`, `disconnectRemote()`
- Updates: `installUpdate()`, `checkCliStatus()`, `getProviderStatus()`

All event listeners return unsubscribe functions.

## Web Package (`packages/web/`)

Standalone web client deployed to Vercel. Uses the same React components as the Electron renderer via path aliases.

**`claude-ws-adapter.ts`** — The key bridge. Implements the full `window.claude` API surface over WebSocket, translating between:
- Outbound: method calls → WebSocket messages to relay
- Inbound: relay messages → event callbacks (onMessage, onPermissionRequest, etc.)

**Entry flow**: `main.tsx` → Clerk `<ClerkProvider>` → `AuthenticatedApp.tsx` → `ConnectionOverlay` (shows WS status) → `VersionMismatchOverlay` (compares desktop/web versions) → shared `App.tsx`.

## Scripts & Build Pipeline

### `scripts/deploy.ts`

Build orchestrator: loads `.env.prod` then `.env`, handles version bumping (`--major`/`--minor`/`--patch`), runs `download-uv.ts`, `electron-vite build`, `electron-builder`. With `--upload` flag, publishes to GitHub Releases.

### `scripts/download-uv.ts`

Downloads the `uv` Python package manager binary from GitHub releases. Detects platform (macOS arm64/x64, Linux arm64/x64), extracts to `resources/bin/uv`. Skips if already present.

### `electron-builder.yml`

macOS targets: DMG + ZIP. Includes code signing, notarization, and GitHub Releases publishing. Unpacks `@anthropic-ai/claude-agent-sdk` node_modules (needed at runtime). Bundles `resources/crawl4ai/` and `resources/bin/` as extraResources.

### CI/CD (`.github/workflows/release.yml`)

Triggers on `v*` tags or manual dispatch. Runs on macOS-14:
1. Checkout → setup Node 22 + pnpm → install
2. Set version from tag/input in package.json
3. Create `.env` files from GitHub secrets
4. Download uv → build → package, sign, notarize → publish to GitHub Releases
5. Deploy web client to Vercel

## Environment

- Node 22 (see `.nvmrc`)
- pnpm workspace monorepo
- `.env` file at root (gitignored) for dev, `.env.prod` for production builds/deploy

### Required env vars

```
VITE_CLERK_PUBLISHABLE_KEY      # Clerk auth
VITE_RELAY_URL                  # WebSocket relay (ws://localhost:8080 or wss://...)
VITE_WEB_URL                    # Web client URL (used by electron.vite.config.ts as __WEB_URL__)
```

### Deploy/signing env vars

```
CSC_NAME                        # macOS code signing identity
APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD  # Notarization
```

### CI-injected env vars

```
VITE_API_URL                    # Relay HTTP API URL
GH_TOKEN                        # GitHub token for electron-builder publish
VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID  # Web deploy
```

## Key Design Patterns

### Ref-based session tracking
`useAgentConnection` reads `activeSessionIdRef.current` inside event callbacks to always have a fresh session ID, avoiding stale closures from React's effect dependency model.

### Bridge refs (App.tsx)
Multiple hooks need to share state without direct dependency. Bridge refs (`activeSessionIdRef`, `awaitingNewSessionRef`, `onSessionCapturedRef`, `resetInputRef`) wire them together at the App level.

### Draft sessions
Temporary localStorage entries (`draft-TIMESTAMP`) become real sessions once the agent assigns a UUID. On load, drafts appear in the sidebar until promoted. Auto-cleaned after 24 hours.

### Dual-stream architecture
Uses `.current` refs for fast updates + state setters for React re-renders. Example: `streamingTextRef.current` updates on every delta for immediate access, while `setStreamingText` triggers re-renders on a throttled schedule.

### Tool renderer registry
`toolRenderers` record maps tool name → React component. Dynamic lookup for extensibility — adding a new tool renderer requires only adding the component and a registry entry.

### Plan mode flow
Write tool to `.claude/plans/` triggers plan review. ExitPlanMode tool with `allowedPrompts` gates the next user input. Approve sends the plan as context; Request Changes re-enters edit mode.

### Web client compatibility
Most hooks detect missing APIs (e.g., `window.claude.checkCliStatus` only exists on Electron) and gracefully degrade. The web adapter implements the full API surface over WebSocket.

## Auth

Clerk handles authentication across all surfaces. Desktop uses deep link protocol (`codr://auth/callback`) to receive OAuth tokens from the browser. Auth tokens are encrypted with Electron's `safeStorage`. The relay server verifies Clerk JWTs before routing messages.

## Stored Data Locations

All under `app.getPath('userData')`:

```
auth-token                              # Encrypted auth token
window-state.json                       # Window position/size
agent-runtime/
  provider-config.json                  # Selected provider & model
  sessions.db                           # SQLite: session metadata + raw messages
python-env/                             # Python venv for crawl4ai
  .setup-complete                       # Setup marker with hash
```

External:
```
~/.claude/projects/                     # Claude SDK session storage
~/.claude/settings.json                 # Claude Desktop settings (effort level defaults)
~/.codex/state_5.sqlite                 # Codex threads (read-only)
~/.codex/models_cache.json              # Codex model cache (read-only)
```
