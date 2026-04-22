/**
 * Спільне логування seed-скриптів: ISO-час, тривалість кроків, безпечний вивід помилок PostgreSQL.
 */

export function seedNowIso(): string {
  return new Date().toISOString();
}

type SeedDetailValue = string | number | boolean | null | undefined;

function formatDetail(detail?: Record<string, SeedDetailValue>): string {
  if (detail == null || Object.keys(detail).length === 0) return "";
  return ` ${JSON.stringify(detail)}`;
}

export function seedLog(
  scope: string,
  message: string,
  detail?: Record<string, SeedDetailValue>,
): void {
  console.log(`[${seedNowIso()}] [${scope}] ${message}${formatDetail(detail)}`);
}

export function seedWarn(
  scope: string,
  message: string,
  detail?: Record<string, SeedDetailValue>,
): void {
  console.warn(`[${seedNowIso()}] [${scope}] ${message}${formatDetail(detail)}`);
}

export function seedError(
  scope: string,
  message: string,
  err?: unknown,
  extra?: Record<string, SeedDetailValue>,
): void {
  const pg =
    err != null
      ? (formatSeedPgError(err) as unknown as Record<string, SeedDetailValue>)
      : {};
  const merged = { ...pg, ...extra };
  console.error(
    `[${seedNowIso()}] [${scope}] ${message}${formatDetail(merged)}`,
  );
}

/** Поля типової помилки `node-postgres` / PostgreSQL для діагностики сиду. */
export function formatSeedPgError(err: unknown): Record<string, string> {
  const e = err as {
    message?: string;
    code?: string;
    detail?: string;
    hint?: string;
    position?: string;
    schema?: string;
    table?: string;
    column?: string;
    constraint?: string;
    routine?: string;
  };
  const out: Record<string, string> = {};
  if (e.message != null) out.message = String(e.message);
  if (e.code != null) out.code = String(e.code);
  if (e.detail != null) out.detail = String(e.detail);
  if (e.hint != null) out.hint = String(e.hint);
  if (e.position != null) out.position = String(e.position);
  if (e.schema != null) out.schema = String(e.schema);
  if (e.table != null) out.table = String(e.table);
  if (e.column != null) out.column = String(e.column);
  if (e.constraint != null) out.constraint = String(e.constraint);
  if (e.routine != null) out.routine = String(e.routine);
  if (Object.keys(out).length === 0) out.fallback = String(err);
  return out;
}

/**
 * Таймер для одного пайплайну: `mark("опис")` логує мс від попереднього mark і від старту.
 */
export function createSeedMarkTimer(scope: string) {
  const t0 = performance.now();
  let last = t0;
  return {
    mark(label: string, extra?: Record<string, SeedDetailValue>): void {
      const now = performance.now();
      seedLog(scope, label, {
        ms_since_prev: Math.round(now - last),
        ms_since_start: Math.round(now - t0),
        ...extra,
      });
      last = now;
    },
    elapsedMs(): number {
      return Math.round(performance.now() - t0);
    },
  };
}
