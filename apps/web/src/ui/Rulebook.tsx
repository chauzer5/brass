import { useEffect, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';

/**
 * The rulebook inside the app, over whatever was showing, with a way back:
 * an installed app has no browser controls to leave a PDF opened on its own.
 * Its pages are images drawn from the PDF ahead of time (public/rulebook/),
 * each loaded as you scroll near it and let go when far away, to keep phone
 * memory down. Pinch or double-tap to zoom.
 */
export function Rulebook({ pages, onClose }: { pages: number; onClose: () => void }) {
  // Back on Escape too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="rulebook" role="dialog" aria-label="Rulebook">
      <div className="rulebook-bar">
        <button className="close" onClick={onClose} aria-label="Close the rulebook">
          ‹
        </button>
        <h2>Rulebook</h2>
      </div>
      <TransformWrapper
        minScale={1}
        maxScale={4}
        doubleClick={{ mode: 'toggle', step: 1.5 }}
        // A mouse wheel or trackpad scrolls the pages (ctrl/pinch zooms), like a document.
        wheel={{ activationKeys: ['Control'] }}
        trackPadPanning={{ disabled: false }}
        limitToBounds
      >
        <TransformComponent wrapperClass="rulebook-viewport" contentClass="rulebook-pages">
          {Array.from({ length: pages }, (_, i) => (
            <Page key={i} n={i + 1} />
          ))}
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}

/** One page: its image is only loaded while it's on or near the screen. */
function Page({ n }: { n: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(!!e?.isIntersecting), { rootMargin: '150% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="rulebook-page">
      {near ? <img src={`/rulebook/page-${n}.jpg`} alt={`Rulebook page ${n}`} draggable={false} /> : <span className="rulebook-page-num">{n}</span>}
    </div>
  );
}
