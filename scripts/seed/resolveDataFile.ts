import fs from "node:fs";
import path from "node:path";

/** Каталоги, де шукаємо CSV відносно `server/` (пріоритет: `data`, потім `CSV_data`). */
export function getDataSearchDirs(serverRoot: string): string[] {
  return [path.join(serverRoot, "data"), path.join(serverRoot, "CSV_data")];
}

/**
 * Перший існуючий файл зі списку імен у будь-якому з каталогів пошуку.
 */
export function resolveDataFile(
  serverRoot: string,
  baseNames: readonly string[],
): string {
  const dirs = getDataSearchDirs(serverRoot);
  for (const dir of dirs) {
    for (const name of baseNames) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error(
    `Не знайдено жодного з файлів: ${baseNames.join(", ")}. Шукали в: ${dirs.join("; ")}. Покладіть CSV у server/data або server/CSV_data.`,
  );
}
