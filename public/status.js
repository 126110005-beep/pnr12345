// status.js — PNR status page. Calls your /api/pnr/:pnr route and shows the result.

const $ = id => document.getElementById(id);

function setMsg(text, bad) {
  $('msg').textContent = text || '';
  $('msg').className = 'msg' + (bad ? ' err' : '');
}

function journeyCountdown(value) {
  const text = String(value || '').trim();
  let year, month, day, match;
  if ((match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text))) {
    day = Number(match[1]); month = Number(match[2]); year = Number(match[3]);
  } else if ((match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text))) {
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
  } else {
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return '';
    year = parsed.getFullYear(); month = parsed.getMonth() + 1; day = parsed.getDate();
  }
  const target = new Date(year, month - 1, day);
  if (target.getFullYear() !== year || target.getMonth() !== month - 1 || target.getDate() !== day) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days > 1) return `Journey in ${days} days`;
  if (days === 1) return 'Journey is tomorrow';
  if (days === 0) return 'Journey is today';
  if (days === -1) return 'Journey was yesterday';
  return `Journey was ${Math.abs(days)} days ago`;
}

function renderStatusHistory(pnr) {
  const snapshots = (PnrHistory.get(pnr) || {}).statusHistory || [];
  const panel = $('statusHistoryPanel');
  const list = $('statusTimeline');
  list.innerHTML = '';
  panel.hidden = snapshots.length === 0;
  snapshots.slice().reverse().forEach(snapshot => {
    const item = document.createElement('li');
    const status = [
      snapshot.chartStatus,
      ...(snapshot.passengers || []).map(p => `Passenger ${p.number}: ${p.currentStatus || p.bookingStatus || 'Unknown'}`),
    ].filter(Boolean).join(' · ') || 'Status recorded';
    item.appendChild(document.createTextNode(status));
    const time = document.createElement('time');
    time.dateTime = new Date(snapshot.checkedAt).toISOString();
    time.textContent = new Date(snapshot.checkedAt).toLocaleString();
    item.appendChild(time);
    list.appendChild(item);
  });
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
  const countdown = journeyCountdown(d.journeyDate);
  $('journeyCountdown').textContent = countdown;
  $('journeyCountdown').hidden = !countdown;
  renderStatusHistory(d.pnr);

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
  return JSON.stringify({
    chartStatus: d.chartStatus || '',
    passengers: (d.passengers || []).map(p => `${p.bookingStatus || ''}|${p.currentStatus || ''}`),
  });
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
      PnrHistory.saveStatus(entry.pnr, data);
      if ($('pnr').value.trim() === entry.pnr) renderStatusHistory(entry.pnr);
    } catch (e) {}
  }
  if (entries.length) showHistory();
}

async function check(pnr, force) {
  if (!/^\d{10}$/.test(pnr)) {
    setMsg('PNR must be exactly 10 digits.', true);
    $('result').hidden = true;
    $('resultActions').hidden = true;
    return;
  }
  const btn = $('go');
  btn.disabled = true; btn.textContent = 'Checking...';
  setMsg('');
  $('result').hidden = true;
  $('resultActions').hidden = true;
  try {
    const res = await fetch('/api/pnr/' + pnr + (force ? '?refresh=1' : ''));
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Could not fetch this PNR.');
    show(d);
    const { cached, ...api } = d;
    PnrHistory.saveStatus(pnr, api);
    renderStatusHistory(pnr);
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

function historyUpdated() {
  showHistory();
  const pnr = $('pnr').value.trim();
  if (/^\d{10}$/.test(pnr)) {
    $('notify').textContent = localStorage.getItem('pnr-alert-' + pnr) ? 'Disable change alerts' : 'Enable change alerts';
  }
}

$('pnr').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
$('pnrForm').addEventListener('submit', e => { e.preventDefault(); check($('pnr').value.trim()); });
$('refresh').addEventListener('click', refreshStatus);
$('notify').addEventListener('click', toggleAlerts);
window.addEventListener('pnr-history-updated', historyUpdated);
window.addEventListener('pnr-backup-message', e => setMsg(e.detail.message, e.detail.bad));
setInterval(pollSavedPnrs, 5 * 60 * 1000);
showHistory();
