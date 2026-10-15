import { useEffect, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';

/** Pages are drawn this wide (in pixels), enough to stay sharp when zoomed in a little. */
const PAGE_PX = 2200;

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;

/** Loads pdf.js only when the rulebook is opened. */
async function openPdf(url: string) {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  // The whole file in one request, so the offline copy is the same file.
  return pdfjs.getDocument({ url, disableRange: true, disableStream: true });
}

/**
 * The rulebook inside the app, over whatever was showing, with a way back:
 * an installed app has no browser controls to leave a PDF opened on its own.
 * Pages are drawn as you scroll near them and let go when far away, to keep
 * phone memory down. Pinch or double-tap to zoom.
 */
export function Rulebook({ url, onClose }: { url: string; onClose: () => void }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [ratios, setRatios] = useState<number[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const task = openPdf(url);
    task
      .then((t) => t.promise)
      .then(async (d) => {
        // Each page's shape, so the scroll is laid out before any page is drawn.
        const shapes = await Promise.all(
          Array.from({ length: d.numPages }, async (_, i) => {
            const vp = (await d.getPage(i + 1)).getViewport({ scale: 1 });
            return vp.height / vp.width;
          }),
        );
        if (cancelled) return;
        setRatios(shapes);
        setDoc(d);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      void task.then((t) => t.destroy());
    };
  }, [url]);

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
      {error ? (
        <p className="rulebook-status">The rulebook couldn't be opened. It needs a connection the first time.</p>
      ) : !doc ? (
        <p className="rulebook-status">Opening the rulebook…</p>
      ) : (
        <TransformWrapper
          minScale={1}
          maxScale={4}
          doubleClick={{ mode: 'toggle', step: 1.5 }}
          // A mouse wheel or trackpad scrolls the pages (ctrl/pinch zooms), like a document.
          wheel={{ activationKeys: ['Control'] }}
          trackPadPanning={{ disabled: false }}
          panning={{ velocityDisabled: false }}
          limitToBounds
        >
          <TransformComponent wrapperClass="rulebook-viewport" contentClass="rulebook-pages">
            {ratios.map((r, i) => (
              <Page key={i} doc={doc} n={i + 1} ratio={r} />
            ))}
          </TransformComponent>
        </TransformWrapper>
      )}
    </div>
  );
}

/** One page: drawn to an image while it's on or near the screen. */
function Page({ doc, n, ratio }: { doc: PdfDoc; n: number; ratio: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(!!e?.isIntersecting), { rootMargin: '150% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let made: string | null = null;
    (async () => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PAGE_PX / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      canvas.width = canvas.height = 0;
      if (!blob || cancelled) return;
      made = URL.createObjectURL(blob);
      setSrc(made);
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [near, doc, n]);

  return (
    <div ref={ref} className="rulebook-page" style={{ aspectRatio: `1 / ${ratio}` }}>
      {src ? <img src={src} alt={`Rulebook page ${n}`} draggable={false} /> : <span className="rulebook-page-num">{n}</span>}
    </div>
  );
}
