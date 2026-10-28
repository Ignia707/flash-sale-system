// Replay: pnpm replay-dead --> moves parked (dead-letter) orders back to the queue for another try

import { loadConfig } from "../lib/config.ts";
import { createQueue } from "../lib/queue.ts";

const queue = await createQueue(loadConfig().rabbitmq);
try {
  console.log(`${await queue.replayDead()} orders moved back to the queue`);
} finally {
  await queue.close();
}
