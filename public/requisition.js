// requisition.js — builds the NS 871(A) form, fills it from your /api/pnr route,
// and handles the signature (draw, type or upload).

const $ = id => document.getElementById(id);
const form = $('form');
const statusEl = $('status');

const CLASSES = [
  ['SL', 'SL - Sleeper Class'], ['3A', '3A - AC 3-Tier'], ['3E', '3E - AC 3-Tier Economy'], ['2A', '2A - AC 2-Tier'],
  ['1A', '1A - AC First Class'], ['CC', 'CC - AC Chair Car'], ['EC', 'EC - Executive Chair Car'], ['2S', '2S - Second Sitting'],
];

// One entry per row of the Excel sheet. y = yellow (to be filled), opt = optional (prints "-")
const ROWS = [
  { id: 'requestOf', label: 'Request of', y: 1 },
  { id: 'train', label: 'Train number / full name', y: 1 },
  { id: 'date', label: 'Date of journey', type: 'date', y: 1 },
  { id: 'time', label: 'Time of boarding', type: 'time', y: 1 },
  { id: 'berths', label: 'No. of berths', type: 'number', y: 1 },
  { id: 'cls', label: 'Travel class (code / full name)', type: 'select', y: 1 },
  { id: 'from', label: 'From station (code / full name)', up: 1, y: 1 },
  { id: 'to', label: 'To station (code / full name)', up: 1, y: 1 },
  { id: 'pnr', label: 'PNR (Passenger Name Record)', type: 'tel', max: 10, fetch: 1, y: 1 },
  { id: 'passenger', label: 'Name of passenger', y: 1 },
  { id: 'mobile', label: 'Mobile number of passenger', type: 'tel', max: 10, y: 1 },
  { type: 'signature', label: 'Signature' },
  { id: 'signName', label: 'Name' },
  { id: 'designation', label: 'Designation' },
  { id: 'contactNo', label: 'Contact number (auto-off)' },
  { id: 'signMobile', label: 'Mobile number', type: 'tel', max: 10 },
  { id: 'officeAddress', label: 'Office address' },
  { type: 'bar', label: 'PNR status details' },
  { id: 'boarding', label: 'Boarding station (code / full name)', up: 1, y: 1 },
  { id: 'bookingStatus', label: 'Booking status', y: 1 },
  { id: 'currentStatus', label: 'Current status', y: 1 },
  { id: 'chartStatus', label: 'Chart status', type: 'select', opts: [['Chart Prepared', 'Chart Prepared'], ['Chart Not Prepared', 'Chart Not Prepared']], y: 1 },
];

const FIELDS = ROWS.filter(r => r.id).map(r => r.id);
const REQUIRED = ['requestOf', 'train', 'date', 'berths', 'cls', 'from', 'to', 'pnr', 'passenger', 'mobile'];
// Fixed details from the Excel sheet: pre-filled, and kept when you press Clear form
const SIGNER = {
  signName: 'MANISH GUPTA', designation: 'CMI CT GIM', contactNo: '093-48349',
  signMobile: '9724045398', officeAddress: 'AREA MANAGER OFFICE GANDHIDHAM KUTCH',
};
const LABEL = Object.fromEntries(ROWS.filter(r => r.id).map(r => [r.id, r.label]));
const DRAFT_KEY = 'ns871a-draft';
const SIG_KEY = 'ns871a-signature';

const RULES = {
  pnr: v => /^\d{10}$/.test(v) || 'PNR must be exactly 10 digits.',
  mobile: v => /^[6-9]\d{9}$/.test(v) || 'Enter a valid 10-digit mobile number.',
  berths: v => (+v >= 1 && +v <= 99) || 'Enter a number from 1 to 99.',
  from: v => /^[A-Za-z]{2,5}(?:\s*-\s*[A-Za-z][A-Za-z .'-]*)?$/.test(v) || 'Use the station code or code and full name.',
  to: v => /^[A-Za-z]{2,5}(?:\s*-\s*[A-Za-z][A-Za-z .'-]*)?$/.test(v) || 'Use the station code or code and full name.',
};

/* ---------- Build the rows ---------- */
function buildRows() {
  const host = $('rows');
  ROWS.forEach((r, i) => {
    if (r.type === 'bar') {
      const d = document.createElement('div');
      d.className = 'bar'; d.textContent = r.label; host.appendChild(d);
      return;
    }
    const row = document.createElement('div');
    row.className = 'row' + (r.y ? ' y' : '') + (r.up ? ' upper' : '') + (r.type === 'signature' ? ' thick' : '');
    row.dataset.f = r.id || 'signature';

    if (r.type === 'signature') {
      row.innerHTML = `
        <div class="lab">${r.label}</div>
        <div class="cell sig-cell">
          <div class="sig-img" id="sigImg"><span class="sig-empty">No signature added</span></div>
          <div class="sig-btns no-print">
            <button class="btn small" type="button" id="sigOpen">Add signature</button>
            <button class="btn small" type="button" id="sigRemove" hidden>Remove</button>
          </div>
        </div>`;
      host.appendChild(row);
      return;
    }

    const lab = document.createElement('label');
    lab.htmlFor = r.id; lab.textContent = r.label;
    const cell = document.createElement('div');
    cell.className = 'cell';

    let el;
    if (r.type === 'select') {
      el = document.createElement('select');
      el.innerHTML = '<option value="">Select</option>' +
        (r.opts || CLASSES).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    } else {
      el = document.createElement('input');
      el.type = r.type || 'text';
      if (r.max) { el.maxLength = r.max; el.inputMode = 'numeric'; }
      if (r.type === 'number') { el.min = 1; el.max = 99; el.inputMode = 'numeric'; }
      el.autocomplete = 'off';
    }
    el.id = r.id; el.name = r.id;
    if (SIGNER[r.id] !== undefined) {
      el.readOnly = true;
      el.title = 'Preprinted office detail';
    }

    const hint = document.createElement('p');
    hint.className = 'hint';

    if (r.fetch) {
      const wrap = document.createElement('div');
      wrap.className = 'with-btn';
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'fetchPnr'; b.className = 'fetch'; b.textContent = 'Fetch details';
      wrap.append(el, b);
      cell.append(wrap, hint);
    } else {
      cell.append(el, hint);
    }
    row.append(lab, cell);
    host.appendChild(row);
  });
}

const rowOf = id => form.querySelector(`.row[data-f="${id}"]`);

/* ---------- Validation, draft, status ---------- */
function say(msg, bad) {
  statusEl.textContent = msg;
  statusEl.className = 'status no-print' + (bad ? ' err' : '');
  if (msg) setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, 4000);
}

function check(id) {
  const v = $(id).value.trim();
  let msg = '';
  if (!v && REQUIRED.includes(id)) msg = 'This field is required.';
  else if (v && RULES[id]) { const r = RULES[id](v); if (r !== true) msg = r; }
  const row = rowOf(id);
  row.classList.toggle('bad', !!msg);
  row.querySelector('.hint').textContent = msg;
  row.querySelector('.hint').classList.remove('ok');
  return !msg;
}

function validateAll() {
  let first = null;
  REQUIRED.forEach(id => { if (!check(id) && !first) first = id; });
  if (first) { $(first).focus(); say('Please fix the highlighted fields.', true); }
  return !first;
}

const saveDraft = () => {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(FIELDS.map(id => [id, $(id).value])))); } catch (e) {}
};
function loadDraft() {
  const yellowIds = new Set(ROWS.filter(r => r.y && r.id).map(r => r.id));
  FIELDS.forEach(id => {
    $(id).value = '';
    if (SIGNER[id] !== undefined) $(id).value = SIGNER[id];
  });
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d) FIELDS.forEach(id => {
      if (SIGNER[id] === undefined && id !== 'requestOf' && !yellowIds.has(id) && d[id] != null) $(id).value = d[id];
    });
  } catch (e) {}
}

/* ---------- Fill from the PNR API ---------- */
function toISODate(s) {
  if (!s) return '';
  let m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}
function toISOTime(s) {
  if (!s) return '';
  const text = String(s).trim();
  let m = /(?:^|[T\s])(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (m) return `${String(+m[1]).padStart(2, '0')}:${m[2]}`;
  m = /^(\d{1,2})[:.](\d{2})\s*(AM|PM)$/i.exec(text);
  if (m) {
    let hour = +m[1] % 12;
    if (/PM/i.test(m[3])) hour += 12;
    return `${String(hour).padStart(2, '0')}:${m[2]}`;
  }
  return '';
}
function toClassCode(s) {
  const c = String(s || '').toUpperCase().replace(/\s/g, '');
  const map = { '1AC': '1A', '2AC': '2A', '3AC': '3A', '3ECO': '3E', SLEEPER: 'SL' };
  const code = map[c] || c;
  return CLASSES.some(([v]) => v === code) ? code : '';
}
function setVal(id, v) { if (v !== undefined && v !== null && v !== '') $(id).value = v; }
function setApiVal(id, v) { $(id).value = v == null ? '' : String(v); }
function formatStation(code, name) {
  const c = String(code || '').trim().toUpperCase();
  const n = String(name || '').trim().toUpperCase();
  if (!c) return n;
  if (!n || n === c || n.includes(c)) return c;
  return `${c} - ${n}`;
}
function expandRailStatus(status) {
  return String(status || '').replace(/\b(GNWL|PQWL|RLWL|TQWL|RAC|CNF|WL)\b/gi, code => ({
    GNWL: 'General Waiting List (GNWL)',
    PQWL: 'Pooled Quota Waiting List (PQWL)',
    RLWL: 'Remote Location Waiting List (RLWL)',
    TQWL: 'Tatkal Quota Waiting List (TQWL)',
    RAC: 'Reservation Against Cancellation (RAC)',
    CNF: 'Confirmed (CNF)',
    WL: 'Waiting List (WL)',
  })[code.toUpperCase()]);
}

// Puts a PNR status result into the form (used by "Fetch details" and by saved PNRs)
function applyApi(d) {
  setApiVal('train', [d.trainNumber, d.trainName].filter(Boolean).join(' '));
  setApiVal('date', toISODate(d.journeyDate));
  setApiVal('time', toISOTime(d.boardingTime));
  setApiVal('cls', toClassCode(d.travelClass));
  setApiVal('from', formatStation(d.from, d.fromName));
  setApiVal('to', formatStation(d.to, d.toName));
  setApiVal('boarding', formatStation(d.boarding, d.boardingName));
  rowOf('time').querySelector('.hint').textContent = d.boardingTime
    ? ''
    : 'Boarding time was not provided by the PNR service; enter it manually.';
  if (d.passengers && d.passengers.length) {
    setVal('berths', d.passengers.length);
    setVal('bookingStatus', expandRailStatus(d.passengers.map(p => p.bookingStatus).filter(Boolean).join(', ')));
    setVal('currentStatus', expandRailStatus(d.passengers.map(p => p.currentStatus).filter(Boolean).join(', ')));
  }
  if (/not/i.test(d.chartStatus || '')) $('chartStatus').value = 'Chart Not Prepared';
  else if (/prepared/i.test(d.chartStatus || '')) $('chartStatus').value = 'Chart Prepared';
}

function pnrHint(text, ok) {
  const hint = rowOf('pnr').querySelector('.hint');
  hint.textContent = text;
  hint.classList.toggle('ok', !!ok);
}

async function fetchPnr() {
  const pnr = $('pnr').value.trim();
  if (!check('pnr') || !pnr) return;
  const btn = $('fetchPnr');
  btn.disabled = true; btn.textContent = 'Fetching...';
  try {
    const res = await fetch('/api/pnr/' + pnr);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Could not fetch this PNR.');

    applyApi(d);
    FIELDS.forEach(id => { if ($(id).value && rowOf(id).classList.contains('bad')) check(id); });
    saveDraft();

    const { cached, ...api } = d;
    PnrHistory.save(pnr, { api, form: snapshot() });
    showHistory();

    pnrHint(d.mock
      ? 'Filled with sample data because the server is in mock mode (USE_MOCK=true).'
      : 'Filled from PNR status. Add the passenger name and mobile number, then check everything.', true);
  } catch (err) {
    pnrHint(err.message, false);
    rowOf('pnr').classList.add('bad');
  } finally {
    btn.disabled = false; btn.textContent = 'Fetch details';
  }
}

/* ---------- Saved PNRs: type a PNR once, never again ---------- */
// Everything except the signer block (which is kept separately) belongs to the PNR
const PER_PNR = FIELDS.filter(id => SIGNER[id] === undefined);
const snapshot = () => Object.fromEntries(PER_PNR.map(id => [id, $(id).value]));

function showHistory() {
  PnrHistory.render($('history'), loadPnr);
}

// Bring back everything saved for a PNR
function loadPnr(pnr) {
  const e = PnrHistory.get(pnr);
  $('pnr').value = pnr;
  lastPnr = pnr;
  // start clean so nothing from the previous PNR carries over
  PER_PNR.forEach(id => { if (id !== 'pnr') $(id).value = (e && e.form && e.form[id]) || ''; });
  if (e && e.form) {
    if (e.api) applyApi(e.api);
    pnrHint('Loaded the details you saved for this PNR.', true);
  } else if (e && e.api) {
    applyApi(e.api);
    pnrHint('Filled from your earlier PNR status check. Add the passenger name and mobile number.', true);
  }
  form.querySelectorAll('.row').forEach(r => r.classList.remove('bad'));
  PnrHistory.save(pnr);   // moves it to the top
  saveDraft();
  showHistory();
}

// Save the current form under its PNR (only when the PNR is a valid 10 digits)
function rememberNow() {
  const pnr = $('pnr').value.trim();
  if (!/^\d{10}$/.test(pnr)) return;
  PnrHistory.save(pnr, { form: snapshot() });
  showHistory();
}
let rememberTimer;
const rememberSoon = () => { clearTimeout(rememberTimer); rememberTimer = setTimeout(rememberNow, 500); };

let lastPnr = '';

/* ---------- Signature ---------- */
const NAVY = '#14284B';
const FONTS = ['Dancing Script', 'Great Vibes', 'Caveat'];
const dlg = $('sigDialog');
const pad = $('pad'), pctx = pad.getContext('2d');
let tab = 'draw', inked = false, drawing = false, upSource = null, font = FONTS[0];

function setSignature(url) {
  const box = $('sigImg');
  box.innerHTML = '';
  if (url) {
    const img = new Image(); img.src = url; img.alt = 'Signature'; box.appendChild(img);
  } else {
    box.innerHTML = '<span class="sig-empty">No signature added</span>';
  }
  $('sigOpen').textContent = url ? 'Change' : 'Add signature';
  $('sigRemove').hidden = !url;
  try { url ? localStorage.setItem(SIG_KEY, url) : localStorage.removeItem(SIG_KEY); } catch (e) {}
}

function sizePad() {
  const r = pad.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  pad.width = Math.round(r.width * dpr); pad.height = Math.round(r.height * dpr);
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pctx.lineWidth = 2.6; pctx.lineCap = 'round'; pctx.lineJoin = 'round'; pctx.strokeStyle = NAVY;
  inked = false;
}
const pos = e => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
pad.addEventListener('pointerdown', e => {
  drawing = true; pad.setPointerCapture(e.pointerId);
  const [x, y] = pos(e); pctx.beginPath(); pctx.moveTo(x, y); pctx.lineTo(x + 0.01, y + 0.01); pctx.stroke(); inked = true;
});
pad.addEventListener('pointermove', e => { if (!drawing) return; const [x, y] = pos(e); pctx.lineTo(x, y); pctx.stroke(); });
['pointerup', 'pointercancel'].forEach(t => pad.addEventListener(t, () => { drawing = false; }));
$('padClear').addEventListener('click', sizePad);

// Crop empty margins so the signature fits the cell neatly
function trim(canvas) {
  const w = canvas.width, h = canvas.height, data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const p = 10, out = document.createElement('canvas');
  out.width = x1 - x0 + 1 + p * 2; out.height = y1 - y0 + 1 + p * 2;
  out.getContext('2d').drawImage(canvas, x0, y0, x1 - x0 + 1, y1 - y0 + 1, p, p, x1 - x0 + 1, y1 - y0 + 1);
  return out;
}

function buildFonts() {
  const list = $('fontList'); list.innerHTML = '';
  FONTS.forEach(f => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'font-opt' + (f === font ? ' on' : '');
    b.style.fontFamily = `"${f}", cursive`;
    b.textContent = $('typeText').value.trim() || 'Your name';
    b.addEventListener('click', () => { font = f; buildFonts(); });
    list.appendChild(b);
  });
}
$('typeText').addEventListener('input', buildFonts);

$('upFile').addEventListener('change', () => {
  const file = $('upFile').files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => { upSource = img; drawUpload(); URL.revokeObjectURL(img.src); };
  img.src = URL.createObjectURL(file);
});
$('upClean').addEventListener('change', drawUpload);
function drawUpload() {
  if (!upSource) return;
  const c = $('upView'), scale = Math.min(1, 700 / upSource.width);
  c.width = Math.round(upSource.width * scale); c.height = Math.round(upSource.height * scale);
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height); x.drawImage(upSource, 0, 0, c.width, c.height);
  if ($('upClean').checked) {
    const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (lum > 215) d[i + 3] = 0; else if (lum > 160) d[i + 3] = Math.round(255 * (215 - lum) / 55);
    }
    x.putImageData(im, 0, 0);
  }
  c.hidden = false;
}

function switchTab(t) {
  tab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== t; });
  $('sigMsg').textContent = '';
  if (t === 'draw') sizePad();
  if (t === 'type') { if (!$('typeText').value) $('typeText').value = $('signName').value; buildFonts(); }
}

async function applySignature() {
  const msg = $('sigMsg'); msg.textContent = '';
  let src = null;
  if (tab === 'draw') {
    if (!inked) { msg.textContent = 'Draw your signature first.'; return; }
    src = pad;
  } else if (tab === 'type') {
    const text = $('typeText').value.trim();
    if (!text) { msg.textContent = 'Type your name first.'; return; }
    try { await document.fonts.load(`80px "${font}"`, text); } catch (e) {}
    src = document.createElement('canvas'); src.width = 1400; src.height = 260;
    const x = src.getContext('2d');
    x.font = `110px "${font}", cursive`; x.fillStyle = NAVY; x.textBaseline = 'middle';
    x.fillText(text, 30, 130, 1340);
  } else {
    if (!upSource) { msg.textContent = 'Choose an image first.'; return; }
    src = $('upView');
  }
  const out = trim(src);
  if (!out) { msg.textContent = 'Nothing to use yet. Try again.'; return; }
  setSignature(out.toDataURL('image/png'));
  dlg.close();
}

/* ---------- Download as image ---------- */
const YELLOW = '#fff176', NAVY_BG = '#14284b', GOLD = '#d9b66a', LABEL_BG = '#f1eadb', RULE = '#d9cdb4';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shown(id) {
  const v = $(id).value.trim();
  if (!v) return '';
  if (id === 'date') { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m ? `${m[3]}-${MONTHS[+m[2] - 1]}-${m[1]}` : v; }
  if (id === 'time') { const m = /^(\d{2}):(\d{2})$/.exec(v); if (!m) return v; const h = +m[1]; return `${String(h % 12 || 12).padStart(2, '0')}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; }
  if (id === 'cls') return $('cls').selectedOptions[0].textContent;
  return v;
}

function loadImage(src) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}

// Draws the form exactly like the Excel sheet and saves it as a PNG
async function downloadImage() {
  const W = 900, LW = 320, S = 2, ROW = 56, SIG = 120, BAR = 50, HEAD = 130, LOGO = 210;
  const SANS = `'Manrope', system-ui, sans-serif`, SERIF = `'Fraunces', Georgia, serif`;
  try { await Promise.all([document.fonts.load(`700 18px Manrope`), document.fonts.load(`600 30px Fraunces`)]); } catch (e) {}

  const H = HEAD + LOGO + ROWS.reduce((n, r) => n + (r.type === 'bar' ? BAR : r.type === 'signature' ? SIG : ROW), 0);
  const c = document.createElement('canvas');
  c.width = W * S; c.height = H * S;
  const x = c.getContext('2d');
  x.scale(S, S);
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);

  // header
  x.fillStyle = NAVY_BG; x.fillRect(0, 0, W, HEAD);
  x.textAlign = 'right'; x.textBaseline = 'middle'; x.fillStyle = GOLD; x.font = `700 16px ${SANS}`;
  x.fillText('NS 871(A)', W - 24, 26);
  x.textAlign = 'center'; x.fillStyle = '#fff'; x.font = `600 31px ${SERIF}`;
  x.fillText('REQUISITION FOR RESERVATION THROUGH', W / 2, 70);
  x.fillStyle = GOLD; x.fillText('EMERGENCY QUOTA', W / 2, 108);

  // logo
  const logo = await loadImage('irlogo.png');
  if (logo) { const h = 170, w = logo.width * h / logo.height; x.drawImage(logo, (W - w) / 2, HEAD + (LOGO - h) / 2, w, h); }
  let y = HEAD + LOGO;

  const fit = (text, max, size, weight) => {
    let f = size; x.font = `${weight} ${f}px ${SANS}`;
    while (x.measureText(text).width > max && f > 13) { f--; x.font = `${weight} ${f}px ${SANS}`; }
  };
  const line = (yy, w, col) => { x.fillStyle = col; x.fillRect(0, yy, W, w); };

  const sigImg = $('sigImg').querySelector('img');
  for (const r of ROWS) {
    if (r.type === 'bar') {
      x.fillStyle = NAVY_BG; x.fillRect(0, y, W, BAR);
      x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = `600 19px ${SERIF}`;
      x.fillText(r.label.toUpperCase(), W / 2, y + BAR / 2 + 1);
      y += BAR; continue;
    }
    const h = r.type === 'signature' ? SIG : ROW;
    x.fillStyle = LABEL_BG; x.fillRect(0, y, LW, h);
    x.fillStyle = r.y ? YELLOW : '#fff'; x.fillRect(LW, y, W - LW, h);
    line(y, 1, RULE);
    if (r.type === 'signature') line(y, 3, NAVY_BG);
    x.fillStyle = '#b8924a'; x.fillRect(LW, y, 1, h);

    x.textAlign = 'left'; x.fillStyle = NAVY_BG; x.font = `700 15px ${SANS}`;
    x.fillText(r.label.toUpperCase(), 22, y + h / 2 + 1);

    if (r.type === 'signature') {
      if (sigImg && sigImg.naturalWidth) {
        const k = Math.min((SIG - 24) / sigImg.naturalHeight, (W - LW - 60) / sigImg.naturalWidth);
        x.drawImage(sigImg, LW + 24, y + (SIG - sigImg.naturalHeight * k) / 2, sigImg.naturalWidth * k, sigImg.naturalHeight * k);
      }
    } else {
      x.fillStyle = '#1b2438'; fit(shown(r.id), W - LW - 44, 22, 500);
      x.fillText(shown(r.id), LW + 22, y + h / 2 + 1);
    }
    y += h;
  }

  // frame
  x.strokeStyle = NAVY_BG; x.lineWidth = 3; x.strokeRect(1.5, 1.5, W - 3, H - 3);

  const name = `NS871A_${$('pnr').value.trim() || 'form'}.png`;
  c.toBlob(blob => {
    if (!blob) {
      say('Could not create the image. Please try again.', true);
      return;
    }
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    say('Image downloaded.');
  }, 'image/png');
}

form.addEventListener('submit', e => { e.preventDefault(); if (validateAll()) { rememberNow(); downloadImage(); } });

$('reset').addEventListener('click', () => {
  FIELDS.forEach(id => { if (SIGNER[id] === undefined) $(id).value = ''; });
  form.querySelectorAll('.row').forEach(r => { r.classList.remove('bad'); const h = r.querySelector('.hint'); if (h) { h.textContent = ''; h.classList.remove('ok'); } });
  lastPnr = '';
  saveDraft(); say('Form cleared. Signer block and signature kept.');
});

/* ---------- Start ---------- */
buildRows();
loadDraft();
try { const s = localStorage.getItem(SIG_KEY); if (s) setSignature(s); } catch (e) {}

$('pnr').setAttribute('list', 'pnrList');
lastPnr = $('pnr').value.trim();
showHistory();

['mobile', 'signMobile'].forEach(id => $(id).addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); }));

// Typing (or picking from the dropdown) a PNR you used before brings its saved details back.
// A new PNR is saved straight away.
$('pnr').addEventListener('input', e => {
  const v = e.target.value = e.target.value.replace(/\D/g, '');
  if (v.length < 10) { lastPnr = ''; return; }
  if (v === lastPnr) return;
  lastPnr = v;
  if (PnrHistory.get(v)) loadPnr(v);
  else { PnrHistory.save(v, { form: snapshot() }); showHistory(); }
  saveDraft();
});
['from', 'to', 'boarding'].forEach(id => $(id).addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); }));
FIELDS.forEach(id => {
  const el = $(id);
  el.addEventListener('input', saveDraft);
  el.addEventListener('change', saveDraft);
  if (id !== 'pnr' && SIGNER[id] === undefined) {
    el.addEventListener('input', rememberSoon);
    el.addEventListener('change', rememberSoon);
  }
  el.addEventListener('blur', () => { if (REQUIRED.includes(id) && el.value.trim()) check(id); });
});
$('fetchPnr').addEventListener('click', fetchPnr);
$('pnr').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fetchPnr(); } });

$('sigOpen').addEventListener('click', () => { dlg.showModal(); switchTab('draw'); });
$('sigRemove').addEventListener('click', () => setSignature(''));
$('sigClose').addEventListener('click', () => dlg.close());
$('sigCancel').addEventListener('click', () => dlg.close());
$('sigApply').addEventListener('click', applySignature);
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
