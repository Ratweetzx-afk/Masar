'use strict';

let sessionToken = sessionStorage.getItem('masar_admin_token') || null;

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const AIRPORTS = ['JED', 'RUH', 'DMM'];

// ── Login ────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('password-input').value;
  const errorEl = document.getElementById('login-error');
  errorEl.hidden = true;

  try {
    const res = await fetch('/.netlify/functions/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'فشل تسجيل الدخول';
      errorEl.hidden = false;
      return;
    }

    sessionToken = data.token;
    sessionStorage.setItem('masar_admin_token', sessionToken);
    showDashboard();
  } catch {
    errorEl.textContent = 'تعذّر الاتصال بالخادم';
    errorEl.hidden = false;
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  sessionToken = null;
  sessionStorage.removeItem('masar_admin_token');
  loginView.hidden = false;
  dashboardView.hidden = true;
});

function showDashboard() {
  loginView.hidden = true;
  dashboardView.hidden = false;
  buildRefreshButtons();
  loadBanners();
}

// ── Manual refresh ───────────────────────────────────────────
function buildRefreshButtons() {
  const wrap = document.getElementById('refresh-buttons');
  wrap.textContent = '';
  AIRPORTS.forEach((code) => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = `تحديث ${code}`;
    btn.addEventListener('click', () => triggerRefresh(code));
    wrap.appendChild(btn);
  });
}

async function triggerRefresh(airport) {
  const statusEl = document.getElementById('refresh-status');
  statusEl.textContent = `جارٍ تحديث ${airport}...`;

  try {
    const res = await fetch('/.netlify/functions/refresh-flights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ airport, trigger: 'admin' }),
    });
    const data = await res.json();

    statusEl.textContent = res.ok
      ? `تم تحديث ${airport}: ${data.count} رحلة.`
      : `فشل التحديث: ${data.error}`;
  } catch {
    statusEl.textContent = 'تعذّر الاتصال بالخادم';
  }
}

// ── Banners ──────────────────────────────────────────────────
document.getElementById('banner-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const payload = {
    id: document.getElementById('banner-id').value || undefined,
    title: document.getElementById('banner-title-input').value,
    message: document.getElementById('banner-message-input').value,
    linkUrl: document.getElementById('banner-link-input').value || undefined,
    isActive: document.getElementById('banner-active-input').checked,
  };

  await fetch('/.netlify/functions/admin-banner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(payload),
  });

  e.target.reset();
  document.getElementById('banner-id').value = '';
  loadBanners();
});

async function loadBanners() {
  const listEl = document.getElementById('banner-list');
  listEl.textContent = '';

  try {
    const res = await fetch('/.netlify/functions/admin-banner', {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const data = await res.json();
    if (!res.ok) return;

    (data.banners || []).forEach((banner) => {
      const item = document.createElement('div');
      item.className = 'banner-item';

      const info = document.createElement('span');
      info.textContent = `${banner.title} — ${banner.is_active ? 'فعّال' : 'متوقف'}`;
      item.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'banner-item__actions';

      const delBtn = document.createElement('button');
      delBtn.className = 'chip';
      delBtn.textContent = 'حذف';
      delBtn.addEventListener('click', async () => {
        await fetch(`/.netlify/functions/admin-banner?id=${banner.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        loadBanners();
      });

      actions.appendChild(delBtn);
      item.appendChild(actions);
      listEl.appendChild(item);
    });
  } catch {
    // silent — non-critical UI list
  }
}

// ── Init ─────────────────────────────────────────────────────
if (sessionToken) showDashboard();
