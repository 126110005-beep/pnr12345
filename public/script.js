// script.js — the frontend logic.
// Reads the PNR, asks OUR server for the status, and shows the result.

const form = document.getElementById('pnr-form');
const input = document.getElementById('pnr-input');
const button = document.getElementById('check-btn');
const message = document.getElementById('message');
const result = document.getElementById('result');

// Only allow digits to be typed
input.addEventListener('input', () => {
  input.value = input.value.replace(/\D/g, '');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault(); // stop the page from reloading

  const pnr = input.value.trim();
  result.innerHTML = '';

  if (!/^\d{10}$/.test(pnr)) {
    showMessage('Please enter a valid 10-digit PNR.', true);
    return;
  }

  showMessage('Checking status…');
  button.disabled = true;

  try {
    const response = await fetch(`/api/pnr/${pnr}`);
    const data = await response.json();

    if (!response.ok) {
      showMessage(data.error || 'Something went wrong.', true);
      return;
    }

    showMessage('');
    renderResult(data);
  } catch (err) {
    showMessage('Cannot reach the server. Is it running?', true);
  } finally {
    button.disabled = false;
  }
});

function showMessage(text, isError = false) {
  message.textContent = text;
  message.className = isError ? 'error' : '';
}

// Pick a colour based on the status text (CNF = green, RAC = yellow, WL = red)
function badgeClass(status) {
  const s = String(status).toUpperCase();
  if (s.startsWith('CNF') || s.includes('CONFIRM')) return 'cnf';
  if (s.startsWith('RAC')) return 'rac';
  if (s.includes('WL')) return 'wl';
  return 'other';
}

// Escape text before putting it into HTML (basic safety habit)
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderResult(d) {
  const rows = d.passengers.map((p) => `
    <tr>
      <td>${esc(p.number)}</td>
      <td>${esc(p.bookingStatus)}</td>
      <td><span class="badge ${badgeClass(p.currentStatus)}">${esc(p.currentStatus)}</span></td>
    </tr>`).join('');

  result.innerHTML = `
    <div class="card">
      <div class="train-name">${esc(d.trainName)}</div>
      <div class="train-no">Train ${esc(d.trainNumber)} · PNR ${esc(d.pnr)}</div>

      <div class="route">
        <span>${esc(d.from)}</span>
        <span class="arrow">———→</span>
        <span>${esc(d.to)}</span>
      </div>

      <div class="info">
        <div><span>Journey date</span>${esc(d.journeyDate)}</div>
        <div><span>Class</span>${esc(d.travelClass)}</div>
        <div><span>Boarding</span>${esc(d.boarding)}</div>
        <div><span>Chart</span>${esc(d.chartStatus)}</div>
      </div>

      <table>
        <thead><tr><th>#</th><th>Booking status</th><th>Current status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      ${d.cached ? '<p class="note">Shown from cache (checked in the last 10 minutes).</p>' : ''}
    </div>`;
}
