// history.js — remembers PNRs in this browser (localStorage) so you never type them twice.
// Used by both the status page and the requisition form.
// Saved per PNR:  api  = the last PNR status result,  form = the requisition form entries.
// Everything stays in this browser. Nothing is sent to the server.

const PnrHistory = (() => {
  const KEY = 'pnr-history';
  const MAX = 30;     // how many PNRs to remember
  const SHOWN = 10;   // how many chips to show

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

    remove(pnr) { write(read().filter(e => e.pnr !== pnr)); },
    clear() { write([]); },

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
      box.hidden = list.length === 0;
      if (!list.length) return;

      const head = document.createElement('div');
      head.className = 'hist-head';
      const title = document.createElement('span');
      title.textContent = 'Saved PNRs';
      const clear = document.createElement('button');
      clear.type = 'button'; clear.className = 'hist-clear'; clear.textContent = 'Clear all';
      clear.addEventListener('click', () => {
        if (confirm('Remove all saved PNRs from this browser?')) { this.clear(); this.render(box, onPick); }
      });
      head.append(title, clear);

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
        del.addEventListener('click', () => { this.remove(e.pnr); this.render(box, onPick); });

        item.append(pick, del);
        wrap.appendChild(item);
      });

      box.append(head, wrap);
    },
  };
})();
