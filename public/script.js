const form = document.getElementById('form');
const input = document.getElementById('pnr');
const button = document.getElementById('check');
const result = document.getElementById('result');

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// One row of the form. `value` comes from the API; rows with no value
// (marked `ask`) are left empty and highlighted for the user to fill in.
function row({ id, label, value = '', ask = false, placeholder = '', type = 'text', area = false }) {
  const cls = ask ? 'need' : '';
  const control = area
    ? `<textarea id="${id}" rows="1" class="${cls}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input id="${id}" type="${type}" class="${cls}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" />`;
  return `
    <div class="row">
      <label for="${id}">${label}</label>
      <div class="field">${control}</div>
    </div>`;
}

function render(d) {
  const train = [d.trainNumber, d.trainName].filter(Boolean).join(' / ');
  const berths = d.passengers ? d.passengers.length : '';

  result.innerHTML = `
    <article class="sheet" id="sheet">
      <header class="sheet-head">
        <span class="form-no">NS 871(A)</span>
        <h1>Requisition for reservation through</h1>
        <h2>Emergency quota</h2>
      </header>

      <div class="logo-band">
        <img src="logo.png" alt="Indian Railways" onerror="this.style.display='none'" />
      </div>

      <div class="rows">
        ${row({ id: 'f-request', label: 'Request of', ask: true, placeholder: 'Name / designation of the requesting person' })}
        ${row({ id: 'f-train', label: 'Train No. / Name', value: train })}
        ${row({ id: 'f-date', label: 'Date of journey', value: d.journeyDate })}
        ${row({ id: 'f-berths', label: 'No. of berths', value: berths })}
        ${row({ id: 'f-class', label: 'Class', value: d.travelClass })}
        ${row({ id: 'f-from', label: 'Station from', value: d.from })}
        ${row({ id: 'f-to', label: 'Station to', value: d.to })}
        ${row({ id: 'f-pnr', label: 'PNR number', value: d.pnr })}
        ${row({ id: 'f-names', label: 'Name of passanger', ask: true, area: true, placeholder: 'Full name(s) of passenger(s)' })}
        ${row({ id: 'f-mobile', label: 'Mob. no. of passanger', ask: true, type: 'tel', placeholder: '10-digit mobile number' })}
      </div>
    </article>

    <p class="hint">Details from the PNR are filled in. The yellow fields are not available from the PNR, so please fill them in. Every field can be edited.</p>

    <div class="actions">
      <button type="button" id="download">Download as image</button>
      <button type="button" id="print" class="secondary">Print / save as PDF</button>
    </div>
    <p class="status" id="status" role="status"></p>`;

  result.querySelectorAll('textarea').forEach(autosize);
  result.addEventListener('input', onInput);
  document.getElementById('download').addEventListener('click', downloadImage);
  document.getElementById('print').addEventListener('click', () => window.print());
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = Math.max(60, el.scrollHeight) + 'px';
}

function onInput(e) {
  if (e.target.tagName === 'TEXTAREA') autosize(e.target);
}

async function downloadImage() {
  const status = document.getElementById('status');
  const missing = ['f-request', 'f-names', 'f-mobile'].filter(id => !document.getElementById(id).value.trim());
  if (missing.length && !confirm('Some fields are still empty. Download anyway?')) return;

  if (typeof html2canvas === 'undefined') {
    status.textContent = 'Image export could not load. Use "Print / save as PDF" instead.';
    return;
  }

  const sheet = document.getElementById('sheet');
  sheet.classList.add('exporting');
  status.textContent = 'Creating image...';
  try {
    const canvas = await html2canvas(sheet, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const link = document.createElement('a');
    link.download = 'emergency-quota-' + document.getElementById('f-pnr').value.trim() + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    status.textContent = 'Image downloaded.';
  } catch (err) {
    status.textContent = 'Could not create the image. Try "Print / save as PDF".';
  } finally {
    sheet.classList.remove('exporting');
  }
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
  button.textContent = 'Fetching...';
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
    button.textContent = 'Fetch details';
  }
}

form.addEventListener('submit', checkPnr);
