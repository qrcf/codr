# Dual Provider Verification

This checklist defines rollout stages and runtime verification for mixed Claude/Codex support.

## Stage 1: Claude Compatibility

- Provider defaults to `claude`.
- Existing query, interrupt, permission, question, and plan flows work unchanged.
- `window.claude` and `window.agent` both work in desktop and web modes.
- Existing Claude sessions still load from SDK and/or local index.

## Stage 2: Codex Baseline

- Provider can switch to `codex` from settings.
- Codex queries run and produce assistant output in the shared UI stream.
- Codex sessions appear in session list after completion.
- App restart preserves Codex session summaries and raw messages via local index.

## Stage 3: Cross-Provider Session Behavior

- Mixed Claude and Codex sessions list correctly by recency.
- Opening historical sessions from either provider loads expected message history.
- Provider switch does not corrupt active session state.
- Relay/web clients receive the same session and state-sync behavior.

## Runtime Acceptance Checklist

- Start a new session on Claude provider.
- Resume an existing Claude session.
- Start a new session on Codex provider.
- Verify `agent:error` and `agent:done` transitions on both providers.
- Validate tool event rendering remains stable on Claude.
- Validate plan review still works for Claude plan mode.
- Reload the app and re-open the most recent session from each provider.
- Verify remote/web connection still receives session refresh hints and state sync.
