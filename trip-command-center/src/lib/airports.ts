// Offline airport lookup so flight segments get a reliable IANA zone and
// coordinates without a network call. Anything missing here falls back to
// Open-Meteo geocoding by city (see lib/geo.ts).

export interface Airport {
  code: string;
  name: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2
  tz: string;
  lat: number;
  lng: number;
}

type Row = [string, string, string, string, string, number, number];

const ROWS: Row[] = [
  // Home base and Florida
  ["SRQ", "Sarasota Bradenton International", "Sarasota", "US", "America/New_York", 27.3954, -82.5544],
  ["TPA", "Tampa International", "Tampa", "US", "America/New_York", 27.9755, -82.5332],
  ["PIE", "St. Pete-Clearwater International", "Clearwater", "US", "America/New_York", 27.9102, -82.6874],
  ["MCO", "Orlando International", "Orlando", "US", "America/New_York", 28.4312, -81.3081],
  ["MIA", "Miami International", "Miami", "US", "America/New_York", 25.7959, -80.2871],
  ["FLL", "Fort Lauderdale-Hollywood International", "Fort Lauderdale", "US", "America/New_York", 26.0742, -80.1506],
  ["RSW", "Southwest Florida International", "Fort Myers", "US", "America/New_York", 26.5362, -81.7552],
  ["JAX", "Jacksonville International", "Jacksonville", "US", "America/New_York", 30.4941, -81.6879],
  ["TLH", "Tallahassee International", "Tallahassee", "US", "America/New_York", 30.3965, -84.3503],
  // US
  ["ATL", "Hartsfield-Jackson Atlanta International", "Atlanta", "US", "America/New_York", 33.6407, -84.4277],
  ["CLT", "Charlotte Douglas International", "Charlotte", "US", "America/New_York", 35.2144, -80.9473],
  ["RDU", "Raleigh-Durham International", "Raleigh", "US", "America/New_York", 35.8801, -78.788],
  ["IAD", "Washington Dulles International", "Washington", "US", "America/New_York", 38.9531, -77.4565],
  ["DCA", "Ronald Reagan Washington National", "Washington", "US", "America/New_York", 38.8512, -77.0402],
  ["BWI", "Baltimore/Washington International", "Baltimore", "US", "America/New_York", 39.1774, -76.6684],
  ["PHL", "Philadelphia International", "Philadelphia", "US", "America/New_York", 39.8744, -75.2424],
  ["JFK", "John F. Kennedy International", "New York", "US", "America/New_York", 40.6413, -73.7781],
  ["LGA", "LaGuardia", "New York", "US", "America/New_York", 40.7769, -73.874],
  ["EWR", "Newark Liberty International", "Newark", "US", "America/New_York", 40.6895, -74.1745],
  ["BOS", "Boston Logan International", "Boston", "US", "America/New_York", 42.3656, -71.0096],
  ["DTW", "Detroit Metropolitan Wayne County", "Detroit", "US", "America/Detroit", 42.2162, -83.3554],
  ["ORD", "Chicago O'Hare International", "Chicago", "US", "America/Chicago", 41.9742, -87.9073],
  ["MDW", "Chicago Midway International", "Chicago", "US", "America/Chicago", 41.7868, -87.7522],
  ["MSP", "Minneapolis-Saint Paul International", "Minneapolis", "US", "America/Chicago", 44.8848, -93.2223],
  ["DFW", "Dallas/Fort Worth International", "Dallas", "US", "America/Chicago", 32.8998, -97.0403],
  ["IAH", "George Bush Intercontinental", "Houston", "US", "America/Chicago", 29.9902, -95.3368],
  ["AUS", "Austin-Bergstrom International", "Austin", "US", "America/Chicago", 30.1975, -97.6664],
  ["MSY", "Louis Armstrong New Orleans International", "New Orleans", "US", "America/Chicago", 29.9934, -90.258],
  ["BNA", "Nashville International", "Nashville", "US", "America/Chicago", 36.1263, -86.6774],
  ["DEN", "Denver International", "Denver", "US", "America/Denver", 39.8561, -104.6737],
  ["PHX", "Phoenix Sky Harbor International", "Phoenix", "US", "America/Phoenix", 33.4352, -112.0101],
  ["LAS", "Harry Reid International", "Las Vegas", "US", "America/Los_Angeles", 36.084, -115.1537],
  ["LAX", "Los Angeles International", "Los Angeles", "US", "America/Los_Angeles", 33.9416, -118.4085],
  ["SAN", "San Diego International", "San Diego", "US", "America/Los_Angeles", 32.7338, -117.1933],
  ["SFO", "San Francisco International", "San Francisco", "US", "America/Los_Angeles", 37.6213, -122.379],
  ["SEA", "Seattle-Tacoma International", "Seattle", "US", "America/Los_Angeles", 47.4502, -122.3088],
  ["HNL", "Daniel K. Inouye International", "Honolulu", "US", "Pacific/Honolulu", 21.3245, -157.9251],
  // Caribbean and Latin America
  ["SJU", "Luis Munoz Marin International", "San Juan", "PR", "America/Puerto_Rico", 18.4394, -66.0018],
  ["STT", "Cyril E. King", "St. Thomas", "VI", "America/St_Thomas", 18.3373, -64.9734],
  ["STX", "Henry E. Rohlsen", "St. Croix", "VI", "America/St_Thomas", 17.7019, -64.7986],
  ["NAS", "Lynden Pindling International", "Nassau", "BS", "America/Nassau", 25.039, -77.4662],
  ["CUN", "Cancun International", "Cancun", "MX", "America/Cancun", 21.0365, -86.8771],
  ["MEX", "Mexico City International", "Mexico City", "MX", "America/Mexico_City", 19.4361, -99.0719],
  ["BOG", "El Dorado International", "Bogota", "CO", "America/Bogota", 4.7016, -74.1469],
  ["PTY", "Tocumen International", "Panama City", "PA", "America/Panama", 9.0714, -79.3835],
  // Canada
  ["YYZ", "Toronto Pearson International", "Toronto", "CA", "America/Toronto", 43.6777, -79.6248],
  ["YUL", "Montreal-Trudeau International", "Montreal", "CA", "America/Toronto", 45.4706, -73.7408],
  ["YVR", "Vancouver International", "Vancouver", "CA", "America/Vancouver", 49.1967, -123.1815],
  // Europe
  ["CDG", "Paris Charles de Gaulle", "Paris", "FR", "Europe/Paris", 49.0097, 2.5479],
  ["ORY", "Paris Orly", "Paris", "FR", "Europe/Paris", 48.7262, 2.3652],
  ["NCE", "Nice Cote d'Azur", "Nice", "FR", "Europe/Paris", 43.6584, 7.2159],
  ["LYS", "Lyon-Saint Exupery", "Lyon", "FR", "Europe/Paris", 45.7256, 5.0811],
  ["LHR", "London Heathrow", "London", "GB", "Europe/London", 51.47, -0.4543],
  ["LGW", "London Gatwick", "London", "GB", "Europe/London", 51.1537, -0.1821],
  ["DUB", "Dublin", "Dublin", "IE", "Europe/Dublin", 53.4264, -6.2499],
  ["AMS", "Amsterdam Schiphol", "Amsterdam", "NL", "Europe/Amsterdam", 52.3105, 4.7683],
  ["BRU", "Brussels", "Brussels", "BE", "Europe/Brussels", 50.901, 4.4844],
  ["FRA", "Frankfurt", "Frankfurt", "DE", "Europe/Berlin", 50.0379, 8.5622],
  ["MUC", "Munich", "Munich", "DE", "Europe/Berlin", 48.3537, 11.775],
  ["ZRH", "Zurich", "Zurich", "CH", "Europe/Zurich", 47.4582, 8.5555],
  ["GVA", "Geneva", "Geneva", "CH", "Europe/Zurich", 46.2381, 6.109],
  ["MAD", "Adolfo Suarez Madrid-Barajas", "Madrid", "ES", "Europe/Madrid", 40.4983, -3.5676],
  ["BCN", "Barcelona-El Prat", "Barcelona", "ES", "Europe/Madrid", 41.2974, 2.0833],
  ["LIS", "Lisbon Humberto Delgado", "Lisbon", "PT", "Europe/Lisbon", 38.7742, -9.1342],
  ["FCO", "Rome Fiumicino", "Rome", "IT", "Europe/Rome", 41.8003, 12.2389],
  ["MXP", "Milan Malpensa", "Milan", "IT", "Europe/Rome", 45.6306, 8.7281],
  ["CPH", "Copenhagen", "Copenhagen", "DK", "Europe/Copenhagen", 55.618, 12.656],
  ["IST", "Istanbul", "Istanbul", "TR", "Europe/Istanbul", 41.2753, 28.7519],
];

const AIRPORTS = new Map<string, Airport>(
  ROWS.map(([code, name, city, country, tz, lat, lng]) => [
    code,
    { code, name, city, country, tz, lat, lng },
  ]),
);

export function lookupAirport(code: string | null | undefined): Airport | null {
  if (!code) return null;
  return AIRPORTS.get(code.trim().toUpperCase()) ?? null;
}
