import { randomSeed, type BotInput } from '@brass/engine';
import type { BotRequest, BotResponse } from './bot.worker.ts';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (a: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<BotResponse>) => {
      const { id, action, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (error !== undefined) entry.reject(new Error(error));
      else entry.resolve(action);
    });
  }
  return worker;
}

/** Asks the bot worker for a move. */
export function runBot<View, Action>(input: BotInput<View, Action>): Promise<Action> {
  const id = nextId++;
  const request: BotRequest = { id, input, seed: randomSeed() };
  return new Promise<Action>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (a: unknown) => void, reject });
    getWorker().postMessage(request);
  });
}
