// Order queue (RabbitMQ): publish resolves only once the broker has stored the message; consume acks only after the handler succeeds

import { connect } from "amqplib";
import type { Config } from "./config.ts";

export interface OrderMessage {
  orderId: string;
  userId: string;
  productId: number;
}

export const ORDER_QUEUE = "orders";

export type OrderQueue = Awaited<ReturnType<typeof createQueue>>;

export async function createQueue(
  config: Config["rabbitmq"],
  name = ORDER_QUEUE,
) {
  const connection = await connect({
    hostname: config.host,
    port: config.port,
    username: config.user,
    password: config.password,
  });
  const channel = await connection.createConfirmChannel();
  await channel.assertQueue(name, { durable: true });

  return {
    // resolves after the broker confirms --> only then is the order safe
    publish(order: OrderMessage): Promise<void> {
      return new Promise((resolve, reject) => {
        channel.sendToQueue(
          name,
          Buffer.from(JSON.stringify(order)),
          { persistent: true, contentType: "application/json" },
          (err) => (err ? reject(err) : resolve()),
        );
      });
    },

    // handler throws --> message goes back to the queue and is retried
    async consume(
      handler: (order: OrderMessage) => Promise<void>,
      prefetch = 10,
    ): Promise<void> {
      await channel.prefetch(prefetch);
      await channel.consume(name, async (msg) => {
        if (!msg) return;

        let order: OrderMessage;
        try {
          order = JSON.parse(msg.content.toString());
        } catch {
          channel.nack(msg, false, false); // unreadable --> retrying can't help
          return;
        }

        try {
          await handler(order);
          channel.ack(msg);
        } catch {
          channel.nack(msg, false, true);
        }
      });
    },

    // tests only
    async destroy(): Promise<void> {
      await channel.deleteQueue(name);
    },

    async close(): Promise<void> {
      await channel.close();
      await connection.close();
    },
  };
}
