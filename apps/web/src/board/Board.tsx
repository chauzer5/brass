import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';

/**
 * Board canvas: an SVG in fixed map coordinates, wrapped in pinch-zoom/pan.
 * Locations, links and slots will be rendered from the engine's map data as
 * individual SVG elements so each can be tapped and highlighted.
 */
export const BOARD_WIDTH = 1000;
export const BOARD_HEIGHT = 1000;

export function Board() {
  return (
    <TransformWrapper minScale={1} maxScale={5} doubleClick={{ mode: 'zoomIn' }} centerOnInit>
      <TransformComponent wrapperClass="board-viewport" contentClass="board-content">
        <svg
          className="board-svg"
          viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
          role="img"
          aria-label="Game board"
        >
          <defs>
            <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" className="board-grid" />
            </pattern>
          </defs>
          <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} className="board-bg" />
          <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="url(#grid)" />
          <text x={BOARD_WIDTH / 2} y={BOARD_HEIGHT / 2} className="board-placeholder">
            Map goes here
          </text>
        </svg>
      </TransformComponent>
    </TransformWrapper>
  );
}
