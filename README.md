# Codr

Codr is an Electron desktop app for running agent sessions in a dedicated chat UI, with optional remote access through a companion web client in `packages/web`.

This README covers the `codr` repo only. Backend and hosted relay services live outside this repository.

## What It Includes

- Electron desktop app with a React renderer
- Shared chat UI for local desktop and remote web access
- Provider runtime that can target Claude or Codex
- Session history, permissions, and tool-call rendering
- Documentation ingestion and prompt-time docs lookup via `@docs:SourceName`

## Repository Layout

```text
.
├── src/
│   ├── main/        # Electron main process, agent runtime, permissions, relay client
│   ├── preload/     # Context bridge exposing the app API to the renderer
│   └── renderer/    # React desktop UI
├── packages/
│   └── web/         # Browser client that talks to the desktop app through the relay
├── scripts/         # Release/deployment helpers
└── build/           # Packaging assets
```

## Requirements

- Node.js 22
- `pnpm`
- Access to the external relay environment used by the desktop and web clients
- Provider credentials/configuration for whichever runtime you want to use

## Getting Started

Install dependencies:

```bash
pnpm install
```

Run the desktop app in development:

```bash
pnpm dev
```

Run the companion web client:

```bash
pnpm web:dev
```

Build the desktop app:

```bash
pnpm build
```

Create a packaged desktop build:

```bash
pnpm dist
```

Lint the repo:

```bash
pnpm lint
```

## Environment

Create a local `.env` file in the repo root.

Required variables:

```bash
VITE_CLERK_PUBLISHABLE_KEY=...
VITE_RELAY_URL=ws://localhost:8080
VITE_WEB_URL=http://localhost:5174
```

Notes:

- `VITE_RELAY_URL` is the relay endpoint used for remote/web communication.
- `VITE_WEB_URL` is used by the desktop app for auth and external web flow integration.
- Production packaging and deploys also require signing/notarization and release-upload credentials.

## Common Commands

```bash
pnpm dev         # Electron app with HMR
pnpm web:dev     # Web client dev server
pnpm build       # Electron production build
pnpm web:build   # Web client production build
pnpm dist        # Package desktop app with electron-builder
pnpm deploy      # Release/deploy helper script
pnpm lint        # ESLint
```

## Architecture Overview

Codr uses the standard Electron split:

- `src/main/` runs the agent runtime, permissions, session management, docs logic, and relay integration.
- `src/preload/` exposes the desktop API to the renderer through a context bridge.
- `src/renderer/` contains the React chat UI, session list, dialogs, and tool renderers.

The web client in `packages/web` reuses the same high-level app model by implementing the same frontend-facing API over WebSocket instead of Electron IPC. That lets the desktop and web surfaces share much of the same interaction flow while targeting different transports.

### Provider Runtime

The runtime supports multiple providers:

- `claude` via the Claude Agent SDK
- `codex` via the Codex SDK

The selected provider is stored in the app's user data and can be switched without changing the UI layer.

### Docs Workflow

Users can register documentation sources, which are crawled, converted to Markdown, chunked, and made searchable. Prompts can reference a source with `@docs:SourceName` to pull matching documentation context into the request.

## Notes For Contributors

- This repo is a pnpm workspace, even though the main focus is the Electron app.
- The hosted relay/API implementation is not included here.
- There is currently no full test script configured at the root, so validation is mainly done through linting and manual runtime checks.
- Packaging is configured for macOS DMG builds via `electron-builder`.
