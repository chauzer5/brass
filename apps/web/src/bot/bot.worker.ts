import { brass, createRng, type BotInput } from '@brass/engine';

/**
 * Runs bots off the main thread so search-based bots never freeze the UI.
 * The worker only ever receives the bot's own view and its legal actions.
 */
export interface BotRequest {
  id: number;
  input: BotInput<brass.BrassView, brass.BrassAction>;
  difficulty: brass.BotDifficulty;
  seed: number;
}

export interface BotResponse {
  id: number;
  action?: unknown;
  error?: string;
}

const bots = new Map<brass.BotDifficulty, ReturnType<typeof brass.brassBot>>();
const botFor = (d: brass.BotDifficulty) => bots.get(d) ?? bots.set(d, brass.brassBot(d)).get(d)!;
const port = self as unknown as Worker;

port.addEventListener('message', (event: MessageEvent<BotRequest>) => {
  const { id, input, difficulty, seed } = event.data;
  try {
    const response: BotResponse = { id, action: botFor(difficulty)(input, createRng(seed)) };
    port.postMessage(response);
  } catch (err) {
    const response: BotResponse = { id, error: err instanceof Error ? err.message : String(err) };
    port.postMessage(response);
  }
});
