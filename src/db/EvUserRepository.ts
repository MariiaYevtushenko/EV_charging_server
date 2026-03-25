import prisma from "../prisma.config.js";
import type { PrismaClient, EvUser } from "../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

export const EvUsersRepository = {
    async getUser(userId: number): Promise<EvUser> {
        return await db.evUser.findUniqueOrThrow({
                where: { id: userId },
        });
    },
    async updateUser(userId: number, user: EvUser): Promise<EvUser> {
        return await db.evUser.update({
            where: { id: userId },
            data: user,
        });
    },
    async deleteUser(userId: number): Promise<EvUser> {
        return await db.evUser.delete({
            where: { id: userId },
        }); 

    },
    async login(email: string, password: string): Promise<EvUser> {
        return await db.evUser.findUniqueOrThrow({
            where: { email: email },
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