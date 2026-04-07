import { portRepository } from "../db/portRepository.js";
import type { Port } from "../../generated/prisma/index.js";
import type { Prisma } from "../../generated/prisma/index.js";

export const portService = {
  async createPort(stationId: number, body: Omit<Prisma.PortCreateInput, "station">): Promise<Port> {
    return await portRepository.createPort({
      ...body,
      station: { connect: { id: stationId } },
    });
  },

  async updatePort(
    stationId: number,
    portNumber: number,
    body: Prisma.PortUpdateInput
  ): Promise<Port> {
    return await portRepository.updatePort(stationId, portNumber, body);
  },

  async deletePort(stationId: number, portNumber: number): Promise<Port> {
    return await portRepository.deletePort(stationId, portNumber);
  },
};
