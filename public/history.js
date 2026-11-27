// history.js — remembers PNRs in this browser (localStorage) so you never type them twice.
// Used by both the status page and the requisition form.
// Saved per PNR:  api  = the last PNR status result,  form = the requisition form entries.
// Everything stays in this browser. Nothing is sent to the server.

const PnrHistory = (() => {
  const KEY = 'pnr-history';
  const MAX = 30;     // how many PNRs to remember
  const SHOWN = 10;   // how many chips to show
  const MAX_SNAPSHOTS = 20;

  const read = () => {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  };
  const write = list => {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) {}
  };

  // Short line under each PNR, e.g. "GIMB to KYQ"
  function describe(e) {
    const src = e.api || e.form || {};
    const route = src.from && src.to ? `${String(src.from).toUpperCase()} to ${String(src.to).toUpperCase()}` : '';
    return route || 'Saved';
  }

  function snapshotSignature(snapshot) {
    return JSON.stringify({
      chartStatus: snapshot.chartStatus || '',
      passengers: (Array.isArray(snapshot.passengers) ? snapshot.passengers : []).map(p => [p.bookingStatus || '', p.currentStatus || '']),
    });
  }

  return {
    list: read,
    get: pnr => read().find(e => e.pnr === pnr) || null,

    // Adds the PNR (or updates it), keeps what was already saved, and moves it to the top.
    save(pnr, patch = {}) {
      if (!/^\d{10}$/.test(pnr)) return null;
      const list = read();
      const old = list.find(e => e.pnr === pnr) || {};
      const entry = { ...old, ...patch, pnr, savedAt: Date.now() };
      write([entry, ...list.filter(e => e.pnr !== pnr)]);
      return entry;
    },

    saveStatus(pnr, api) {
      if (!/^\d{10}$/.test(pnr) || !api) return null;
      const entry = this.save(pnr, { api });
      if (!entry) return null;
      const snapshot = {
        checkedAt: Date.now(),
        chartStatus: api.chartStatus || '',
        passengers: (api.passengers || []).map((p, i) => ({
          number: p.number || i + 1,
          bookingStatus: p.bookingStatus || '',
          currentStatus: p.currentStatus || '',
        })),
      };
      const history = Array.isArray(entry.statusHistory) ? entry.statusHistory : [];
      if (history.length && snapshotSignature(history[history.length - 1]) === snapshotSignature(snapshot)) return entry;
      entry.statusHistory = [...history, snapshot].slice(-MAX_SNAPSHOTS);
      write(read().map(item => item.pnr === pnr ? entry : item));
      return entry;
    },

    importEntries(entries) {
      if (!Array.isArray(entries)) throw new Error('Backup must contain a list of saved PNRs.');
      const merged = new Map(read().map(entry => [entry.pnr, entry]));
      let imported = 0;
      entries.forEach(source => {
        if (!source || typeof source !== 'object' || typeof source.pnr !== 'string' || !/^\d{10}$/.test(source.pnr)) return;
        const old = merged.get(source.pnr) || {};
        const item = { ...old, pnr: source.pnr, savedAt: Number(source.savedAt) || Date.now() };
        if (source.api && typeof source.api === 'object' && !Array.isArray(source.api)) item.api = source.api;
        if (source.form && typeof source.form === 'object' && !Array.isArray(source.form)) item.form = source.form;
        const snapshots = Array.isArray(source.statusHistory) ? source.statusHistory.filter(s =>
          s && typeof s === 'object' && Number.isFinite(Number(s.checkedAt)) &&
          !Number.isNaN(new Date(Number(s.checkedAt)).getTime())
        ).map(s => ({
          checkedAt: Number(s.checkedAt),
          chartStatus: typeof s.chartStatus === 'string' ? s.chartStatus : '',
          passengers: Array.isArray(s.passengers) ? s.passengers.filter(p => p && typeof p === 'object').map((p, i) => ({
            number: String(p.number || i + 1),
            bookingStatus: typeof p.bookingStatus === 'string' ? p.bookingStatus : '',
            currentStatus: typeof p.currentStatus === 'string' ? p.currentStatus : '',
          })) : [],
        })) : [];
        if (snapshots.length) {
          const unique = new Map([...(old.statusHistory || []), ...snapshots].map(s => [`${s.checkedAt}:${snapshotSignature(s)}`, s]));
          item.statusHistory = [...unique.values()].sort((a, b) => a.checkedAt - b.checkedAt).slice(-MAX_SNAPSHOTS);
        }
        merged.set(source.pnr, item);
        imported++;
      });
      write([...merged.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)));
      return imported;
    },

    remove(pnr) {
      write(read().filter(e => e.pnr !== pnr));
      localStorage.removeItem('pnr-alert-' + pnr);
      window.dispatchEvent(new Event('pnr-history-updated'));
    },
    clear() {
      read().forEach(e => localStorage.removeItem('pnr-alert-' + e.pnr));
      write([]);
      window.dispatchEvent(new Event('pnr-history-updated'));
    },

    // Draws the "Saved PNRs" chips into `box`. onPick(pnr) runs when a chip is clicked.
    render(box, onPick) {
      const list = read();

      // also feed the browser's autocomplete (<datalist id="pnrList">) if the page has one
      const dl = document.getElementById('pnrList');
      if (dl) {
        dl.innerHTML = '';
        list.forEach(e => { const o = document.createElement('option'); o.value = e.pnr; dl.appendChild(o); });
      }

      box.innerHTML = '';
      box.hidden = false;

      const head = document.createElement('div');
      head.className = 'hist-head';
      const title = document.createElement('span');
      title.textContent = 'Saved PNRs';
      const tools = document.createElement('div');
      tools.className = 'hist-tools';
      const exportButton = document.createElement('button');
      exportButton.type = 'button'; exportButton.className = 'hist-clear'; exportButton.textContent = 'Export';
      exportButton.disabled = list.length === 0;
      exportButton.addEventListener('click', () => window.dispatchEvent(new Event('pnr-export')));
      const importButton = document.createElement('button');
      importButton.type = 'button'; importButton.className = 'hist-clear'; importButton.textContent = 'Import';
      importButton.addEventListener('click', () => window.dispatchEvent(new Event('pnr-import')));
      tools.append(exportButton, importButton);
      const clear = document.createElement('button');
      clear.type = 'button'; clear.className = 'hist-clear'; clear.textContent = 'Clear all';
      clear.disabled = list.length === 0;
      clear.addEventListener('click', () => {
        if (confirm('Remove all saved PNRs from this browser?')) this.clear();
      });
      head.append(title, tools, clear);

      const wrap = document.createElement('div');
      wrap.className = 'hist-list';
      list.slice(0, SHOWN).forEach(e => {
        const item = document.createElement('div');
        item.className = 'hist-item';

        const pick = document.createElement('button');
        pick.type = 'button'; pick.className = 'hist-pick';
        const num = document.createElement('span'); num.className = 'hist-pnr'; num.textContent = e.pnr;
        const sub = document.createElement('span'); sub.className = 'hist-sub'; sub.textContent = describe(e);
        pick.append(num, sub);
        pick.addEventListener('click', () => onPick(e.pnr));

        const del = document.createElement('button');
        del.type = 'button'; del.className = 'hist-del'; del.innerHTML = '&times;';
        del.setAttribute('aria-label', `Remove PNR ${e.pnr}`);
        del.addEventListener('click', () => this.remove(e.pnr));

        item.append(pick, del);
        wrap.appendChild(item);
      });

      if (list.length) box.append(head, wrap);
      else {
        const empty = document.createElement('p');
        empty.className = 'hist-empty';
        empty.textContent = 'No saved PNRs yet. You can import a backup here.';
        box.append(head, empty);
      }
    },
  };
})();

const backupInput = document.createElement('input');
backupInput.type = 'file';
backupInput.accept = 'application/json,.json';
backupInput.hidden = true;
document.body.appendChild(backupInput);

function backupMessage(message, bad) {
  window.dispatchEvent(new CustomEvent('pnr-backup-message', { detail: { message, bad: !!bad } }));
}

window.addEventListener('pnr-export', () => {
  try {
    const blob = new Blob([JSON.stringify(PnrHistory.list(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pnr-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    backupMessage('Could not export saved PNRs.', true);
  }
});

window.addEventListener('pnr-import', () => backupInput.click());
backupInput.addEventListener('change', () => {
  const file = backupInput.files[0];
  backupInput.value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    backupMessage('Backup file is too large (maximum 2 MB).', true);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = PnrHistory.importEntries(JSON.parse(String(reader.result || '')));
      window.dispatchEvent(new Event('pnr-history-updated'));
      backupMessage(`Imported ${imported} saved PNR${imported === 1 ? '' : 's'}.`, false);
    } catch (e) {
      backupMessage(e.message || 'Could not read this backup file.', true);
    }
  };
  reader.onerror = () => backupMessage('Could not read this backup file.', true);
  reader.readAsText(file);
});
