/** Рядок `ev_stations_*.csv` (гнучкі поля). */
export type EvStationCsvRow = {
  id?: string | number;
  title?: string;
  town?: string;
  address?: string;
  lat?: string | number;
  lon?: string | number;
  country?: string;
  num_connectors?: string | number;
  connector_types?: string;
};

/** Коди конекторів у `connector_type.name`, узгоджені з сидом портів. */
export type ConnectorCode =
  | "TYPE_2"
  | "CCS_2"
  | "CHADEMO"
  | "TESLA_SUPERCHARGER";

/** Поля локації/станції з одного рядка ev_stations CSV (після нормалізації для сиду). */
export type StationLocationDataFromRow = {
  extId: number;
  title: string;
  town: string;
  lat: number;
  lon: number;
  street: string;
  houseNumber: string;
  country: string;
};
