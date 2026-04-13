import { stationRepository } from "../db/stationRepository.js";
import type { Prisma, Station, StationStatus } from "../../generated/prisma/index.js";

/** DTO для REST — відповідає таблицям station + location + port (DB_script.MD) */
export type StationDashboardDto = {
  id: number;
  name: string;
  status: string;
  locationId: number;
  country: string;
  city: string;
  addressLine: string;
  lat: number | null;
  lng: number | null;
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
      select: { id: true; country: true; city: true; street: true; houseNumber: true };
    };
    ports: { include: { connectorType: true } };
  };
}>;

function toDashboardDto(
  station: StationWithLocationPorts,
  coords: { lat: number; lng: number } | null | undefined
): StationDashboardDto {
  const loc = station.location;
  const addressLine = `${loc.street} ${loc.houseNumber}`.trim();
  return {
    id: station.id,
    name: station.name,
    status: station.status,
    locationId: loc.id,
    country: loc.country,
    city: loc.city,
    addressLine,
    lat: coords ? coords.lat : null,
    lng: coords ? coords.lng : null,
    createdAt: station.createdAt.toISOString(),
    updatedAt: station.updatedAt.toISOString(),
    ports: station.ports.map((p) => ({
      // Стабільний числовий id для API: stationId * 10000 + port_number (порт ідентифікується парою station_id + port_number у БД)
      id: station.id * 10000 + p.portNumber,
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
    const coords = await stationRepository.getLocationCoords(station.locationId);
    return toDashboardDto(station, coords);
  },

  async getAllStations(): Promise<StationDashboardDto[]> {
    const stations = await stationRepository.findAll();
    const coordMap = await stationRepository.getLocationCoordsBatch(
      stations.map((s) => s.locationId)
    );
    return stations.map((s) => toDashboardDto(s, coordMap.get(s.locationId) ?? null));
  },

  /** Усі станції для карти (без портів) — лише для адмін-утиліт; для UI карти краще `getStationsForMapInBounds`. */
  async getStationsForMap(): Promise<StationDashboardDto[]> {
    const stations = await stationRepository.findAllWithLocationOnly();
    const coordMap = await stationRepository.getLocationCoordsBatch(
      stations.map((s) => s.locationId)
    );
    return stations.map((s) =>
      toDashboardDto(
        { ...s, ports: [] } as StationWithLocationPorts,
        coordMap.get(s.locationId) ?? null
      )
    );
  },

  /** Станції у прямокутнику видимої області карти (bbox), без портів. */
  async getStationsForMapInBounds(
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number,
    limit: number
  ): Promise<StationDashboardDto[]> {
    const rows = await stationRepository.findIdsWithLocationInBounds(
      minLat,
      maxLat,
      minLng,
      maxLng,
      limit
    );
    return rows.map((r) => {
      const addressLine = `${r.street} ${r.house_number}`.trim();
      const codes = r.connector_codes ?? [];
      const ports =
        codes.length > 0
          ? codes.map((name, idx) => ({
              id: r.id * 10000 + idx + 1,
              portNumber: idx + 1,
              maxPower: 22,
              connectorCategory: name,
              status: "FREE",
            }))
          : [];
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        locationId: r.location_id,
        country: r.country,
        city: r.city,
        addressLine,
        lat: r.lat,
        lng: r.lng,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
        ports,
      };
    });
  },

  /** Пагінація списку станцій + унікальні міста для фільтрів. */
  async getStationsPage(
    skip: number,
    take: number,
    page: number,
    pageSize: number
  ): Promise<{
    items: StationDashboardDto[];
    total: number;
    page: number;
    pageSize: number;
    cities: string[];
  }> {
    const [total, stations, cities] = await Promise.all([
      stationRepository.countStations(),
      stationRepository.findManyPaginated(skip, take),
      stationRepository.getDistinctCitiesForStations(),
    ]);
    const coordMap = await stationRepository.getLocationCoordsBatch(
      stations.map((s) => s.locationId)
    );
    const items = stations.map((s) => toDashboardDto(s, coordMap.get(s.locationId) ?? null));
    return { items, total, page, pageSize, cities };
  },


  async createStation(station: Station): Promise<Station> {
    return await stationRepository.createStation(station);
  },

  async updateStation(stationId: number, station: Station): Promise<Station> {
    return await stationRepository.updateStation(stationId, station);
  },

  async archiveStation(stationId: number): Promise<Station> {
    return await stationRepository.archiveStation(stationId);
  },

  async unarchiveStation(stationId: number): Promise<Station> {
    return await stationRepository.unarchiveStation(stationId);
  },

  async updateStationStatus(stationId: number, status: StationStatus): Promise<Station> {
    return await stationRepository.updateStationStatus(stationId, status);
  },  
};
