// Order queue (RabbitMQ): publish resolves only once the broker has stored the message; consume acks only after the handler succeeds.
// A message that keeps failing is retried a few times, then parked in "<name>.dead" for a human to inspect.
// If the broker restarts, the connection, channel and consumer are rebuilt automatically.

import { connect, type ChannelModel, type ConfirmChannel } from "amqplib";
import type { Config } from "./config.ts";

export interface OrderMessage {
  orderId: string;
  userId: string;
  productId: number;
}

interface QueueOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

type Handler = (order: OrderMessage) => Promise<void>;

export const ORDER_QUEUE = "orders";

export type OrderQueue = Awaited<ReturnType<typeof createQueue>>;

export async function createQueue(
  config: Config["rabbitmq"],
  name = ORDER_QUEUE,
  { maxAttempts = 5, retryDelayMs = 1000 }: QueueOptions = {},
) {
  const deadName = `${name}.dead`;

  // replaced after every reconnect; undefined or closed while the broker is down
  let channel: ConfirmChannel | undefined;
  let consumer: { handler: Handler; prefetch: number } | undefined;

  const connection = await connect(
    {
      hostname: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
    },
    {
      recovery: {
        initialDelay: 200,
        maxDelay: 5000,
        initialMaxRetries: 5, // fail fast if the broker is down at startup
        // runs after the first connection and after every reconnection
        async setup(model: ChannelModel) {
          const ch = await model.createConfirmChannel();
          await ch.assertQueue(name, { durable: true });
          await ch.assertQueue(deadName, { durable: true });
          channel = ch;
          if (consumer) await startConsuming(ch, consumer.handler, consumer.prefetch);
        },
      },
    },
  );
  connection.on("disconnect", (err) =>
    console.error(`queue: disconnected (${err.message}), reconnecting`),
  );
  connection.on("error", (err) => console.error(`queue: ${err.message}`));

  // resolves after the broker confirms --> only then is the message safe
  function send(
    queueName: string,
    content: Buffer,
    headers: Record<string, unknown> = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (!channel) throw new Error("queue is not connected");
        channel.sendToQueue(
          queueName,
          content,
          { persistent: true, contentType: "application/json", headers },
          (err) => (err ? reject(err) : resolve()),
        );
      } catch (err) {
        reject(err); // a closed channel throws instead of calling back
      }
    });
  }

  async function startConsuming(
    ch: ConfirmChannel,
    handler: Handler,
    prefetch: number,
  ): Promise<void> {
    await ch.prefetch(prefetch);
    await ch.consume(name, async (msg) => {
      if (!msg) return;
      // the channel may be gone by now: the broker then redelivers the message
      const ack = () => { try { ch.ack(msg); } catch {} };
      const requeue = () => { try { ch.nack(msg, false, true); } catch {} };
      const attempts = Number(msg.properties.headers?.["x-attempts"] ?? 0) + 1;

      try {
        await handler(JSON.parse(msg.content.toString()));
        ack();
        return;
      } catch {
        // fall through to the retry logic
      }

      try {
        // the copy is confirmed before the original is acked, so a failure here loses nothing
        if (attempts >= maxAttempts) {
          await send(deadName, msg.content, { "x-attempts": attempts });
        } else {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          await send(name, msg.content, { "x-attempts": attempts });
        }
        ack();
      } catch {
        requeue();
      }
    });
  }

  const depthOf = async (queueName: string) => {
    if (!channel) throw new Error("queue is not connected");
    return (await channel.checkQueue(queueName)).messageCount;
  };

  return {
    publish(order: OrderMessage): Promise<void> {
      return send(name, Buffer.from(JSON.stringify(order)));
    },

    // handler throws --> retried up to maxAttempts, then moved to the dead-letter queue
    async consume(handler: Handler, prefetch = 10): Promise<void> {
      consumer = { handler, prefetch };
      if (channel) await startConsuming(channel, handler, prefetch);
    },

    // moves every parked message back to the main queue for a fresh round of attempts
    async replayDead(): Promise<number> {
      if (!channel) throw new Error("queue is not connected");
      let moved = 0;
      for (;;) {
        const msg = await channel.get(deadName);
        if (!msg) return moved; // nothing left
        await send(name, msg.content);
        channel.ack(msg);
        moved++;
      }
    },

    depth: () => depthOf(name),
    deadDepth: () => depthOf(deadName),

    // tests only
    async destroy(): Promise<void> {
      await channel?.deleteQueue(name);
      await channel?.deleteQueue(deadName);
    },

    async close(): Promise<void> {
      await channel?.close().catch(() => {});
      await connection.close();
    },
  };
}
