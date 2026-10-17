// The currency used in a country, for the on-trip converter. Countries that
// use the US dollar return "USD", so no converter shows there.

const EURO = [
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
  "AD", "MC", "SM", "VA", "ME", "XK", "GP", "MQ", "GF", "RE", "YT", "MF", "BL", "PM",
];

const USD = ["US", "PR", "VI", "GU", "AS", "MP", "EC", "SV", "PA", "TL", "FM", "MH", "PW", "TC", "VG", "BQ"];

const OTHER: Record<string, string> = {
  GB: "GBP", CH: "CHF", LI: "CHF", CA: "CAD", MX: "MXN", JP: "JPY", QA: "QAR", AE: "AED", SA: "SAR", BH: "BHD",
  KW: "KWD", OM: "OMR", JO: "JOD", IL: "ILS", EG: "EGP", MA: "MAD", TN: "TND", TR: "TRY", ZA: "ZAR", KE: "KES",
  AU: "AUD", NZ: "NZD", CN: "CNY", HK: "HKD", MO: "MOP", TW: "TWD", KR: "KRW", SG: "SGD", MY: "MYR", TH: "THB",
  VN: "VND", ID: "IDR", PH: "PHP", IN: "INR", LK: "LKR", MV: "MVR", SE: "SEK", NO: "NOK", DK: "DKK", IS: "ISK",
  PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", RS: "RSD", AL: "ALL", MK: "MKD", BA: "BAM", UA: "UAH",
  GE: "GEL", AM: "AMD", BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN", UY: "UYU", PY: "PYG", BO: "BOB",
  CR: "CRC", GT: "GTQ", HN: "HNL", NI: "NIO", DO: "DOP", JM: "JMD", BS: "BSD", BB: "BBD", TT: "TTD", KY: "KYD",
  AW: "AWG", CW: "ANG", SX: "ANG", BM: "BMD", BZ: "BZD", HT: "HTG", LC: "XCD", AG: "XCD", DM: "XCD", GD: "XCD",
  KN: "XCD", VC: "XCD", AI: "XCD", SN: "XOF", CI: "XOF", NG: "NGN", GH: "GHS", TZ: "TZS", RW: "RWF", ET: "ETB",
  MU: "MUR", SC: "SCR", PF: "XPF", NC: "XPF",
};

/** ISO 4217 code for an ISO 3166-1 alpha-2 country, or null when unknown. */
export function currencyOf(country: string | null | undefined): string | null {
  if (!country) return null;
  const c = country.toUpperCase();
  if (EURO.includes(c)) return "EUR";
  if (USD.includes(c)) return "USD";
  return OTHER[c] ?? null;
}
