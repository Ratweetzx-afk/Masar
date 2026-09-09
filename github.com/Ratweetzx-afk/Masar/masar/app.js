'use strict';

const state = {
  airport: 'JED',
  direction: 'All',
  flightsByAirport: {},
};

const STATUS_LABELS_AR = {
  scheduled: 'في الوقت',
  delayed: 'متأخرة',
  departed: 'أُقلعت',
  landed: 'هبطت',
  boarding: 'الصعود جارٍ',
  gate_closed: 'أُغلقت البوابة',
  cancelled: 'أُلغيت',
  diverted: 'تحويل مسار',
  unknown: 'غير معروف',
};

// ── DOM refs ─────────────────────────────────────────────────
const flightListEl = document.getElementById('flight-list');
const lastUpdatedEl = document.getElementById('last-updated');
const searchResultsEl = document.getElementById('search-results');
const tabs = document.querySelectorAll('.tab');
const chips = document.querySelectorAll('.chip');

// ── Tab / filter wiring ──────────────────────────────────────
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.setAttribute('aria-selected', 'false'));
    tab.setAttribute('aria-selected', 'true');
    state.airport = tab.dataset.airport;
    loadAirport(state.airport);
  });
});

chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    chips.forEach((c) => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');
    state.direction = chip.dataset.direction;
    renderFlights();
  });
});

// ── Search ───────────────────────────────────────────────────
document.getElementById('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('search-input');
  const value = input.value.trim().toUpperCase();
  if (!value) return;

  searchResultsEl.hidden = false;
  clearChildren(searchResultsEl);
  searchResultsEl.appendChild(el('p', 'search-results__title', 'جارٍ البحث...'));

  try {
    const res = await fetch(`/.netlify/functions/search-flight?number=${encodeURIComponent(value)}`);
    const data = await res.json();

    clearChildren(searchResultsEl);
    if (!res.ok) {
      searchResultsEl.appendChild(el('p', 'search-results__title', data.error || 'حدث خطأ في البحث'));
      return;
    }

    if (!data.results || data.results.length === 0) {
      searchResultsEl.appendChild(
        el('p', 'search-results__title', `لم يتم العثور على رحلة "${value}" ضمن الجدول الحالي المخزّن.`),
      );
      return;
    }

    searchResultsEl.appendChild(el('p', 'search-results__title', `نتائج البحث عن "${value}"`));
    data.results.forEach((flight) => searchResultsEl.appendChild(buildFlightRow(flight, true)));
  } catch (err) {
    clearChildren(searchResultsEl);
    searchResultsEl.appendChild(el('p', 'search-results__title', 'تعذّر إتمام البحث الآن.'));
  }
});

// ── Data loading ─────────────────────────────────────────────
async function loadAirport(code) {
  clearChildren(flightListEl);
  flightListEl.appendChild(el('p', 'board__empty', 'جاري تحميل بيانات الرحلات...'));
  lastUpdatedEl.textContent = 'جاري التحميل...';

  try {
    const res = await fetch(`/.netlify/functions/get-flights?airport=${code}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'failed');

    state.flightsByAirport[code] = data.flights || [];
    updateLastUpdated(data.fetchedAt);
    renderFlights();
  } catch (err) {
    clearChildren(flightListEl);
    flightListEl.appendChild(el('p', 'board__empty', 'تعذّر تحميل بيانات الرحلات حالياً. حاول لاحقاً.'));
    lastUpdatedEl.textContent = '';
  }
}

function updateLastUpdated(fetchedAt) {
  if (!fetchedAt) {
    lastUpdatedEl.textContent = 'لا توجد بيانات محدَّثة بعد';
    return;
  }
  const diffMinutes = Math.round((Date.now() - new Date(fetchedAt).getTime()) / 60000);
  let label;
  if (diffMinutes < 60) label = `آخر تحديث: منذ ${diffMinutes} دقيقة`;
  else label = `آخر تحديث: منذ ${Math.round(diffMinutes / 60)} ساعة`;
  lastUpdatedEl.textContent = label;
}

// ── Rendering (textContent ONLY — no innerHTML, no XSS surface) ─
function renderFlights() {
  const flights = state.flightsByAirport[state.airport] || [];
  const filtered = state.direction === 'All' ? flights : flights.filter((f) => f.direction === state.direction);

  clearChildren(flightListEl);

  if (filtered.length === 0) {
    flightListEl.appendChild(el('p', 'board__empty', 'لا توجد رحلات ضمن هذا الفلتر حالياً.'));
    return;
  }

  filtered.forEach((flight) => flightListEl.appendChild(buildFlightRow(flight)));
}

function buildFlightRow(flight, showAirport = false) {
  const row = document.createElement('div');
  row.className = 'flight-row';

  const number = el('span', 'flight-row__number', flight.flightNumber || '—');

  const airlineWrap = document.createElement('div');
  airlineWrap.className = 'flight-row__airline';
  airlineWrap.appendChild(document.createTextNode(flight.airline || 'غير معروف'));
  const small = document.createElement('small');
  small.textContent = showAirport
    ? `${flight.airport ?? ''} · ${flight.direction === 'Arrival' ? 'قادمة من' : 'متجهة إلى'} ${flight.otherAirport || ''}`
    : `${flight.direction === 'Arrival' ? 'قادمة من' : 'متجهة إلى'} ${flight.otherAirport || ''}`;
  airlineWrap.appendChild(small);

  const time = el('span', 'flight-row__time', formatTime(flight.actualTime || flight.scheduledTime));
  const gate = el('span', 'flight-row__gate', flight.gate ? `بوابة ${flight.gate}` : '—');

  const statusKey = flight.status || 'unknown';
  const status = el('span', `status-pill status-pill--${statusKey}`, STATUS_LABELS_AR[statusKey] || statusKey);

  row.append(number, airlineWrap, time, status, gate);
  return row;
}

function formatTime(isoString) {
  if (!isoString) return '—';
  try {
    return new Date(isoString).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

// ── Banner ───────────────────────────────────────────────────
async function loadBanner() {
  try {
    const res = await fetch('/.netlify/functions/get-banner');
    const { banner } = await res.json();
    if (!banner) return;

    document.getElementById('banner-title').textContent = banner.title;
    document.getElementById('banner-message').textContent = banner.message;
    const link = document.getElementById('banner-link');
    if (banner.link_url) link.href = banner.link_url;
    else link.removeAttribute('href');

    document.getElementById('banner-slot').hidden = false;
  } catch {
    // Fail silently — a missing banner should never disrupt the page.
  }
}

document.getElementById('banner-close').addEventListener('click', () => {
  document.getElementById('banner-slot').hidden = true;
});

// ── Small DOM helpers ────────────────────────────────────────
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ── Init ─────────────────────────────────────────────────────
loadAirport(state.airport);
loadBanner();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
