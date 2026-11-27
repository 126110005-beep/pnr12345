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
}

async function check(pnr) {
  if (!/^\d{10}$/.test(pnr)) { setMsg('PNR must be exactly 10 digits.', true); return; }
  const btn = $('go');
  btn.disabled = true; btn.textContent = 'Checking...';
  setMsg('');
  $('result').hidden = true;
  try {
    const res = await fetch('/api/pnr/' + pnr);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Could not fetch this PNR.');
    show(d);
    const { cached, ...api } = d;
    PnrHistory.save(pnr, { api });
    showHistory();
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
showHistory();
