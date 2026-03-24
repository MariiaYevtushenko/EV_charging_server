import { stationRepository } from "../db/stationRepository.js";
import type { Prisma } from "../../generated/prisma/index.js";

/** DTO для REST — відповідає таблицям station + location + port (DB_script.MD) */
export type StationDashboardDto = {
  id: number;
  name: string;
  status: string;
  locationId: number;
  city: string;
  addressLine: string;
  createdAt: string;
  updatedAt: string;
  ports: Array<{
    id: number;
    portNumber: number;
    maxPower: number;
    connectorCategory: string | null;
    status: string;
  }>;
};

type StationWithLocationPorts = Prisma.StationGetPayload<{
  include: {
    location: {
      select: { id: true; city: true; street: true; houseNumber: true };
    };
    ports: { include: { connectorType: true } };
  };
}>;

function toDashboardDto(station: StationWithLocationPorts): StationDashboardDto {
  const loc = station.location;
  const addressLine = `${loc.street} ${loc.houseNumber}`.trim();
  return {
    id: station.id,
    name: station.name,
    status: station.status,
    locationId: loc.id,
    city: loc.city,
    addressLine,
    createdAt: station.createdAt.toISOString(),
    updatedAt: station.updatedAt.toISOString(),
    ports: station.ports.map((p) => ({
      id: p.id,
      portNumber: p.portNumber,
      maxPower: Number(p.maxPower),
      connectorCategory: p.connectorType?.name ?? null,
      status: p.status,
    })),
  };
}

export const stationService = {
  async getStationDashboard(stationId: number): Promise<StationDashboardDto | null> {
    const station = await stationRepository.findByIdWithPorts(stationId);
    if (!station) {
      return null;
    }
    return toDashboardDto(station);
  },

  async getAllStations(): Promise<StationDashboardDto[]> {
    const stations = await stationRepository.findAll();
    return stations.map(toDashboardDto);
  },
};
