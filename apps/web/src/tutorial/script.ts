import { brass } from '@brass/engine';

/*
 * The tutorial: a real two-player game against a tutor bot, from a fixed
 * start, played one step at a time. "Do" steps allow only the move they teach
 * (the usual map and hand highlights then point the way); the tutor's moves
 * are scripted; "info" steps explain and wait for Next. After the four rounds
 * that cover every action, the rest of the Canal Era fast-forwards to its
 * scoring, and the game can be played on from there.
 */

export const TUTORIAL_SEED = 1781;
export const TUTORIAL_NAMES = ['You', 'Bot Richard'];
export const YOU = 0;
export const TUTOR = 1;

export const TUTORIAL_PRESET: brass.BrassPreset = {
  firstPlayer: YOU,
  hands: [[{ location: 'worcester' }], [{ location: 'coalbrookdale' }, { industries: ['coal'] }]],
  merchants: {
    shrewsbury: [['manufacturer']],
    gloucester: [['cotton'], []],
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

const cardIs = (state: brass.BrassState, id: string, location: string) => {
  const card = state.cards[id];
  return card?.kind === 'location' && card.location === location;
};
const anyOf = (type: brass.BrassAction['type']): Match => (a) => a.type === type;
/** The tutor keeps its Coal card for later. */
const spare = (s: brass.BrassState, card: string) => {
  const c = s.cards[card];
  return !(c?.kind === 'industry' && c.industries.includes('coal'));
};

const WORCESTER: Frame = { x0: 300, y0: 820, x1: 640, y1: 1000 };
const COALBROOKDALE: Frame = { x0: 60, y0: 480, x1: 480, y1: 640 };

export const STEPS: readonly Step[] = [
  {
    kind: 'info',
    title: 'Welcome to Brass: Birmingham',
    place: 'middle',
    text: "You're an entrepreneur in the Industrial Revolution. Build industries, link towns with canals and railways, and sell your goods. The game has two halves, the Canal Era and the Rail Era, and whoever has the most victory points (VP) after both wins. This tutorial is a real game against Bot Richard: you'll make every move yourself.",
  },
  {
    kind: 'info',
    title: 'Money and VPs',
    place: 'bottom',
    text: 'Everyone starts with £17. Your money, income and VPs are shown up here. VPs mostly come at the end of each era, from your links and your flipped industry tiles: more on flipping soon.',
    point: '.player-strip',
  },
  {
    kind: 'info',
    title: 'Your hand',
    place: 'middle',
    text: 'Every action costs a card from your hand. Location cards build in that town; Industry cards build that industry anywhere in your network. In the first round each player takes 1 action; after that, 2 actions per turn.',
    point: '.hand-tray',
  },
  {
    kind: 'do',
    title: 'Build a Cotton Mill',
    place: 'bottom',
    text: 'Tap Build, then a highlighted space in Worcester (or your Worcester card first, either way). Building takes the lowest tile of that industry from your player board and costs its price: £12 for Cotton Mill I.',
    allow: (a, s) => a.type === 'build' && a.location === 'worcester' && a.industry === 'cotton' && cardIs(s, a.card, 'worcester'),
    frame: WORCESTER,
  },
  {
    kind: 'info',
    title: 'Tiles flip to score',
    place: 'top',
    text: 'Your mill is on the map, but it scores nothing yet. Tiles flip over when they do their job, and only flipped tiles score VPs and raise your income. A Cotton Mill flips when you sell its cotton to a Merchant that buys it.',
    frame: WORCESTER,
  },
  {
    kind: 'tutor',
    title: "Bot Richard's turn",
    place: 'top',
    text: "Richard builds a Coal Mine in Coalbrookdale. Coal mines come with coal cubes that anyone connected to them can use for building; a mine flips when its last cube is used. Coal and iron works also sell their cubes to the market straight away, if they're linked to a Merchant.",
    moves: [(a, s) => a.type === 'build' && a.location === 'coalbrookdale' && a.industry === 'coal' && cardIs(s, a.card, 'coalbrookdale')],
    frame: COALBROOKDALE,
  },
  {
    kind: 'info',
    title: 'Who goes next?',
    place: 'top',
    text: "At the end of each round, the turn order is set by money spent: least first. In round 1 you spent £12 and Richard £5, so he goes first now. This panel keeps track as each round goes. At the end of a round everyone also collects their income and draws back up to 8 cards.",
    point: '.turn-order',
    frame: { x0: 0, y0: 640, x1: 440, y1: 1000 },
  },
  {
    kind: 'tutor',
    title: "Richard's turn: 2 actions",
    place: 'top',
    text: 'From now on every turn has 2 actions. Richard builds canals out of Coalbrookdale: £3 each in the Canal Era. Links grow your network, and score VPs at the end of the era.',
    moves: [
      (a, s) => a.type === 'network' && a.links[0] === 'coalbrookdale~shrewsbury' && spare(s, a.card),
      (a, s) => a.type === 'network' && a.links[0] === 'coalbrookdale~wolverhampton' && spare(s, a.card),
    ],
    frame: COALBROOKDALE,
  },
  {
    kind: 'do',
    title: 'Build a canal',
    place: 'bottom',
    text: "Your mill needs a route to a Merchant who buys cotton, like Gloucester. Tap Network, then the highlighted canal from Worcester to Gloucester, and any card. A new link has to touch your network: a town where you have a tile or a link.",
    allow: (a) => a.type === 'network' && a.links.length === 1 && a.links[0] === 'worcester~gloucester',
    frame: WORCESTER,
  },
  {
    kind: 'do',
    title: 'Sell your cotton',
    place: 'bottom',
    text: "Selling a mill needs beer. Gloucester has a barrel of its own: using it earns its bonus too, a free Develop. Tap Sell, any card, your mill, then Confirm. Pick any industry for the bonus.",
    allow: (a) =>
      // Either Worcester space: the mill went on whichever you tapped.
      a.type === 'sell' && a.sales.length === 1 && a.sales[0]!.location === 'worcester',
    frame: WORCESTER,
  },
  {
    kind: 'info',
    title: 'Flipped!',
    place: 'bottom',
    text: 'Your Cotton Mill flipped: it will score 5 VP at the end of the era, and your income went up (see the income track on your Board tab). Each round you collect your income. The free Develop removed a tile from your player board, so your next tile of that industry is a better one.',
    point: '.player-strip',
  },
  {
    kind: 'do',
    title: 'Take a loan',
    place: 'top',
    text: "Money's tight. A loan gives you £30 straight away, but your income drops 3 levels for the rest of the game. Tap Loan and any card.",
    allow: anyOf('loan'),
  },
  {
    kind: 'do',
    title: 'Develop',
    place: 'bottom',
    text: "Developing removes the lowest tile of an industry (or two industries) from your player board without building it, to reach better tiles sooner: Level I tiles are gone at the end of the Canal Era anyway. Each tile removed costs 1 iron, from any Iron Works or the market. Tap Develop, any card, then an industry on your board.",
    allow: anyOf('develop'),
  },
  {
    kind: 'tutor',
    title: "Richard's turn",
    place: 'top',
    text: "Richard takes a loan too, then builds a Coal Mine in Wolverhampton. His canals link it to Shrewsbury, a Merchant, so its coal is sold to the coal market straight away, as many cubes as the market has room for, and he's paid for them. (In the Canal Era, each player can only have one tile per town.)",
    moves: [
      (a, s) => a.type === 'loan' && spare(s, a.card),
      (a) => a.type === 'build' && a.location === 'wolverhampton' && a.industry === 'coal',
    ],
    frame: COALBROOKDALE,
  },
  {
    kind: 'do',
    title: 'Scout',
    place: 'top',
    text: "Scouting swaps 3 cards for a Wild Location and a Wild Industry card, which build almost anywhere. It's for when your hand doesn't fit your plans. Tap Scout and choose 3 cards.",
    allow: anyOf('scout'),
  },
  {
    kind: 'do',
    title: 'Pass',
    place: 'top',
    text: 'Sometimes the best move is none: passing just discards a card. You still have to spend a card on each action, so a pass also gets rid of one you don\'t need. Tap Pass and any card.',
    allow: anyOf('pass'),
  },
  {
    kind: 'info',
    title: 'The rest of the era',
    place: 'middle',
    text: "That's every action: Build, Network, Develop, Sell, Loan, Scout and Pass. The Canal Era goes on until everyone's cards run out: 10 rounds with two players. Let's fast-forward, with bots playing both sides, to the end of the era.",
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
