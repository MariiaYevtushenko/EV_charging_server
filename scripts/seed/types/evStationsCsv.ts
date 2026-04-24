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


export type ConnectorCode =
  | "TYPE_2"
  | "CCS_2"
  | "CHADEMO"
  | "TESLA_SUPERCHARGER";

  
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
