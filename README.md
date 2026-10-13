# Brass

A browser version of *Brass: Birmingham*, built to work on phones, to play against bots, and to support online multiplayer later.

## Layout

```
packages/engine   Pure TypeScript game logic. No UI, no DOM, no dependencies.
apps/web          Vite + React client. SVG board, pinch-zoom, bot Web Worker.
docs/             Rules transcription checklist and design notes.
```

Planned: `apps/server`, a small WebSocket server that runs the same engine.

## Architecture

All game logic goes through the kernel in `packages/engine/src/kernel.ts`. A game is a `GameDefinition`:

| Function | Purpose |
|---|---|
| `setup(config, rng)` | Initial state. All shuffling uses the seeded `rng`. |
| `activePlayers(state)` | Who may act now. |
| `legalActions(state, player)` | Drives the UI (what to highlight) and bots. |
| `validate(state, player, action)` | `null` if legal, otherwise the reason. |
| `apply(state, player, action, rng)` | Next state. Receives a private copy, so it may mutate. |
| `viewFor(state, player)` | What that seat may see. Hides other hands and the deck order. |
| `outcome(state)` | Final ranking once the game is over. |

The kernel handles the rest:

- `createMatch` / `act` give immutable, validated transitions.
- A `Match` is plain JSON (`config`, `seed`, `rngState`, `state`, `log`), so it can be saved, sent over the network, or stored in a database.
- `replay` / `undo` rebuild any point in a match from its seed and action log, which also lets you reproduce bugs.
- Bots get only `{ view, legalActions }`, the same information a human in that seat has, and run in a Web Worker (`apps/web/src/bot`).

Multiplayer later means running `act` on a server and sending each client its own `viewFor`. No rules code needs to change.

## Development

```sh
pnpm install
pnpm dev         # web app on http://localhost:5173 (also exposed on LAN for phone testing)
pnpm test        # engine tests
pnpm typecheck
pnpm build
```
