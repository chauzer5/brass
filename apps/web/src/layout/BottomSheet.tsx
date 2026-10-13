import { useState, type ReactNode } from 'react';

/**
 * Collapsible panel pinned to the bottom of the screen. On phones this holds
 * the hand and the step-by-step action picker so the board keeps the rest of
 * the screen; on wide screens it becomes a side panel (see styles.css).
 */
export function BottomSheet({ title, children }: { title: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="sheet" data-open={open}>
      <button className="sheet-handle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="sheet-grip" aria-hidden />
        <span className="sheet-title">{title}</span>
      </button>
      <div className="sheet-body">{children}</div>
    </section>
  );
}
