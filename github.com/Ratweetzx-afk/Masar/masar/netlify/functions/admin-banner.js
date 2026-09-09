'use strict';

const { getSupabase, verifySession, escapeHtml, jsonResponse } = require('../lib/utils');

const MAX_TITLE = 100;
const MAX_MESSAGE = 500;

exports.handler = async (event) => {
  const auth = event.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const session = verifySession(token);

  if (!session || session.role !== 'admin') {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase.from('banners').select('*').order('created_at', { ascending: false });
    if (error) return jsonResponse(500, { error: 'Failed to load banners' });
    return jsonResponse(200, { banners: data });
  }

  if (event.httpMethod === 'POST') {
    // Request body size guard — banners are small; reject anything
    // suspiciously large before even parsing.
    if ((event.body || '').length > 5000) {
      return jsonResponse(413, { error: 'Request too large' });
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON body' });
    }

    const title = String(body.title || '').slice(0, MAX_TITLE).trim();
    const message = String(body.message || '').slice(0, MAX_MESSAGE).trim();
    const linkUrl = body.linkUrl ? String(body.linkUrl).slice(0, 500).trim() : null;

    if (!title || !message) {
      return jsonResponse(400, { error: 'title and message are required' });
    }
    if (linkUrl && !/^https:\/\//.test(linkUrl)) {
      return jsonResponse(400, { error: 'linkUrl must start with https://' });
    }

    const record = {
      title: escapeHtml(title),
      message: escapeHtml(message),
      link_url: linkUrl,
      is_active: Boolean(body.isActive),
      starts_at: body.startsAt || null,
      ends_at: body.endsAt || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = body.id
      ? await supabase.from('banners').update(record).eq('id', body.id).select().maybeSingle()
      : await supabase.from('banners').insert(record).select().maybeSingle();

    if (error) return jsonResponse(500, { error: 'Failed to save banner' });
    return jsonResponse(200, { banner: data });
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return jsonResponse(400, { error: 'id is required' });

    const { error } = await supabase.from('banners').delete().eq('id', id);
    if (error) return jsonResponse(500, { error: 'Failed to delete banner' });
    return jsonResponse(200, { success: true });
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};
