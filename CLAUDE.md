# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Codr is an Electron desktop app that provides a chat UI for interacting with the Claude Agent SDK. It has a companion web client that connects to the desktop app via a WebSocket relay server, enabling remote access to the same agent session.

## Commands

```bash
# Install dependencies (pnpm monorepo)
pnpm install

# Electron app
pnpm dev          # Run Electron app in dev mode with HMR
pnpm build        # Build Electron app
pnpm dist         # Build + package with electron-builder
pnpm lint         # ESLint

# Relay server (packages/relay)
pnpm relay:dev    # Run relay server in dev mode (tsx watch, port 8080)
pnpm relay:build  # Build relay server

# Web client (packages/web)
pnpm web:dev      # Run web client dev server
pnpm web:build    # Build web client
```

## Architecture

### Three-process Electron structure (`electron-vite`)

- **Main process** (`src/main/`) — Electron main, runs the Claude Agent SDK, manages permissions, connects to relay
- **Preload** (`src/preload/index.ts`) — Exposes `window.claude` API via context bridge
- **Renderer** (`src/renderer/`) — React UI with chat interface, sidebar, tool renderers

### Monorepo packages

- **`packages/relay/`** — WebSocket relay server (ws + Clerk auth + Neon Postgres via Drizzle ORM). Routes messages between desktop and web clients via per-user "rooms".
- **`packages/web/`** — Web client that implements the same `window.claude` API as the preload script but over WebSocket (`claude-ws-adapter.ts`), allowing the shared `App.tsx` to run identically on both Electron and web.

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

### Permission system (`src/main/permissions.ts`)

- Read-only tools (Read, Glob, Grep, etc.) are auto-approved
- Edit tools gated behind `autoApproveEdits` setting
- Bash commands use an allowlist (git, node, pnpm, etc.)
- Unknown operations prompt the user via `PermissionDialog`

### Auth

Clerk handles authentication across all surfaces. Desktop uses deep link protocol (`codr://auth/callback`) to receive OAuth tokens from the browser. The relay server verifies Clerk JWTs before routing messages.

### TypeScript config

Root `tsconfig.json` is a project-references setup with four configs: `tsconfig.main.json`, `tsconfig.preload.json`, `tsconfig.renderer.json`, `tsconfig.node.json`.

## Environment

- Node 22 (see `.nvmrc`)
- pnpm workspace monorepo
- `.env` file at root (gitignored) — contains Clerk keys and relay config
