// server.js — the backend.
// It receives a PNR from the browser, calls the railway API (keeping your
// API key secret), and sends back clean, simple data.

require('dotenv').config();
const express = require('express');
const path = require('path');
// Compact station index from the Datameet Indian Railways dataset (CC0).
const stationNames = require('./data/stations.json');

const app = express();
const PORT = process.env.PORT || 3000;

// While USE_MOCK is true, the app returns fake data, so you can build and
// test without spending your limited free API calls.
const USE_MOCK = process.env.USE_MOCK !== 'false';

// Serve the frontend files from public/.
app.get('/', (req, res) => {
  res.redirect('/requisition.html');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', mock: USE_MOCK });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/stations', (req, res) => {
  const query = String(req.query.q || '').trim().toUpperCase();
  const entries = Object.entries(stationNames);
  const matches = entries
    .filter(([code, name]) => !query || code.includes(query) || name.toUpperCase().includes(query))
    .sort(([a, an], [b, bn]) => {
      if (!query) return an.localeCompare(bn);
      const ac = a.startsWith(query) ? 0 : 1;
      const bc = b.startsWith(query) ? 0 : 1;
      return ac - bc || an.localeCompare(bn);
    })
    .slice(0, 20)
    .map(([code, name]) => ({ code, name }));
  res.json(matches);
});

// Simple in-memory cache: the same PNR checked again within 10 minutes
// is answered from memory instead of calling the API again.
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

// ---------- Fake data for development ----------
function mockPnr(pnr) {
  return {
    mock: true, // lets the pages say "sample data" when mock mode is on
    pnr,
    trainNumber: '12046',
    trainName: 'CDG NDLS SHATABDI',
    from: 'CDG',
    to: 'NDLS',
    boarding: 'CDG',
    fromName: 'CHANDIGARH',
    toName: 'NEW DELHI',
    boardingName: 'CHANDIGARH',
    journeyDate: '05-12-2026',
    travelClass: 'CC',
    chartStatus: 'Chart Not Prepared',
    passengers: [
      { number: 1, bookingStatus: 'WL/12', currentStatus: 'CNF/C3/41' },
      { number: 2, bookingStatus: 'WL/13', currentStatus: 'RAC/2' },
      { number: 3, bookingStatus: 'WL/14', currentStatus: 'WL/4' },
    ],
  };
}

// ---------- Convert the API's answer into OUR format ----------
// Every API names its fields differently. When you switch to the real API,
// look at the response printed in your terminal and fix the field names here.
function normalize(pnr, raw) {
  const d = raw.data || raw;

  let chartStatus = 'Unknown';
  if (typeof d.ChartPrepared === 'boolean') {
    chartStatus = d.ChartPrepared ? 'Chart Prepared' : 'Chart Not Prepared';
  } else if (typeof d.chartPrepared === 'boolean') {
    chartStatus = d.chartPrepared ? 'Chart Prepared' : 'Chart Not Prepared';
  } else if (d.chartStatus) {
    chartStatus = d.chartStatus;
  }

  const list = d.PassengerStatus || d.passengerStatus || d.passengerList || d.passengers || [];
  const from = d.From || d.SourceStation || d.sourceStation || d.fromStation || '';
  const to = d.To || d.DestinationStation || d.destinationStation || d.toStation || '';
  const boarding = d.BoardingPoint || d.boardingPoint || d.boardingStation || '';
  const fullStationName = value => {
    const code = String(value || '').trim().toUpperCase();
    return stationNames[code] || '';
  };
  const fullTrainName = String(d.TrainName || d.trainName || '').replace(/\b(EXP|SF|SPL|PASS)\b\.?/gi, word => ({
    EXP: 'EXPRESS', SF: 'SUPERFAST', SPL: 'SPECIAL', PASS: 'PASSENGER',
  })[word.replace(/\./g, '').toUpperCase()] || word);

  return {
    pnr,
    trainNumber: d.TrainNo || d.trainNo || d.trainNumber || d.TrainNumber || '',
    trainName: fullTrainName,
    from,
    to,
    boarding,
    fromName: d.FromName || d.SourceStationName || d.sourceStationName || d.FromStationName || fullStationName(from),
    toName: d.ToName || d.DestinationStationName || d.destinationStationName || d.ToStationName || fullStationName(to),
    boardingName: d.BoardingPointName || d.BoardingStationName || d.boardingPointName || d.boardingStationName || fullStationName(boarding),
    journeyDate: d.Doj || d.DOJ || d.dateOfJourney || d.journeyDate || '',
    travelClass: d.Class || d.class || d.journeyClass || d.travelClass || '',
    chartStatus,
    passengers: list.map((p, i) => ({
      number: p.Number || p.PassengerNumber || p.passengerSerialNumber || p.number || i + 1,
      bookingStatus: p.BookingStatus || p.bookingStatusDetails || p.bookingStatus || '',
      currentStatus: p.CurrentStatus || p.currentStatusDetails || p.currentStatus || '',
    })),
  };
}

// ---------- The API route the frontend calls ----------
app.get('/api/pnr/:pnr', async (req, res) => {
  const { pnr } = req.params;
  if (req.query.refresh === '1') cache.delete(pnr);

  // 1. Validate: a PNR is exactly 10 digits
  if (!/^\d{10}$/.test(pnr)) {
    return res.status(400).json({ error: 'PNR must be exactly 10 digits.' });
  }

  // 2. Check the cache first
  const hit = cache.get(pnr);
  if (hit && Date.now() - hit.time < CACHE_MS) {
    return res.json({ ...hit.data, cached: true });
  }

  try {
    let data;

    if (USE_MOCK) {
      data = mockPnr(pnr);
    } else {
      // 3. Call the real API (needs Node 18+ for built-in fetch)
      if (!process.env.PNR_API_URL || !process.env.RAPIDAPI_KEY || !process.env.RAPIDAPI_HOST) {
        throw new Error('PNR API configuration is incomplete');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(process.env.PNR_API_URL + encodeURIComponent(pnr), {
        headers: {
          'x-rapidapi-key': process.env.RAPIDAPI_KEY,
          'x-rapidapi-host': process.env.RAPIDAPI_HOST,
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        throw new Error(`API responded with status ${response.status}`);
      }

      const raw = await response.json();
      // Print the real response so you can adjust normalize() if needed
      if (raw.success === false) {
        return res.status(404).json({
          error: raw.message || 'PNR status is unavailable.',
        });
      }
      data = normalize(pnr, raw);
    }

    // 4. Save to cache and send to the browser
    cache.set(pnr, { data, time: Date.now() });
    res.json(data);
  } catch (err) {
    console.error('Error:', err.message);
    res
      .status(502)
      .json({ error: 'Could not fetch PNR status right now. Please try again later.' });
  }
});

app.listen(PORT, () => {
  console.log(`PNR app running at http://localhost:${PORT}  (mock mode: ${USE_MOCK})`);
});
