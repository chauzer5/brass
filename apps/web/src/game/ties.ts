import { brass } from '@brass/engine';

export const joinNames = (list: readonly string[]) => (list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

/**
 * Groups of players level on VP at the end of the game, and how the rulebook settles each (p.7): the
 * higher income level, then more money; players level on all three share the place.
 */
export function tieBreaks(players: readonly brass.PlayerView[], order: readonly { id: number; rank: number }[], names: readonly string[]) {
  const groups = new Map<number, number[]>();
  for (const { id } of order) groups.set(players[id]!.vp, [...(groups.get(players[id]!.vp) ?? []), id]);
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([vp, ids]) => {
      const income = (id: number) => brass.incomeLevel(players[id]!.incomeSpace);
      const money = (id: number) => players[id]!.money;
      const rankOf = (id: number) => order.find((o) => o.id === id)!.rank;
      const pairs = ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b] as const));
      // Money only comes into it between players also level on income; a place is shared when level on all three.
      const usedMoney = pairs.some(([a, b]) => income(a) === income(b));
      const shared = pairs.some(([a, b]) => income(a) === income(b) && money(a) === money(b));
      const who = joinNames(ids.map((id) => names[id]!));
      let text: string;
      if (ids.length === 2) {
        const first = [...ids].sort((a, b) => rankOf(a) - rankOf(b))[0]!;
        text = shared
          ? `${who} are level on ${vp} VP, income and money, so they share ${rankOf(first) === 1 ? 'the win' : 'the place'}.`
          : `${who} tied on ${vp} VP: ${names[first]} ${rankOf(first) === 1 ? 'wins' : 'places higher'} on ${usedMoney ? 'money (income was level too)' : 'income'}.`;
      } else {
        text = `${who} tied on ${vp} VP: placed by income${usedMoney ? ', then money' : ''}${shared ? '; those level on all three share a place' : ''}.`;
      }
      return { ids, usedMoney, text };
    });
}
