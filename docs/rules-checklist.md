# Rules transcription checklist

Each rule enters the engine together with a test that cites the rulebook page it comes from (`// Rulebook p.N: "..."`). Source: the official Roxley rulebook (2018-11-20 revision with highlights).

Data lives in `packages/engine/src/brass/data/`. Values the rulebook's pictures don't show legibly are listed in each tile's `unverified` field.

## Data (`packages/engine/src/brass/data/`)

- [x] Locations: towns, merchant locations, farm breweries, and the industry slots in each (which industry types each slot accepts)
- [x] Links: endpoints, and whether each is canal-only, rail-only, or both
- [~] Industry tiles per type and level. Most values were read from the mat photo on p.5. Still to confirm against a real mat: the count of each level, Cotton I and Manufacturer II income, Manufacturer III beer, Manufacturer VII link VP and beer, Manufacturer VIII, Iron III–IV, and the coal/iron that Coal IV and Iron II–IV produce
- [x] Coal and iron markets: spaces, prices, starting fill
- [x] Income track: positions mapped to income levels
- [ ] Cards: location and industry cards, with counts by player count. **Not in the rulebook**: needs the physical cards
- [~] Merchant tiles: location spaces, beer and bonuses are done. **Still needed**: the contents of the 9 tiles and their player counts (not in the rulebook)
- [ ] Wild location and wild industry cards

## Setup

- [x] Starting money, income and VP
- [x] Cards removed by player count, and hand size (needs the real card list to be complete)
- [x] Merchant tile placement and merchant beer (needs the real tiles)
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
- **Overbuilding is allowed even when an empty space is available** in that location.
- **A player whose hand runs out early (e.g. after Scouting) skips their turns** until the era ends.
- **Coal for a rail link** may come from a mine connected to either end of the link.
- **Coal and iron:** all available cubes on the board are used before buying from the market, even mid-action.

## Open questions

- ~~Do link icons on unflipped tiles count?~~ No. Unflipped tiles show no link icons; only flipped (black-top) tiles display them (p.7 illustration).
