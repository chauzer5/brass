import { brass } from '@brass/engine';

/*
 * The tutorial: a real two-player game against a tutor bot, from a fixed
 * start, played one step at a time. It follows one plan, making money from
 * manufactured goods, and each step says why, not just how: borrowing an
 * opponent's coal, a loan when the money runs short, Location and Industry
 * cards, iron, a link to a Merchant, a Brewery for beer, and selling two
 * tiles at once. "Do" steps allow only the move they teach (the usual map
 * and hand highlights then point the way); the tutor's moves are scripted;
 * "info" steps explain and wait for Next. Then the rest of the Canal Era
 * fast-forwards to its scoring, and the game can be played on from there.
 */

export const TUTORIAL_SEED = 1781;
export const TUTORIAL_NAMES = ['You', 'Bot Richard'];
export const YOU = 0;
export const TUTOR = 1;

export const TUTORIAL_PRESET: brass.BrassPreset = {
  firstPlayer: TUTOR,
  hands: [
    [{ location: 'birmingham' }, { location: 'wolverhampton' }],
    [{ location: 'dudley' }, { industries: ['iron'] }],
  ],
  merchants: {
    // Shrewsbury and Gloucester are out of the way: Oxford is the one buyer of goods within reach.
    shrewsbury: [[]],
    gloucester: [['cotton'], ['manufacturer']],
    oxford: [['cotton', 'manufacturer', 'pottery'], []],
  },
};

export const tutorialConfig = (): brass.BrassConfig => ({
  playerCount: 2,
  components: brass.BIRMINGHAM_COMPONENTS,
  preset: TUTORIAL_PRESET,
});

/** A box of the map to bring into view, in map units. */
export interface Frame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Match = (action: brass.BrassAction, state: brass.BrassState) => boolean;

/**
 * Where the coach card sits: at the top (under the players), in the middle,
 * or at the bottom (just above the hand). Each step picks the place that
 * doesn't cover what it asks you to tap or look at.
 */
export type Place = 'top' | 'middle' | 'bottom';

export type Step = { place: Place } & (
  | {
      kind: 'info';
      title: string;
      text: string;
      /** A CSS selector for what to point at. */
      point?: string;
      frame?: Frame;
    }
  | {
      kind: 'do';
      title: string;
      text: string;
      /** The only moves allowed (the engine's legal moves, filtered). */
      allow: Match;
      /**
       * What the finished move must also be, beyond `allow` (which also shapes what the screens offer
       * along the way: a sale of two tiles is put together from tiles that could each be sold alone).
       */
      require?: { match: Match; hint: string };
      point?: string;
      frame?: Frame;
    }
  | {
      kind: 'tutor';
      title: string;
      text: string;
      /** The tutor's moves, in order: each is the first legal move matching. */
      moves: Match[];
      frame?: Frame;
    }
  | {
      /** Bots play both seats, quickly, until the era's scoring comes up. */
      kind: 'fastForward';
      title: string;
      text: string;
    }
  | {
      /** Explains the end-of-era summary that's on screen; done when it's closed. */
      kind: 'summary';
      title: string;
      text: string;
    }
  | { kind: 'finish'; title: string; text: string }
);

const card = (s: brass.BrassState, id: string) => s.cards[id];
/** Whether a card is the Location card for a town (the tutorial names the card to use for each move). */
const townCard = (s: brass.BrassState, id: string, town: brass.LocationId) => {
  const c = card(s, id);
  return c?.kind === 'location' && c.location === town;
};
const industryCard = (s: brass.BrassState, id: string, industry: brass.Industry) => {
  const c = card(s, id);
  return c?.kind === 'industry' && c.industries.includes(industry);
};
/** The tutor keeps its Iron card for its Iron Works. */
const tutorSpare = (s: brass.BrassState, id: string) => {
  const c = card(s, id);
  return !(c?.kind === 'industry' && c.industries.includes('iron')) && !(c?.kind === 'location' && c.location === 'dudley');
};
const link = (a: brass.BrassAction, id: string): a is Extract<brass.BrassAction, { type: 'network' }> =>
  a.type === 'network' && a.links.length === 1 && a.links[0] === id;

/** Birmingham and its neighbours: Dudley, Wolverhampton, Oxford. */
const HEARTLAND: Frame = { x0: 330, y0: 470, x1: 860, y1: 900 };
const DUDLEY: Frame = { x0: 360, y0: 560, x1: 720, y1: 720 };
const WEST: Frame = { x0: 200, y0: 470, x1: 720, y1: 720 };
const MARKETS: Frame = { x0: 780, y0: 240, x1: 1000, y1: 660 };

export const STEPS: readonly Step[] = [
  {
    kind: 'info',
    title: 'Welcome to Brass: Birmingham',
    place: 'middle',
    text: "You're an entrepreneur in the Industrial Revolution: build industries, link towns with canals and railways, and sell your goods. The game has two halves, the Canal Era and the Rail Era, and whoever has the most victory points (VP) after both wins. This tutorial is a real game against Bot Richard.",
  },
  {
    kind: 'info',
    title: 'Money and VPs',
    place: 'top',
    text: 'Everyone starts with £17. Your money, income and VPs are shown up here. Most VPs are scored at the end of each era, from your links and your flipped industry tiles (more on flipping soon); a few Merchants also give VPs straight away, as a bonus for using their beer.',
    point: '.player-strip',
  },
  {
    kind: 'info',
    title: 'Your hand',
    place: 'middle',
    text: 'Every action costs a card from your hand. A Location card builds in its town; an Industry card builds that industry in any town in your network. In the first round each player takes 1 action; after that, 2 actions per turn.',
    point: '.hand-tray',
  },
  {
    kind: 'info',
    title: 'The plan: sell goods',
    place: 'top',
    text: "We'll make our money from manufactured goods. A Manufacturer is built in a town with a goods space, like Birmingham, and sold to a Merchant that buys goods, like Oxford (a Merchant's tile shows what it buys). Building one takes £8 and 1 coal; selling it takes a beer. Right now we have £17, no coal, no beer and no route to Oxford. Let's see how we get there.",
    frame: HEARTLAND,
  },
  {
    kind: 'tutor',
    title: 'Richard builds a Coal Mine',
    place: 'top',
    text: "Richard goes first, with a Coal Mine in Dudley, right next to Birmingham. A new mine comes with coal cubes: 2 for this one. Had it been connected to a Merchant, it would have sold them to the coal market straight away. It isn't, so they stay on the tile, for anyone connected to it to use.",
    moves: [(a) => a.type === 'build' && a.location === 'dudley' && a.industry === 'coal'],
    frame: DUDLEY,
  },
  {
    kind: 'info',
    title: "Richard's coal is good news",
    place: 'top',
    text: "Building a Manufacturer needs coal from a mine connected to where you build. Richard's coal costs us nothing once we're connected, and every cube we take brings his mine closer to flipping, which scores him VPs and raises his income. He gets a better mine, we save building our own: both of us win. That's why players so often end up sharing coal.",
    frame: DUDLEY,
  },
  {
    kind: 'do',
    title: 'Connect to the coal',
    place: 'bottom',
    text: "Tap Network, then the canal from Birmingham to Dudley, and your Stafford card. Any card pays for a link, so spend one the plan doesn't need. Canals cost £3. Your first link can go anywhere; after that, new links have to touch your network (towns with your tiles, or at the end of your links).",
    allow: (a, s) => link(a, 'birmingham~dudley') && townCard(s, a.card, 'stafford'),
    frame: DUDLEY,
  },
  {
    kind: 'info',
    title: 'Who goes next?',
    place: 'top',
    text: "At the end of each round, turn order is set by money spent: least first. You spent £3 and Richard £5, so you go first now. This panel keeps track as each round goes. At the end of a round everyone also collects their income and draws back up to 8 cards. From now on, every turn has 2 actions.",
    point: '.turn-order',
    frame: { x0: 0, y0: 640, x1: 440, y1: 1000 },
  },
  {
    kind: 'info',
    title: 'Short of money',
    place: 'middle',
    text: "Here's what the plan needs: a Manufacturer in Birmingham (£8), a second one so we can sell two at once (£10), a canal to Oxford (£3) and a Brewery for beer (£5, plus iron). That's well over the £14 we have left. Waiting for income would take rounds; a loan is quicker.",
  },
  {
    kind: 'do',
    title: 'Take a loan',
    place: 'top',
    text: "A loan gives you £30 straight away, but your income drops 3 levels, and you'll pay that every round until you earn it back by flipping tiles. Borrowing early, while there's lots of game left to use the money, is usually right. Tap Loan and your Pottery card.",
    allow: (a, s) => a.type === 'loan' && industryCard(s, a.card, 'pottery'),
  },
  {
    kind: 'do',
    title: 'Build a Manufacturer',
    place: 'bottom',
    text: "Tap Build, then a Manufacturer space in Birmingham, and your Birmingham card. The coal comes from Richard's mine, along your canal: one of his two cubes. Without the canal, Birmingham would have no coal to build with.",
    allow: (a) => a.type === 'build' && a.location === 'birmingham' && a.industry === 'manufacturer',
    frame: DUDLEY,
  },
  {
    kind: 'tutor',
    title: "Richard's turn",
    place: 'top',
    text: 'Richard links Dudley to Wolverhampton, and takes a loan of his own: he has plans too.',
    moves: [(a, s) => link(a, 'wolverhampton~dudley') && tutorSpare(s, a.card), (a, s) => a.type === 'loan' && tutorSpare(s, a.card)],
    frame: WEST,
  },
  {
    kind: 'tutor',
    title: 'Richard builds an Iron Works',
    place: 'top',
    text: "Richard spent less, so he goes first. He links Wolverhampton to Coalbrookdale and builds an Iron Works there. It needs coal, so he takes the last cube from his Dudley mine, and the mine flips: helped along by the cube you took. An Iron Works sells iron to the market straight away, as much as it has room for, and the rest stays on the tile. Iron needs no connection: anyone can use it, from anywhere.",
    moves: [(a, s) => link(a, 'coalbrookdale~wolverhampton') && tutorSpare(s, a.card), (a) => a.type === 'build' && a.location === 'coalbrookdale' && a.industry === 'iron'],
    frame: WEST,
  },
  {
    kind: 'info',
    title: 'Coal and iron markets',
    place: 'bottom',
    text: "Here are the markets. When there's no connected mine, you buy coal here, as long as you're connected to a Merchant; iron you can buy from anywhere. You always pay for the cheapest cube, so prices rise as a market empties. Free cubes on the board are used first.",
    point: '.markets',
    frame: MARKETS,
  },
  {
    kind: 'info',
    title: 'A second Manufacturer',
    place: 'bottom',
    text: "In the Canal Era you can only have one tile in each town, so the second Manufacturer can't go in Birmingham. Wolverhampton has a free Manufacturer space, and you have a Wolverhampton card: a Location card builds in its town even outside your network. Your next tile is a Manufacturer II, which needs 1 iron instead of coal, and Richard's Iron Works has iron to spare.",
    frame: WEST,
  },
  {
    kind: 'do',
    title: 'Build in Wolverhampton',
    place: 'bottom',
    text: 'Tap Build, the Manufacturer space in Wolverhampton, and your Wolverhampton card. The iron comes from Richard\'s Iron Works, free, and brings it closer to flipping too.',
    allow: (a) => a.type === 'build' && a.location === 'wolverhampton' && a.industry === 'manufacturer',
    frame: WEST,
  },
  {
    kind: 'do',
    title: 'Connect to a Merchant',
    place: 'bottom',
    text: "Now a buyer. Oxford buys goods: build the canal from Birmingham to Oxford, with your Worcester card. Your Wolverhampton Manufacturer gets there too, along Richard's canal and yours: links connect places whoever owns them.",
    allow: (a, s) => link(a, 'birmingham~oxford') && townCard(s, a.card, 'worcester'),
    frame: HEARTLAND,
  },
  {
    kind: 'tutor',
    title: "Richard's turn",
    place: 'top',
    text: "Richard links Coalbrookdale to Kidderminster, then Develops: that removes the lowest tile of an industry from his player board without building it, to reach better tiles sooner (Level I tiles are gone at the end of the Canal Era anyway). Each tile removed costs 1 iron.",
    moves: [(a, s) => link(a, 'kidderminster~coalbrookdale') && tutorSpare(s, a.card), (a, s) => a.type === 'develop' && tutorSpare(s, a.card)],
    frame: WEST,
  },
  {
    kind: 'info',
    title: 'Beer',
    place: 'top',
    text: "Each Manufacturer needs a beer to sell. Oxford has a barrel of its own, and using it earns Oxford's bonus too: 2 more income. That's one. For the other we need a Brewery. Your own beer can be used anywhere, connected or not. But where can we build one? Your Brewery cards are Industry cards: they only build in your network, and none of its towns (Birmingham, Dudley, Wolverhampton) has a Brewery space. And none of your Location cards is for a town that does.",
    frame: HEARTLAND,
  },
  {
    kind: 'do',
    title: 'Scout for Wild cards',
    place: 'top',
    text: "Scouting swaps 3 cards for a Wild Location and a Wild Industry card, which build almost anywhere. It's for exactly this: when your hand doesn't fit your plan. Tap Scout and choose 3 cards.",
    allow: (a) => a.type === 'scout',
  },
  {
    kind: 'do',
    title: 'Build a Brewery',
    place: 'bottom',
    text: "Tap Build, then your Wild Location card and any Brewery space on the map: Walsall is close by. A Brewery costs £5 and 1 iron, and comes with 1 barrel of beer (2 in the Rail Era). Richard's Develop used the last iron on his Iron Works (flipping it), so this iron is bought from the market.",
    allow: (a) => a.type === 'build' && a.industry === 'brewery',
    frame: HEARTLAND,
  },
  {
    kind: 'tutor',
    title: "Richard's turn",
    place: 'top',
    text: "Richard builds a Cotton Mill in Worcester, then passes: he discards a card and does nothing else. Sometimes that's the best move left.",
    moves: [(a) => a.type === 'build' && a.location === 'worcester' && a.industry === 'cotton', (a) => a.type === 'pass'],
    frame: WEST,
  },
  {
    kind: 'do',
    title: 'Sell both at once',
    place: 'bottom',
    text: "One Sell action sells as many tiles as you like, as long as each has a buyer and a beer. Tap Sell and any card, then your Manufacturers one at a time, each to Oxford. One takes Oxford's barrel, the other your Brewery's. Confirm when both are in. (The sale's details fill the bottom of the screen: tap − on this card to shrink it out of the way.)",
    allow: (a) => a.type === 'sell' && a.sales.every((x) => x.location === 'birmingham' || x.location === 'wolverhampton'),
    require: { match: (a) => a.type === 'sell' && a.sales.length === 2, hint: 'Add your other Manufacturer too: both sell in this one action.' },
    frame: HEARTLAND,
  },
  {
    kind: 'info',
    title: 'Flipped!',
    place: 'top',
    text: "Both Manufacturers flipped: they'll score their VPs at the end of the era, and each raised your income. Oxford's bonus added 2 more, and your Brewery flipped too, its beer used. Your income is back above where the loan left it, and every round from now on it pays you. That's the whole engine of the game: build, connect, sell, flip.",
    point: '.player-strip',
  },
  {
    kind: 'do',
    title: 'Pass',
    place: 'top',
    text: "Nothing else worth doing this turn? Passing just discards a card. Every action costs a card, so a pass also clears out one you don't need. Tap Pass and any card.",
    allow: (a) => a.type === 'pass',
  },
  {
    kind: 'info',
    title: 'The rest of the era',
    place: 'middle',
    text: "You've now used every action: Build, Network, Develop (Richard showed it), Sell, Loan, Scout and Pass. The Canal Era goes on until everyone's cards run out: 10 rounds with two players. Let's fast-forward, with bots playing both sides, to the end of the era.",
  },
  {
    kind: 'fastForward',
    title: 'Fast-forwarding…',
    place: 'top',
    text: 'Bots are playing out the Canal Era.',
  },
  {
    kind: 'summary',
    title: 'End of the Canal Era',
    place: 'top',
    text: "Each link scores 1 VP per link icon in the towns at its ends (on flipped tiles, and on Merchants). Then every flipped tile scores its VPs. After scoring, all links and every Level I tile come off the board. The Rail Era is played the same way, but links are railways: £5 and 1 coal each, or two at once for £15, 2 coal and a beer. At its end, scoring happens again and the game is over. Tap Start the Rail Era to carry on.",
  },
  {
    kind: 'finish',
    title: "You're ready",
    place: 'middle',
    text: "That's the whole game. You can keep playing this one against Richard to the end, or start a new game from the menu.",
  },
];
