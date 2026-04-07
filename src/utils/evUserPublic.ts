import type { EvUser } from "../../generated/prisma/index.js";

export type EvUserPublic = Omit<EvUser, "passwordHash">;

export function toEvUserPublic(user: EvUser): EvUserPublic {
  const { passwordHash: _p, ...rest } = user;
  return rest;
}
