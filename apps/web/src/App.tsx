import { Board } from './board/Board.tsx';
import { BottomSheet } from './layout/BottomSheet.tsx';

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Brass</span>
        <span className="topbar-status">Prototype</span>
      </header>
      <main className="board-area">
        <Board />
      </main>
      <BottomSheet title="Your turn">
        <p className="muted">
          The hand and the action picker go here: choose an action, then a card, then tap one of the highlighted
          spots on the board.
        </p>
      </BottomSheet>
    </div>
  );
}
