import prisma from "../prisma.config.js";
import type { Port, PrismaClient } from "../../generated/prisma/index.js";
import type { Prisma } from "../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

export const portRepository = {
  async createPort(data: Prisma.PortCreateInput): Promise<Port> {
    return await db.port.create({
      data,
    });
  },

  async updatePort(
    stationId: number,
    portNumber: number,
    data: Prisma.PortUpdateInput
  ): Promise<Port> {
    return await db.port.update({
      where: {
        stationId_portNumber: { stationId, portNumber },
      },
      data,
    });
  },

  async deletePort(stationId: number, portNumber: number): Promise<Port> {
    return await db.port.delete({
      where: {
        stationId_portNumber: { stationId, portNumber },
      },
    });
  },
};
