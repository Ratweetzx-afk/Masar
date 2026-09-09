'use strict';

const {
  getSupabase,
  verifyPassword,
  signSession,
  getClientIp,
  jsonResponse,
} = require('../lib/utils');

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

  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 200) {
    return jsonResponse(400, { error: 'Invalid request' });
  }

  const supabase = getSupabase();
  const ip = getClientIp(event);

  // Per-IP rate limit on TOP OF the account-level lockout below —
  // stops an attacker from hammering the endpoint itself even
  // before hitting the 5-attempt account lockout.
  const { data: ipAllowed } = await supabase.rpc('check_rate_limit', {
    p_key: `admin-login:${ip}`,
    p_max_requests: 10,
    p_window_seconds: 600,
  });
  if (ipAllowed === false) {
    return jsonResponse(429, { error: 'Too many attempts from this network — try later.' });
  }

  const { data: authRow, error: fetchError } = await supabase
    .from('admin_auth')
    .select('password_hash, password_salt, locked_until')
    .eq('id', 1)
    .maybeSingle();

  if (fetchError || !authRow) {
    console.error('admin_auth fetch failed:', fetchError?.message);
    return jsonResponse(500, { error: 'Authentication temporarily unavailable' });
  }

  if (authRow.locked_until && new Date(authRow.locked_until) > new Date()) {
    return jsonResponse(423, {
      error: 'Account locked due to repeated failed attempts. Try again later.',
      lockedUntil: authRow.locked_until,
    });
  }

  const isValid = verifyPassword(password, authRow.password_salt, authRow.password_hash);

  // Atomic: this single RPC call both checks the current lockout
  // state and records this attempt's result, with a row lock —
  // no window for two concurrent requests to both slip through
  // between "check" and "increment".
  const { data: lockoutResult, error: rpcError } = await supabase
    .rpc('register_login_attempt', { p_success: isValid })
    .maybeSingle();

  if (rpcError) {
    console.error('register_login_attempt failed:', rpcError.message);
    return jsonResponse(500, { error: 'Authentication temporarily unavailable' });
  }

  if (lockoutResult?.is_locked) {
    return jsonResponse(423, {
      error: 'Account locked due to repeated failed attempts. Try again later.',
      lockedUntil: lockoutResult.locked_until,
    });
  }

  if (!isValid) {
    return jsonResponse(401, { error: 'Incorrect password', attemptsRemaining: 5 - (lockoutResult?.attempts ?? 0) });
  }

  const token = signSession({ role: 'admin' }, 3600); // 1-hour session
  return jsonResponse(200, { token, expiresIn: 3600 });
};
