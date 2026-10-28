// Shared by tests: a secret, and a way to act as a given guest

import type { buildApp } from "../src/api/app.ts";

export const TEST_SECRET = "test-secret-at-least-16-chars";

// headers that make a request come from this guest
export async function asGuest(app: ReturnType<typeof buildApp>, userId: string) {
  await app.ready(); // the token signer exists once the app is ready
  return { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` };
}
