const form = document.getElementById('form');
const input = document.getElementById('pnr');
const button = document.getElementById('check');
const result = document.getElementById('result');

function esc(v) {
  return String(v ?? '-').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function badgeClass(status) {
  const s = (status || '').toUpperCase();
  if (s.startsWith('CNF')) return 'confirmed';
  if (s.startsWith('RAC')) return 'rac';
  return 'waiting';
}

function detail(label, value) {
  return `<div class="detail"><dt>${label}</dt><dd>${esc(value)}</dd></div>`;
}

function render(d) {
  const showBoarding = d.boarding && d.boarding !== d.from;
  const prepared = /^chart prepared/i.test(d.chartStatus);

  const stops = [
    { label: 'From', code: d.from },
    ...(showBoarding ? [{ label: 'Boarding at', code: d.boarding }] : []),
    { label: 'To', code: d.to },
  ].map(s => `
      <li>
        <span class="stop-label">${s.label}</span>
        <span class="stop-code">${esc(s.code)}</span>
      </li>`).join('');

  const passengers = d.passengers.map(p => `
      <div class="passenger">
        <div class="p-name">Passenger ${esc(p.number)}</div>
        <div class="p-booked">Booked as ${esc(p.bookingStatus)}</div>
        <div class="p-now">
          <span class="p-now-label">Current status</span>
          <span class="badge ${badgeClass(p.currentStatus)}">${esc(p.currentStatus)}</span>
        </div>
      </div>`).join('');

  result.innerHTML = `
    <article class="ticket">
      <section class="ticket-head">
        <p class="pnr-line">PNR ${esc(d.pnr)}${d.cached ? ' (saved result)' : ''}</p>
        <h2>${esc(d.trainName)}</h2>
        <p class="train-no">Train ${esc(d.trainNumber)}</p>
        <span class="chart ${prepared ? 'done' : ''}">${esc(d.chartStatus)}</span>
      </section>

      <ol class="route">${stops}</ol>

      <dl class="details">
        ${detail('Journey date', d.journeyDate)}
        ${detail('Class', d.travelClass)}
      </dl>

      <div class="tear" aria-hidden="true"></div>

      <section class="passengers">${passengers}</section>
    </article>`;
}

function showError(msg) {
  result.innerHTML = `<p class="message error">${esc(msg)}</p>`;
}

async function checkPnr(e) {
  e.preventDefault();
  const pnr = input.value.trim();
  if (!/^\d{10}$/.test(pnr)) {
    showError('Enter a PNR with exactly 10 digits.');
    return;
  }
  button.disabled = true;
  button.textContent = 'Checking...';
  result.innerHTML = '<p class="message">Fetching your booking...</p>';
  try {
    const res = await fetch('/api/pnr/' + pnr);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    render(data);
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Check status';
  }
}

form.addEventListener('submit', checkPnr);