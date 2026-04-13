/** ENTSO-E та сумісні API: `securityToken` у query; токен з TARIFF_API_TOKEN або TOKEN. */
export function buildTariffApiUrl(
  baseUrl: string,
  extraParams?: Record<string, string>
): string {
  const token =
    process.env["TARIFF_API_TOKEN"]?.trim() ||
    process.env["ENTSOE_SECURITY_TOKEN"]?.trim() ||
    process.env["TOKEN"]?.trim();
  const requestUrl = new URL(baseUrl);
  if (token && !requestUrl.searchParams.has("securityToken")) {
    requestUrl.searchParams.set("securityToken", token);
  }
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      requestUrl.searchParams.set(key, value);
    }
  }
  return requestUrl.toString();
}
