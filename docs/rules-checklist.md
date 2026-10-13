# Rules transcription checklist

Each rule enters the engine together with a test that cites the rulebook page it comes from (`// Rulebook p.N: "..."`). Source: the official Roxley rulebook (2018-11-20 revision with highlights).

Data lives in `packages/engine/src/brass/data/`.

## Data (`packages/engine/src/brass/data/`)

- [x] Locations: towns, merchant locations, farm breweries, and the industry slots in each (which industry types each slot accepts)
- [x] Links: endpoints, and whether each is canal-only, rail-only, or both
- [x] Industry tiles per type and level: stats from a physical Player Mat, counts per level from a player's punchboard
- [x] Coal and iron markets: spaces, prices, starting fill
- [x] Income track: positions mapped to income levels
- [x] Cards: location and industry cards, with counts by player count (from the Card Distribution player aid; `data/cards.ts`)
- [x] Merchant tiles: the 9 tiles with their player counts (`data/merchants.ts`), location spaces, beer and bonuses
- [x] Wild location and wild industry cards (4 of each)

## Setup

- [x] Starting money, income and VP
- [x] Cards removed by player count, and hand size
- [x] Merchant tile placement and merchant beer
- [x] Market starting state
- [x] Turn order in the first round

## Turn structure

- [x] Number of actions in the first round and in later rounds
- [x] Turn order recalculated by money spent; ties keep their relative order
- [x] Income phase, including negative income, shortfall, and removing tiles to cover it
- [x] Refilling the hand, and what happens once the draw deck runs out

## Actions

- [x] Build: card rules (location, industry, wild, farm breweries, nothing on the board), network requirement, slot preference, lowest level first, era icons, overbuilding, coal/iron sourcing, selling coal/iron to markets
- [x] Network: canal vs. rail, rail coal, building a second rail link with beer
- [x] Develop: iron needed, 1 or 2 tiles, lightbulb tiles can't be developed
- [x] Sell: connected merchants, beer sources, merchant bonuses, flipping tiles
- [x] Loan: amount, income loss, minimum income
- [x] Scout: discard requirement, which wilds you take, restrictions
- [x] Pass

## End of era and end of game

- [x] End of canal era: scoring links and flipped industries, removing level 1 tiles and links, resetting merchant beer, reshuffling
- [x] End of rail era: final scoring and tie-breakers

## Interpretations to confirm

These are places where the rulebook text leaves room; the engine currently does the following.

- **Merchant beer only counts toward beer the tile needs.** A tile that needs no beer can't take the Merchant's barrel (or its bonus).
- **A player whose hand runs out early (e.g. after Scouting) skips their turns** until the era ends.
- **Coal for a rail link** may come from a mine connected to either end of the link.
- **Coal and iron:** all available cubes on the board are used before buying from the market, even mid-action.

## Settled

- **Overbuilding:** you may always overbuild your own tiles (with a higher level of the same industry), even when an empty space is free. You may overbuild an opponent's Coal Mine or Iron Works only when there is none of that resource on any tile or in its market. Anything else of an opponent's can't be overbuilt.

- **Link icons:** only flipped tiles count; unflipped tiles show no link icons. (p.7 illustration)
