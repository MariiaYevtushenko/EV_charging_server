/** Дефолтний діапазон потужності порту (кВт) для API та спрощених DTO. */
export const DEFAULT_PORT_MAX_POWER_KW_MIN = 20;
export const DEFAULT_PORT_MAX_POWER_KW_MAX = 150;

/** Ціле кВт у межах [min, max] — коли з клієнта не передано maxPower. */
export function randomDefaultPortMaxPowerKw(): number {
  const span = DEFAULT_PORT_MAX_POWER_KW_MAX - DEFAULT_PORT_MAX_POWER_KW_MIN + 1;
  return DEFAULT_PORT_MAX_POWER_KW_MIN + Math.floor(Math.random() * span);
}
