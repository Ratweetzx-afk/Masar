'use strict';

const { getSupabase, jsonResponse } = require('../lib/utils');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const supabase = getSupabase();
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('banners')
      .select('id, title, message, link_url')
      .eq('is_active', true)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return jsonResponse(200, { banner: data || null }, { 'Cache-Control': 'public, max-age=120' });
  } catch (err) {
    console.error('get-banner error:', err.message);
    // Fail soft: a broken banner should never break the whole page.
    return jsonResponse(200, { banner: null });
  }
};
