'use strict';

const { getSupabase, isValidFlightNumber, getClientIp, jsonResponse } = require('../lib/utils');

/**
 * GET /.netlify/functions/search-flight?number=SV101
 *
 * DESIGN DECISION: this searches WITHIN the 3 airports' cached
 * data already fetched by the daily refresh — it does NOT make a
 * fresh AeroDataBox call per search. That's the only way "search"
 * can be offered to unlimited visitors without threatening the
 * 600-unit/month budget. The tradeoff: a flight not currently in
 * the cached ~12h window (e.g. searched a week ahead) won't be
 * found — the UI explains this honestly rather than silently
 * failing.
 */
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const raw = (event.queryStringParameters?.number || '').toUpperCase().trim();
  if (!isValidFlightNumber(raw)) {
    return jsonResponse(400, { error: 'Invalid flight number format' });
  }

  const supabase = getSupabase();
  const ip = getClientIp(event);

  // Light rate limit — search is cheap (DB-only) but still worth
  // capping against scripted scraping of the whole dataset.
  const { data: allowed } = await supabase.rpc('check_rate_limit', {
    p_key: `search:${ip}`,
    p_max_requests: 30,
    p_window_seconds: 600,
  });
  if (allowed === false) {
    return jsonResponse(429, { error: 'Too many searches — please wait a moment.' });
  }

  try {
    const { data: rows, error } = await supabase.from('flights_cache').select('airport_code, data');
    if (error) throw error;

    const results = [];
    for (const row of rows || []) {
      for (const flight of row.data || []) {
        if (flight.flightNumber?.toUpperCase() === raw) {
          results.push({ ...flight, airport: row.airport_code });
        }
      }
    }

    return jsonResponse(200, { query: raw, results });
  } catch (err) {
    console.error('search-flight error:', err.message);
    return jsonResponse(500, { error: 'Search failed' });
  }
};
