// Booking pages opened with the trip already filled in, across the major
// search sites and the airlines, hotels and rental companies the family has
// accounts with. Atlas cannot pay for anything: airlines and hotels offer no
// booking API to a personal app, so it prepares the search and the traveler
// signs in and finishes checkout on the site (earning their miles and points).

export interface FlightSearch {
  from: string; // IATA code
  to: string;
  depart: string; // YYYY-MM-DD
  return?: string | null;
  adults: number;
  cabin?: "economy" | "premium" | "business" | "first";
}

export interface HotelSearch {
  destination: string; // city, neighborhood, address or hotel name
  check_in: string;
  check_out: string;
  adults: number;
  rooms?: number;
}

export interface CarSearch {
  pickup: string; // airport code or city
  pickup_at: string; // YYYY-MM-DDTHH:MM
  dropoff_at: string;
  dropoff?: string | null; // when returned elsewhere
}

export interface BookingLink {
  label: string;
  url: string;
}

export interface FlightLinks {
  search: BookingLink[];
  /** Book direct to earn miles and status; the traveler signs in and enters the trip. */
  airlines: BookingLink[];
}

const KAYAK_CABIN = { economy: "", premium: "/premium", business: "/business", first: "/first" } as const;
const SKYSCANNER_CABIN = { economy: "economy", premium: "premiumeconomy", business: "business", first: "first" } as const;

const AIRLINES: BookingLink[] = [
  { label: "American Airlines", url: "https://www.aa.com/booking/find-flights" },
  { label: "Delta", url: "https://www.delta.com/flight-search/book-a-flight" },
  { label: "Southwest", url: "https://www.southwest.com/air/booking/" },
  { label: "JetBlue", url: "https://www.jetblue.com/booking/flights" },
  { label: "Alaska Airlines", url: "https://www.alaskaair.com/search" },
  { label: "Qatar Airways", url: "https://www.qatarairways.com/en-us/homepage.html" },
  { label: "Air France", url: "https://wwws.airfrance.us/" },
];

function mdY(date: string): string {
  const [y, m, d] = date.split("-");
  return `${m}/${d}/${y}`;
}

function yymmdd(date: string): string {
  return date.replace(/-/g, "").slice(2);
}

export function flightLinks(s: FlightSearch): FlightLinks {
  const from = s.from.toUpperCase();
  const to = s.to.toUpperCase();
  const adults = Math.max(1, Math.min(9, Math.round(s.adults)));
  const cabin = s.cabin ?? "economy";
  const words = [
    `Flights from ${from} to ${to} on ${s.depart}`,
    s.return ? `returning ${s.return}` : "one way",
    `${adults} adult${adults > 1 ? "s" : ""}`,
    cabin === "economy" ? "" : `${cabin} class`,
  ].filter(Boolean);
  const kayakDates = s.return ? `${s.depart}/${s.return}` : s.depart;
  const skyscanner = `https://www.skyscanner.com/transport/flights/${from.toLowerCase()}/${to.toLowerCase()}/${yymmdd(s.depart)}/${s.return ? `${yymmdd(s.return)}/` : ""}?adultsv2=${adults}&cabinclass=${SKYSCANNER_CABIN[cabin]}`;
  const expediaLegs = [`leg1=${encodeURIComponent(`from:${from},to:${to},departure:${mdY(s.depart)}TANYT`)}`];
  if (s.return) expediaLegs.push(`leg2=${encodeURIComponent(`from:${to},to:${from},departure:${mdY(s.return)}TANYT`)}`);
  const united = new URLSearchParams({ f: from, t: to, d: s.depart, px: String(adults), tqp: s.return ? "R" : "O" });
  if (s.return) united.set("r", s.return);
  return {
    search: [
      { label: "Google Flights", url: `https://www.google.com/travel/flights?q=${encodeURIComponent(words.join(" "))}` },
      { label: "Kayak", url: `https://www.kayak.com/flights/${from}-${to}/${kayakDates}${KAYAK_CABIN[cabin]}/${adults}adults?sort=bestflight_a` },
      { label: "Skyscanner", url: skyscanner },
      {
        label: "Expedia",
        url: `https://www.expedia.com/Flights-Search?trip=${s.return ? "roundtrip" : "oneway"}&${expediaLegs.join("&")}&passengers=adults:${adults}&mode=search`,
      },
    ],
    airlines: [{ label: "United (search filled in)", url: `https://www.united.com/en/us/fsr/choose-flights?${united}` }, ...AIRLINES],
  };
}

export function hotelLinks(s: HotelSearch): BookingLink[] {
  const adults = Math.max(1, Math.min(16, Math.round(s.adults)));
  const rooms = Math.max(1, Math.min(8, Math.round(s.rooms ?? 1)));
  const booking = new URLSearchParams({
    ss: s.destination,
    checkin: s.check_in,
    checkout: s.check_out,
    group_adults: String(adults),
    no_rooms: String(rooms),
  });
  const hilton = new URLSearchParams({
    query: s.destination,
    arrivalDate: s.check_in,
    departureDate: s.check_out,
    numAdults: String(adults),
    numRooms: String(rooms),
  });
  const marriott = new URLSearchParams({
    "destinationAddress.destination": s.destination,
    fromDate: s.check_in,
    toDate: s.check_out,
    numAdultsPerRoom: String(Math.ceil(adults / rooms)),
    roomCount: String(rooms),
  });
  const expedia = new URLSearchParams({
    destination: s.destination,
    startDate: s.check_in,
    endDate: s.check_out,
    adults: String(adults),
    rooms: String(rooms),
  });
  const airbnb = new URLSearchParams({ checkin: s.check_in, checkout: s.check_out, adults: String(adults) });
  return [
    { label: "Booking.com (your account)", url: `https://www.booking.com/searchresults.html?${booking}` },
    { label: "Hilton", url: `https://www.hilton.com/en/search/?${hilton}` },
    { label: "Marriott", url: `https://www.marriott.com/search/findHotels.mi?${marriott}` },
    { label: "Expedia", url: `https://www.expedia.com/Hotel-Search?${expedia}` },
    { label: "Airbnb", url: `https://www.airbnb.com/s/${encodeURIComponent(s.destination)}/homes?${airbnb}` },
  ];
}

function kayakPlace(p: string): string {
  const t = p.trim();
  return /^[A-Za-z]{3}$/.test(t) ? t.toUpperCase() : encodeURIComponent(t.replace(/\s*,\s*/g, ",").replace(/\s+/g, "-"));
}

function kayakTime(local: string): string {
  const [date, time = "10:00"] = local.split("T");
  return `${date}-${String(Number(time.slice(0, 2)))}h`;
}

function expediaTime(local: string): string {
  const hour = Number((local.split("T")[1] ?? "10:00").slice(0, 2));
  const h12 = hour % 12 || 12;
  return `${String(h12).padStart(2, "0")}00${hour < 12 ? "AM" : "PM"}`;
}

export function carLinks(s: CarSearch): BookingLink[] {
  const oneWay = s.dropoff && s.dropoff.trim() !== s.pickup.trim();
  const places = oneWay ? `${kayakPlace(s.pickup)}/${kayakPlace(s.dropoff!)}` : kayakPlace(s.pickup);
  const expedia = new URLSearchParams({
    locn: s.pickup,
    date1: mdY(s.pickup_at.slice(0, 10)),
    date2: mdY(s.dropoff_at.slice(0, 10)),
    time1: expediaTime(s.pickup_at),
    time2: expediaTime(s.dropoff_at),
  });
  if (oneWay) expedia.set("loc2", s.dropoff!);
  return [
    { label: "Kayak", url: `https://www.kayak.com/cars/${places}/${kayakTime(s.pickup_at)}/${kayakTime(s.dropoff_at)}?sort=rank_a` },
    { label: "Expedia", url: `https://www.expedia.com/carsearch?${expedia}` },
    { label: "National", url: "https://www.nationalcar.com/en/home.html" },
    { label: "Hertz", url: "https://www.hertz.com/rentacar/reservation/" },
    { label: "Avis", url: "https://www.avis.com/en/home" },
    { label: "Enterprise", url: "https://www.enterprise.com/en/home.html" },
    { label: "Sixt", url: "https://www.sixt.com/" },
  ];
}
