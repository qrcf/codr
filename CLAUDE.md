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
pnpm dist         # Build + package DMG with electron-builder
pnpm lint         # ESLint

# Web client (packages/web)
pnpm web:dev      # Run web client dev server (Vite, port 5174)
pnpm web:build    # Build web client (tsc + vite build)

# Deployment
pnpm deploy       # Version bump + upload DMG to Vercel Blob (tsx scripts/deploy.ts)
                  # Accepts --major, --minor, --patch flags
```

No test framework is configured — there are no tests.

## Architecture

### Three-process Electron structure (`electron-vite`)

- **Main process** (`src/main/`) — Runs the Claude Agent SDK, manages permissions, connects to relay
- **Preload** (`src/preload/index.ts`) — Exposes `window.claude` API via context bridge
- **Renderer** (`src/renderer/`) — React UI with chat interface, sidebar, tool renderers

### Monorepo packages

- **`packages/web/`** — Web client (React + Clerk auth). Implements the same `window.claude` API as the preload script but over WebSocket (`claude-ws-adapter.ts`), allowing the shared `App.tsx` to run identically on both Electron and web.
- **`@codr-works/types`** — External npm package defining shared message types (`DesktopToWebMessageType`, `WebToDesktopMessageType`, `SystemMessageType`, `ConversationStatePayload`, etc.)

The relay server is **not in this repo** — it's an external service. The desktop app connects to it as a client (`src/main/relay-client.ts`), and the relay exposes HTTP API endpoints (`/api/sessions`, `/api/docs`, `/api/docs/search`) plus WebSocket routing.

### Key design pattern: Unified `window.claude` API

Both Electron and web surfaces use the same React `App.tsx` component. The abstraction layer is `window.claude`:
- **Electron**: Preload script bridges IPC calls to the main process
- **Web**: `claude-ws-adapter.ts` bridges WebSocket messages to the relay server, which forwards to the desktop's main process

### Data flow

```
User input → App.tsx → window.claude.query()
  → [Electron: IPC | Web: WebSocket → Relay → Desktop IPC]
  → Main process agent.ts → Anthropic Claude Agent SDK
  → Streaming responses → event-broadcaster.ts
  → [IPC to renderer] + [Relay to web clients]
```

### Event broadcaster (`src/main/event-broadcaster.ts`)

Dual-destination routing: every event goes to both the Electron renderer (IPC) and the relay server (WebSocket). Tracks per-session state including streaming text/thinking/tools, token usage, permission requests, and plan review state. Maps IPC channel names to WebSocket message types (e.g., `agent:message` → `agent_message`).

### Permission system (`src/main/permissions.ts`)

- **Read-only tools** auto-approved: Read, Glob, Grep, WebSearch, WebFetch, TodoWrite, Agent, EnterPlanMode
- **Edit tools** (Edit, Write, NotebookEdit) gated behind `autoApproveEdits` setting
- **Bash commands**: read-only prefixes auto-approved, configurable whitelist (git, node, pnpm, etc.), unknown commands prompt the user
- **AskUserQuestion**: special tool that prompts user and returns `{ answers }` to the SDK
- **Remote security**: `trustRemotePermissions` controls whether remote permission responses are honored; `remoteQueryPolicy` (`full` | `ask-all` | `ask-mode`) controls what remote clients can do; security-critical settings cannot be changed from remote origins

### Docs feature (`src/main/docs/`)

Users can add documentation sources (URLs). The crawler respects robots.txt, converts HTML to Markdown (turndown), and chunks content for storage on the relay. Prompts containing `@docs:SourceName` trigger a search against the relay's `/api/docs/search` endpoint, and results are injected as `<documentation_context>` XML before the prompt.

### Auth

Clerk handles authentication across all surfaces. Desktop uses deep link protocol (`codr://auth/callback`) to receive OAuth tokens from the browser. The relay server verifies Clerk JWTs before routing messages.

### Session management (`src/main/sessions.ts`)

Sessions are stored by the Claude Agent SDK on disk. Titles are generated asynchronously using claude-haiku and stored in the relay database via `PUT /api/sessions/:sessionId`. `listSessionsData()` merges local SDK sessions with relay metadata.

### TypeScript config

Root `tsconfig.json` is a project-references setup with four configs: `tsconfig.main.json`, `tsconfig.preload.json`, `tsconfig.renderer.json`, `tsconfig.node.json`.

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
BLOB_READ_WRITE_TOKEN           # Vercel Blob for release uploads
```
