import prisma from "../prisma.config.js";
import type { PrismaClient } from "../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

const stationInclude = {
  location: {
    select: {
      id: true,
      city: true,
      street: true,
      houseNumber: true,
    },
  },
  ports: {
    include: { connectorType: true },
    orderBy: { portNumber: "asc" as const },
  },
} as const;

export const stationRepository = {
  async findByIdWithPorts(id: number) {
    return db.station.findUnique({
      where: { id },
      include: stationInclude,
    });
  },

  async findAll() {
    return db.station.findMany({
      include: stationInclude,
      orderBy: { id: "asc" },
    });
  },
};
