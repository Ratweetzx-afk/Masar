'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ── Supabase client (service role — server-side ONLY) ────────
// This key bypasses Row Level Security. It must NEVER be sent to
// the browser — it only ever lives in Netlify's environment
// variables and is read here, inside a function that runs on
// Netlify's servers, not in any file served to visitors.
function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

// ── Session tokens (hand-rolled HMAC, zero extra dependency) ──
// A signed, stateless token: payload + HMAC-SHA256 signature,
// base64url encoded. No JWT library needed, no session table to
// query on every admin request (saves Supabase free-tier reads).
function signSession(payload, ttlSeconds = 3600) {
  const body = { ...payload, exp: Date.now() + ttlSeconds * 1000 };
  const json = JSON.stringify(body);
  const b64 = Buffer.from(json).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(b64)
    .digest('base64url');
  return `${b64}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(b64)
    .digest('base64url');

  // Constant-time comparison — prevents timing side-channels on
  // the signature check.
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) return null; // expired
    return payload;
  } catch {
    return null;
  }
}

// ── Password hashing (Node's built-in scrypt — no dependency) ─
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  const actualHash = hashPassword(password, salt);
  const a = Buffer.from(actualHash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Input validation ──────────────────────────────────────────
const AIRPORT_CODES = new Set(['JED', 'RUH', 'DMM']);

function isValidAirportCode(code) {
  return typeof code === 'string' && AIRPORT_CODES.has(code.toUpperCase());
}

// IATA/ICAO flight numbers: 2 letters/digits airline prefix + up
// to 4 digits + optional letter suffix, e.g. "SV101", "XY1234A".
const FLIGHT_NUMBER_RE = /^[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?$/;

function isValidFlightNumber(input) {
  return typeof input === 'string' && input.length <= 10 && FLIGHT_NUMBER_RE.test(input.toUpperCase());
}

// ── Output sanitization (defense-in-depth against stored XSS) ─
// Even though the frontend renders with textContent (see app.js),
// data is sanitized here too — belt and suspenders, since this
// JSON could theoretically be consumed by another client later.
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFlightRecord(f) {
  return {
    flightNumber: escapeHtml(String(f.flightNumber ?? '').slice(0, 10)),
    airline: escapeHtml(String(f.airline ?? '').slice(0, 100)),
    scheduledTime: f.scheduledTime ?? null,
    actualTime: f.actualTime ?? null,
    status: escapeHtml(String(f.status ?? 'unknown').slice(0, 30)),
    gate: f.gate ? escapeHtml(String(f.gate).slice(0, 10)) : null,
    terminal: f.terminal ? escapeHtml(String(f.terminal).slice(0, 10)) : null,
    direction: f.direction === 'Arrival' ? 'Arrival' : 'Departure',
    otherAirport: escapeHtml(String(f.otherAirport ?? '').slice(0, 100)),
  };
}

// ── Client IP (for rate limiting) ─────────────────────────────
function getClientIp(event) {
  const forwarded = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'];
  return (forwarded || 'unknown').split(',')[0].trim();
}

// ── Standard JSON response helper with security headers ──────
function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

module.exports = {
  getSupabase,
  signSession,
  verifySession,
  hashPassword,
  verifyPassword,
  isValidAirportCode,
  isValidFlightNumber,
  escapeHtml,
  sanitizeFlightRecord,
  getClientIp,
  jsonResponse,
  AIRPORT_CODES,
};
