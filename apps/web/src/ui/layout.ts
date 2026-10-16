import { useEffect, useState } from 'react';

/**
 * Big screens (a computer, or a tablet held sideways) get the desktop layout: the map beside a
 * sidebar with the hand and the player's board, nothing in a drawer. Phones, held either way,
 * keep the phone layout. (styles.css keys the same layout off the `wide` class this sets.)
 */
export const WIDE_QUERY = '(min-width: 1000px) and (min-height: 600px)';

export function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}
