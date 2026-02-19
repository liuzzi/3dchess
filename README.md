# 3dchess

## Architecture Notes

The app is organized as a thin orchestration entrypoint plus focused gameplay/view modules:

- `src/main.ts`: composition root, lifecycle wiring, online lobby flow.
- `src/game.ts`: game state transitions, turn flow, move execution, promotion and end-state checks.
- `src/movement.ts`: move generation and legal move filtering.
- `src/board.ts`: board storage, occupancy map, reversible move simulation helpers.
- `src/renderer.ts`, `src/boardView.ts`, `src/pieceView.ts`: Three.js scene and visual state.
- `src/interaction.ts`: pointer/raycast input routing from canvas to game layer.
- `src/network.ts`, `src/onlineBridge.ts`: multiplayer transport and game event bridge.
- `src/menuController.ts`: menu/submenu interactions and mode selection.
- `src/threatPreview.ts`: threat and danger line computation utilities.
- `src/bot.ts`, `src/botWorker.ts`: bot orchestration and minimax search worker.

## Module Ownership Map

- **Core rules/state**: `src/board.ts`, `src/movement.ts`, `src/game.ts`, `src/promotion.ts`.
- **Rendering**: `src/renderer.ts`, `src/boardView.ts`, `src/pieceView.ts`.
- **Input/UI**: `src/interaction.ts`, `src/ui.ts`, `src/menuController.ts`.
- **Online/multiplayer**: `src/network.ts`, `src/onlineBridge.ts`.
- **AI**: `src/bot.ts`, `src/botWorker.ts`.

## Refactor Guarantees

Recent refactors keep gameplay behavior intact while improving internals:

- extracted menu, online bridge, and threat preview logic out of `main.ts`;
- introduced typed game events for safer event handling;
- replaced clone-heavy simulation paths with reversible apply/unapply move simulation;
- reduced per-frame allocations in raycast and hover-preview paths.

Validation gates used after each phase:

- `npm run build` (TypeScript + production build) must pass;
- no new linter issues in changed files;
- browser smoke checks for menu/lobby/render/runtime errors.
