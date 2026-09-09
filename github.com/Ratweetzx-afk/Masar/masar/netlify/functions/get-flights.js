'use strict';

const { getSupabase, isValidAirportCode, jsonResponse } = require('../lib/utils');

/**
 * GET /.netlify/functions/get-flights?airport=JED
 *
 * This is what the browser calls. It ONLY reads the last cached
 * snapshot from Supabase — it never touches AeroDataBox. That
 * separation is what makes visitor traffic free: 10 visitors or
 * 10,000, this function's cost is a Supabase read either way,
 * and Supabase's free tier read quota is far more generous than
 * AeroDataBox's 600 units/month.
 */
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const airport = (event.queryStringParameters?.airport || '').toUpperCase();
  if (!isValidAirportCode(airport)) {
    return jsonResponse(400, { error: 'Invalid airport code. Use JED, RUH, or DMM.' });
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('flights_cache')
      .select('data, fetched_at')
      .eq('airport_code', airport)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return jsonResponse(200, {
        airport,
        flights: [],
        fetchedAt: null,
        message: 'No data yet — the first daily refresh has not run.',
      });
    }

    return jsonResponse(
      200,
      { airport, flights: data.data, fetchedAt: data.fetched_at },
      // Browsers/CDN may cache this for a short time — harmless since
      // the underlying data itself only changes once a day.
      { 'Cache-Control': 'public, max-age=300' },
    );
  } catch (err) {
    console.error('get-flights error:', err.message);
    return jsonResponse(500, { error: 'Unable to load flight data right now.' });
  }
};
