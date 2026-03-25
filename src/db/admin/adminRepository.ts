import prisma from "../../prisma.config.js";
import type { PrismaClient, EvUser } from "../../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

export const adminRepository = {
    async getUsers(): Promise<EvUser[]> {
        return await db.evUser.findMany();
    },
}   