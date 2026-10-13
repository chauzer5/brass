import { createRng, randomBot, type BotInput } from '@brass/engine';

/**
 * Runs bots off the main thread so search-based bots never freeze the UI.
 * The worker only ever receives the bot's own view and its legal actions.
 */
export interface BotRequest {
  id: number;
  input: BotInput<unknown, unknown>;
  seed: number;
}

export interface BotResponse {
  id: number;
  action?: unknown;
  error?: string;
}

const bot = randomBot<unknown, unknown>();
const port = self as unknown as Worker;

port.addEventListener('message', (event: MessageEvent<BotRequest>) => {
  const { id, input, seed } = event.data;
  try {
    const response: BotResponse = { id, action: bot(input, createRng(seed)) };
    port.postMessage(response);
  } catch (err) {
    const response: BotResponse = { id, error: err instanceof Error ? err.message : String(err) };
    port.postMessage(response);
  }
});
