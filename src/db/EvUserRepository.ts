import prisma from "../prisma.config.js";
import type { PrismaClient, EvUser } from "../../generated/prisma/index.js";
import type { Prisma } from "../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

export const EvUsersRepository = {
    async getUser(userId: number): Promise<EvUser> {
        return await db.evUser.findUniqueOrThrow({
                where: { id: userId },
        });
    },
    async updateUser(userId: number, data: Prisma.EvUserUpdateInput): Promise<EvUser> {
        return await db.evUser.update({
            where: { id: userId },
            data,
        });
    },
    async deleteUser(userId: number): Promise<EvUser> {
        return await db.evUser.delete({
            where: { id: userId },
        }); 

    },
    async findByEmail(email: string): Promise<EvUser | null> {
        return await db.evUser.findUnique({
            where: { email: email.trim() },
        });
    },
    async logout(userId: number): Promise<EvUser> {
        return await db.evUser.update({
            where: { id: userId },
            data: { createdAt: new Date() },
        });
    },              
    async register(user: EvUser): Promise<EvUser> {
        return await db.evUser.create({
            data: user,
        });
    },
}   