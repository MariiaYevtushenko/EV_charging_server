import prisma from "../prisma.config.js";
import type { Port, PrismaClient } from "../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

export const portRepository = {
    async createPort(port: Port): Promise<Port> {
        return await db.port.create({
            data: port,
        });
    },

    async updatePort(portId: number, port: Port): Promise<Port> {
        return await db.port.update({
            where: { id: portId },
            data: port,
        });
    },

    async deletePort(portId: number): Promise<Port> {
        return await db.port.delete({
            where: { id: portId },
        });
    },
}