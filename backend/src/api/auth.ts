// Guest identity: a signed token proves "this is the same visitor as before" (it is not a login).

import type { FastifyRequest } from "fastify";

// what is inside our tokens: sub = the guest's id
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

// use as an onRequest hook: a missing, forged or expired token is answered with 401
export async function authenticate(request: FastifyRequest): Promise<void> {
  await request.jwtVerify();
}
