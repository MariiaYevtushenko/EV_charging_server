import prisma from "../prisma.config.js";
import type { PrismaClient, Station, StationStatus } from "../../generated/prisma/index.js";


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

  async createStation(station: Station): Promise<Station> {
    return await db.station.create({
      data: station,
    });
  },

  async updateStation(stationId: number, station: Station): Promise<Station> {
    return await db.station.update({
      where: { id: stationId },
      data: station,
    });
  },
  
  async archiveStation(stationId: number): Promise<Station> {
    return await db.station.update({
      where: { id: stationId }, 
      data: { status: "NO_CONNECTION" },
    });
  },  
  
  async unarchiveStation(stationId: number): Promise<Station> {
    return await db.station.update({
      where: { id: stationId },
      data: { status: "WORK" },
    });
  },
  
  async updateStationStatus(stationId: number, status: StationStatus): Promise<Station> {
    return await db.station.update({
      where: { id: stationId }, 
      data: { status: status },
    });
  },

};
