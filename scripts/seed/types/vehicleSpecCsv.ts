/** Рядок `electric_vehicles_spec_*.csv` (гнучкі поля). */
export type CsvVehicleRow = {
  brand?: string;
  model?: string;
  battery_capacity_kWh?: string;
  battery_capacity_kwh?: string;
};

/** Результат сидування авто з CSV. */
export type SeedVehiclesFromCsvResult = {
  inserted: number;
  skippedUsers: number;
  specRows: number;
};
