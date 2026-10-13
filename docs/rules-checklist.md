# Rules transcription checklist

Each rule enters the engine together with a test that cites the rulebook page it comes from (`// Rulebook p.N: "..."`). Source: the official Roxley rulebook (2018-11-20 revision with highlights).

## Data (`packages/engine/src/brass/data/`)

- [ ] Locations: towns, merchant locations, farm breweries, and the industry slots in each (which industry types each slot accepts)
- [ ] Links: endpoints, and whether each is canal-only, rail-only, or both
- [ ] Industry tiles per type and level: count per player, cost, coal and iron needed, resources produced, VP, income gain, link VP, beer needed to sell, era restrictions, and which tiles can't be developed
- [ ] Coal and iron markets: spaces, prices, starting fill
- [ ] Income track: positions mapped to income levels
- [ ] Cards: location and industry cards, with counts by player count
- [ ] Merchant tiles: by player count, plus the beer and bonus at each merchant location
- [ ] Wild location and wild industry cards

## Setup

- [ ] Starting money, income and VP
- [ ] Cards removed by player count, and hand size
- [ ] Merchant tile placement and merchant beer
- [ ] Market starting state
- [ ] Turn order in the first round

## Turn structure

- [ ] Number of actions in the first round and in later rounds
- [ ] Turn order recalculated by money spent; how ties are broken
- [ ] Income phase, including negative income, shortfall, and selling tiles to cover it
- [ ] Refilling the hand, and what happens once the draw deck runs out

## Actions

- [ ] Build: card rules (location, industry, wild), network requirement, slot rules, lowest level first, overbuilding, coal/iron sourcing order, market purchases
- [ ] Network: canal vs. rail, rail coal, building a second rail link with beer
- [ ] Develop: iron needed, how many tiles, which tiles can't be developed
- [ ] Sell: connected merchants, beer sources, merchant bonuses, flipping tiles
- [ ] Loan: amount, income loss, minimum income
- [ ] Scout: discard requirement, which wilds you take, restrictions
- [ ] Pass

## End of era and end of game

- [ ] End of canal era: scoring links and flipped industries, removing level 1 tiles and links, resetting merchant beer, reshuffling
- [ ] End of rail era: final scoring and tie-breakers
