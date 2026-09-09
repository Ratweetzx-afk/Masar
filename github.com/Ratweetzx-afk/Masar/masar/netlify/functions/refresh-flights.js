'use strict';

const {
  getSupabase,
  isValidAirportCode,
  sanitizeFlightRecord,
  verifySession,
  jsonResponse,
} = require('../lib/utils');

// ICAO codes — AeroDataBox's FIDS endpoint expects these, not IATA.
const ICAO_BY_IATA = { JED: 'OEJN', RUH: 'OERK', DMM: 'OEDF' };

/**
 * POST /.netlify/functions/refresh-flights
 * Body: { airport: "JED", secret: "...", trigger: "cron" | "admin" }
 *
 * QUOTA MATH (see README for the full breakdown):
 *   - Free plan: 600 AeroDataBox units/month.
 *   - This function is called AT MOST once/day per airport by an
 *     external free cron (cron-job.org) — 3 calls/day, 90/month.
 *   - Manual "refresh now" from the admin panel is capped at 3
 *     extra calls per airport per day (see checkManualRefreshCap).
 *   - Worst-case assumption: 6 units/call (Tier 3) →
 *     even at the manual cap fully used every day:
 *     (1 auto + 3 manual) × 3 airports × 30 days × 6 units = 2,160 —
 *     THIS WOULD BLOW THE BUDGET if manual refresh is overused.
 *     The manual cap is a soft safety valve for real incidents
 *     (e.g. a big delay day), not a routine feature — see the
 *     admin UI copy that says so explicitly.
 */
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const { airport, secret, trigger } = body;

  // Auth: either the cron secret (external scheduler hitting this
  // on the daily schedule) OR a valid admin session token (the
  // "refresh now" button in the dashboard) — either is sufficient,
  // neither alone is required to satisfy both.
  const isCronAuthorized = secret && secret === process.env.REFRESH_SECRET;
  const authHeader = event.headers['authorization'] || '';
  const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const session = verifySession(sessionToken);
  const isAdminAuthorized = session?.role === 'admin';

  if (!isCronAuthorized && !isAdminAuthorized) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  if (!isValidAirportCode(airport)) {
    return jsonResponse(400, { error: 'Invalid airport code' });
  }

  const supabase = getSupabase();

  // Manual-refresh daily cap (only enforced when trigger === 'admin').
  if (trigger === 'admin') {
    const { data: allowed, error: rlError } = await supabase.rpc('check_rate_limit', {
      p_key: `manual-refresh:${airport}:${new Date().toISOString().slice(0, 10)}`,
      p_max_requests: 3,
      p_window_seconds: 86400,
    });
    if (rlError) {
      console.error('rate limit check failed:', rlError.message);
      return jsonResponse(500, { error: 'Rate limit check failed' });
    }
    if (!allowed) {
      return jsonResponse(429, { error: 'Manual refresh limit reached for this airport today (max 3).' });
    }
  }

  try {
    const flights = await fetchFromAeroDataBox(ICAO_BY_IATA[airport]);

    const { error: upsertError } = await supabase
      .from('flights_cache')
      .upsert({ airport_code: airport, data: flights, fetched_at: new Date().toISOString() });

    if (upsertError) throw upsertError;

    return jsonResponse(200, { airport, count: flights.length, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('refresh-flights error:', err.message);
    return jsonResponse(502, { error: 'Failed to fetch flight data from provider' });
  }
};

async function fetchFromAeroDataBox(icaoCode) {
  // One call covers both directions for a ~12h window — chosen to
  // stay at 1 call per airport per refresh (not 2), which is the
  // single biggest lever on staying under quota.
  const url = `https://aerodatabox.p.rapidapi.com/flights/airports/icao/${icaoCode}?offsetMinutes=-120&durationMinutes=720&withLeg=false&direction=Both&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`;

  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': process.env.AERODATABOX_API_KEY,
      'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
    },
  });

  if (!res.ok) {
    throw new Error(`AeroDataBox responded ${res.status}`);
  }

  const json = await res.json();
  const departures = (json.departures || []).map((f) => mapFlight(f, 'Departure'));
  const arrivals = (json.arrivals || []).map((f) => mapFlight(f, 'Arrival'));

  return [...departures, ...arrivals]
    .map(sanitizeFlightRecord)
    .sort((a, b) => new Date(a.scheduledTime || 0) - new Date(b.scheduledTime || 0));
}

function mapFlight(f, direction) {
  const other = direction === 'Departure' ? f.arrival : f.departure;
  return {
    flightNumber: f.number,
    airline: f.airline?.name || 'Unknown',
    scheduledTime: (direction === 'Departure' ? f.departure : f.arrival)?.scheduledTime?.local,
    actualTime: (direction === 'Departure' ? f.departure : f.arrival)?.revisedTime?.local,
    status: mapStatus(f.status),
    gate: (direction === 'Departure' ? f.departure : f.arrival)?.gate,
    terminal: (direction === 'Departure' ? f.departure : f.arrival)?.terminal,
    direction,
    otherAirport: other?.airport?.name || '',
  };
}

function mapStatus(rawStatus) {
  const map = {
    Expected: 'scheduled',
    EnRoute: 'departed',
    Departed: 'departed',
    Delayed: 'delayed',
    Arrived: 'landed',
    Landed: 'landed',
    Boarding: 'boarding',
    GateClosed: 'gate_closed',
    Canceled: 'cancelled',
    Cancelled: 'cancelled',
    Diverted: 'diverted',
    Unknown: 'unknown',
  };
  return map[rawStatus] || 'unknown';
}
