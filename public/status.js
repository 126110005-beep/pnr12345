// status.js — PNR status page. Calls your /api/pnr/:pnr route and shows the result.

const $ = id => document.getElementById(id);

function setMsg(text, bad) {
  $('msg').textContent = text || '';
  $('msg').className = 'msg' + (bad ? ' err' : '');
}

function show(d) {
  $('rTrain').textContent = [d.trainNumber, d.trainName].filter(Boolean).join(' ') || 'Train details not available';
  $('rPnr').textContent = 'PNR ' + d.pnr;
  $('rChart').textContent = d.chartStatus || 'Unknown';
  $('rChart').className = 'chip' + (/not/i.test(d.chartStatus || '') ? '' : ' ok');
  $('rFrom').textContent = d.from || '-';
  $('rTo').textContent = d.to || '-';
  $('rDate').textContent = d.journeyDate || '-';
  $('rClass').textContent = d.travelClass || '-';
  $('rBoard').textContent = d.boarding || '-';

  const body = $('rRows');
  body.innerHTML = '';
  (d.passengers || []).forEach((p, i) => {
    const tr = document.createElement('tr');
    [p.number || i + 1, p.bookingStatus || '-', p.currentStatus || '-'].forEach(v => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });

  $('rNote').textContent = d.mock
    ? 'Sample data: the server is in mock mode (USE_MOCK=true).'
    : d.cached ? 'Shown from a recent check (updates every 10 minutes).' : '';
  $('result').hidden = false;
  $('resultActions').hidden = false;
  $('lastChecked').textContent = d.cached ? 'Checked just now (cached)' : 'Checked just now';
}

async function refreshStatus() {
  const pnr = $('pnr').value.trim();
  if (!/^\d{10}$/.test(pnr)) return;
  const btn = $('refresh');
  btn.disabled = true;
  btn.textContent = 'Refreshing...';
  try {
    await check(pnr, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh status';
  }
}

function statusSignature(d) {
  return (d.passengers || []).map(p => `${p.bookingStatus || ''}|${p.currentStatus || ''}`).join(';');
}

async function toggleAlerts() {
  if (!('Notification' in window)) {
    setMsg('Browser notifications are not supported here.', true);
    return;
  }
  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setMsg('Notification permission was not granted.', true);
      return;
    }
  }
  if (Notification.permission !== 'granted') {
    setMsg('Enable notifications in your browser settings.', true);
    return;
  }
  const pnr = $('pnr').value.trim();
  if (!/^\d{10}$/.test(pnr)) return;
  const key = 'pnr-alert-' + pnr;
  if (localStorage.getItem(key)) {
    localStorage.removeItem(key);
    $('notify').textContent = 'Enable change alerts';
    setMsg('Change alerts disabled for this PNR.');
  } else {
    const saved = PnrHistory.get(pnr);
    if (saved && saved.api) localStorage.setItem(key, statusSignature(saved.api));
    else localStorage.setItem(key, statusSignature({}));
    $('notify').textContent = 'Disable change alerts';
    setMsg('Change alerts enabled. Keep this page open.');
  }
}

async function pollSavedPnrs() {
  const entries = PnrHistory.list().filter(e => localStorage.getItem('pnr-alert-' + e.pnr));
  for (const entry of entries) {
    try {
      const res = await fetch('/api/pnr/' + entry.pnr);
      const data = await res.json();
      if (!res.ok) continue;
      const key = 'pnr-alert-' + entry.pnr;
      const previous = localStorage.getItem(key);
      const next = statusSignature(data);
      if (previous && previous !== next) {
        new Notification(`PNR ${entry.pnr} status changed`, {
          body: (data.passengers || []).map(p => p.currentStatus).filter(Boolean).join(', ') || data.chartStatus || 'Status updated',
        });
      }
      localStorage.setItem(key, next);
      PnrHistory.save(entry.pnr, { api: data });
    } catch (e) {}
  }
  if (entries.length) showHistory();
}

async function check(pnr, force) {
  if (!/^\d{10}$/.test(pnr)) { setMsg('PNR must be exactly 10 digits.', true); return; }
  const btn = $('go');
  btn.disabled = true; btn.textContent = 'Checking...';
  setMsg('');
  $('result').hidden = true;
  try {
    const res = await fetch('/api/pnr/' + pnr + (force ? '?refresh=1' : ''));
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Could not fetch this PNR.');
    show(d);
    const { cached, ...api } = d;
    PnrHistory.save(pnr, { api });
    showHistory();
    const alertKey = 'pnr-alert-' + pnr;
    $('notify').textContent = localStorage.getItem(alertKey) ? 'Disable change alerts' : 'Enable change alerts';
  } catch (err) {
    setMsg(err.message, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Check status';
  }
}

function showHistory() {
  PnrHistory.render($('history'), pnr => { $('pnr').value = pnr; check(pnr); });
}

$('pnr').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
$('pnrForm').addEventListener('submit', e => { e.preventDefault(); check($('pnr').value.trim()); });
$('refresh').addEventListener('click', refreshStatus);
$('notify').addEventListener('click', toggleAlerts);
setInterval(pollSavedPnrs, 5 * 60 * 1000);
showHistory();
