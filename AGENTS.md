# Agent instructions

## Project

Bylina: Darkness of Koschei is a browser/PWA turn-based tactical game with a campaign layer, training, quick match, PvP, replays, and Russian/English localization. The repository is a TypeScript pnpm monorepo; the runnable workspace is `app/`, while the normative project documentation is in `doc/`.

The tactical rules run only on the host. UI and rendering display snapshots/events and send commands; they must not mutate game state directly. Treat these as hard invariants, not implementation preferences.

## Stack and commands

- Node.js `>=20`; CI uses Node 22. The package manager is pinned to `pnpm@10.34.5` in `app/package.json`.
- TypeScript 5, React 18, Vite 6, PixiJS 8, Vitest 3, WebRTC, and `ws`.
- Run all commands below from `app/`; do not use `npm install` or add a second lockfile.
- Install: `pnpm install` (CI: `pnpm install --frozen-lockfile`).
- Full verification: `pnpm check:versions && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm build`.
- Tests: `pnpm test`; type checks: `pnpm typecheck`.
- Lint and dependency boundaries: `pnpm lint` (includes `pnpm check:boundaries`).
- Formatting: `pnpm format:check`; automatic formatting: `pnpm format`.
- Dev client: `pnpm dev` (`0.0.0.0:5173`); production preview: `pnpm build && pnpm preview` (`0.0.0.0:4173`).
- Dependency audit: `pnpm audit:deps` (high/critical findings fail; registry outages are retried and reported).

## Read first and navigate by scope

1. Read this file, then `doc/README.md` and `doc/project-map.md`.
2. Read only the subject-specific document before editing: `doc/game-rules.md` for tactics, `doc/content-schema.md` for JSON5, `doc/network-protocol.md` for transport, `doc/ui-design.md` for UI, and `doc/operations.md` for release/CI.
3. Use `doc/project-map.md` for the complete document-to-file index. Do not read every source file or every content record without a reason.
4. For a long task, keep durable progress and decisions in a task/status file rather than relying on chat compaction.

## Repository map

- `app/packages/core` — pure tactical state, grid, LOS, cover, pathfinding, combat, skills, AI, scripts, and events.
- `app/packages/campaign` — campaign state machine, ship/map progression, roster, forge, infirmary, and prologue migration.
- `app/packages/content` — Zod schemas, JSON5 parsing, and authoritative units/weapons/skills/missions/items.
- `app/packages/session` — host/guest/spectator orchestration, snapshots, modes, and command flow.
- `app/packages/net` and `app/packages/signaling` — envelopes, validation, WebRTC/local transport, and connection establishment. `app/apps/signaling-server` is relay-only and has no game rules.
- `app/packages/storage` and `app/packages/replay` — local saves/worker serialization and deterministic command-log replays.
- `app/packages/render` — PixiJS field renderer; `app/packages/ui` — React screens and controls.
- `app/packages/i18n` and `app/packages/settings` — locale catalogs and browser preferences.
- `app/apps/game-pwa` — Vite/PWA composition root; `app/scripts` — release, visual, asset, and audit checks.

## Architecture rules

- Preserve the dependency direction enforced by `app/.dependency-cruiser.cjs`: foundations (`content`, `i18n`, `settings`) → core (`core`, `campaign`, `replay`) → infrastructure (`storage`, `net`, `signaling`) → `session` → presentation (`ui`, `render`). Apps compose packages.
- Never introduce cycles or imports upward across those layers. Run `pnpm check:boundaries` after changing package imports.
- Keep `core` and `campaign` independent of React, DOM/browser globals, PixiJS, rendering, networking, and storage. Core previews are pure and must not consume RNG or mutate state.
- Add world-changing behavior through a command/internal trigger, state/snapshot representation, and display event. Follow existing event types and contracts; do not invent parallel snapshot fields.
- The host validates and applies commands. Guests send intent and consume host events/snapshots; spectators do not send commands. Visibility filtering belongs to `session`, not the transport.
- One living entity occupies exactly one grid cell. Keep terrain properties on grid tiles, not on entities; derive flank/visibility/cover facts when needed instead of persisting computed flags.

## Implementation conventions

- Search for an existing helper, command, schema, event, test, or component before creating a new one. Prefer the established pattern in the nearest package.
- Keep modules focused and reasonably small. Do not refactor unrelated code while implementing a feature or fix.
- Use strict TypeScript and existing exported types. Preserve immutability/copy boundaries around match state and snapshots.
- Put balance and authored game data in `app/packages/content/data/**/*.json5`, validated by the corresponding Zod schema; do not hard-code balance in UI or core.
- Add user-facing text to both `app/packages/i18n/locales/ru/ui.json` and `en/ui.json`, and update the manifest only when adding a locale. Use the existing `t()`/catalog pattern.
- New action art belongs in `app/apps/game-pwa/public/actions`, uses the content identifier as its filename, is mapped in `app/packages/ui/src/action-art.ts`, and is resized with `pnpm resize:action-art` when applicable.
- Comments must explain only a non-obvious why (engine quirk, workaround, business rule, or issue). Never restate code, leave commented-out code, or add unlinked speculative TODOs.
- Tests that involve real timers, sockets, workers, or animations must be deterministic: drive the outcome through the tested party's own behavior (for example, a client that does not answer pings), never by mutating internal state from outside while an async loop is running, and never by relying on a fixed `setTimeout` to "outrun" another event. Before committing such a test, run it 20+ times in a loop; CI is slower than a workstation, and a test that flakes once locally will fail regularly there.

## Versioning, generated files, and boundaries

- `app/package.json` is the sole application version source. Use `pnpm version:set patch|minor|major|X.Y.Z` from `app`; do not edit release literals by hand. Run `pnpm check:versions` afterward.
- Never commit `node_modules`, `dist`, coverage, caches, logs, `.env` files, secrets, or generated output. Do not delete tracked asset metadata or replace assets gratuitously.
- Do not change save, replay, or rules formats casually. A format/API/serialized-state change requires reading the relevant contract doc, migration/compatibility impact, and explicit review.
- Do not add dependencies, change public package exports, remove files, alter CI/deploy workflows, or change persistence/network contracts without asking first.

## Workflow and completion

- Explore first, state a short plan and affected files, then implement the smallest coherent change.
- Always run targeted tests while iterating, then the full relevant checks before declaring success. For UI work, run the build and the applicable DOM tests; if visual behavior matters, use the documented screen/audit commands.
- Before every commit, from `app/` run `pnpm format:check`. If it fails, run `pnpm format` and check again. Passing tests are not a substitute: CI runs Prettier separately and fails on wrap/trailing-newline drift that the editor does not apply.
- Update the owning `doc/*.md` contract in the same change when behavior, data, protocol, or operations changes. Keep one source of truth; link rather than duplicate.
- Keep commits small and conventional (for example, `fix(core): ...`, `feat(ui): ...`, `docs: ...`). Never force-push. Do not commit unrelated user changes.

## Definition of done

- [ ] Scope and invariants checked; no unrelated changes.
- [ ] Targeted tests and applicable typecheck/lint pass.
- [ ] `pnpm check:versions`, `pnpm test`, and `pnpm build` pass when relevant.
- [ ] Formatting and dependency boundaries pass.
- [ ] Contracts/locales/docs updated when required; no secrets or generated files added.
- [ ] Diff reviewed and commit message describes one logical change.
