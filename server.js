// server.js — the backend.
// It receives a PNR from the browser, calls the railway API (keeping your
// API key secret), and sends back clean, simple data.

require('dotenv').config();
const express = require('express');
const path = require('path');
// Compact station index from the Datameet Indian Railways dataset (CC0).
const stationNames = require('./data/stations.json');
const RAILRADAR_API_KEY = process.env.RAILRADAR_API_KEY;

const app = express();
const PORT = process.env.PORT || 3000;

// While USE_MOCK is true, the app returns fake data, so you can build and
// test without spending your limited free API calls.
const USE_MOCK = process.env.USE_MOCK !== 'false';

// Serve the frontend files from public/.
app.get('/', (req, res) => {
  res.redirect('/requisition.html');
});

app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory cache: the same PNR checked again within 10 minutes
// is answered from memory instead of calling the API again.
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;
const scheduleCache = new Map();
const SCHEDULE_CACHE_MS = 24 * 60 * 60 * 1000;

async function getBoardingDeparture(trainNumber, boardingCode) {
  if (!RAILRADAR_API_KEY) {
    return { error: 'Set RAILRADAR_API_KEY in Render to enable automatic boarding-time lookup.' };
  }
  const cacheKey = `${trainNumber}:${boardingCode}`;
  const cached = scheduleCache.get(cacheKey);
  if (cached && Date.now() - cached.time < SCHEDULE_CACHE_MS) return { time: cached.departure };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://api.railradar.in/v1/trains/${encodeURIComponent(trainNumber)}`, {
      headers: { Authorization: `Bearer ${RAILRADAR_API_KEY}` },
      signal: controller.signal,
    });
    if (!response.ok) return { error: `Train schedule lookup failed (HTTP ${response.status}).` };

    const result = await response.json();
    if (result.success === false) {
      return { error: result.error && result.error.message ? result.error.message : 'Train schedule lookup failed.' };
    }

    const route = result.data && Array.isArray(result.data.route) ? result.data.route : [];
    const stop = route.find(item => {
      const station = item.station || {};
      return String(station.code || item.stationCode || '').toUpperCase() === String(boardingCode).toUpperCase();
    });
    const departure = stop && (stop.departure || stop.departureTime || '');
    if (!departure) return { error: `No scheduled departure found for boarding station ${boardingCode}.` };

    scheduleCache.set(cacheKey, { departure, time: Date.now() });
    return { time: departure };
  } catch (error) {
    return { error: error.name === 'AbortError' ? 'Train schedule lookup timed out.' : 'Train schedule lookup failed; check the API key and try again.' };
  } finally {
    clearTimeout(timeout);
  }
}

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
    boardingTime: '18:15',
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
  const firstValue = (object, keys) => {
    if (!object || typeof object !== 'object') return '';
    for (const key of keys) {
      const value = object[key];
      if (value !== undefined && value !== null && typeof value !== 'object' && value !== '') return value;
    }
    for (const value of Object.values(object)) {
      if (value && typeof value === 'object') {
        const found = firstValue(value, keys);
        if (found) return found;
      }
    }
    return '';
  };
  const from = d.From || d.SourceStation || d.sourceStation || d.fromStation || '';
  const to = d.To || d.DestinationStation || d.destinationStation || d.toStation || '';
  const boarding = d.BoardingPoint || d.boardingPoint || d.boardingStation || '';
  const boardingTime = firstValue(d, [
    'boardingTime', 'BoardingTime', 'boardingStationDepartureTime', 'BoardingStationDepartureTime',
    'boardingPointDepartureTime', 'BoardingPointDepartureTime', 'departureTimeAtBoardingStation',
    'DepartureTimeAtBoardingStation', 'departureTimeFromBoardingPoint', 'DepartureTimeFromBoardingPoint',
    'timeOfBoarding', 'TimeOfBoarding', 'boardingDateTime', 'BoardingDateTime',
  ]) || (String(boarding).trim().toUpperCase() === String(from).trim().toUpperCase()
    ? firstValue(d, ['sourceDepartureTime', 'SourceDepartureTime', 'scheduledDepartureTime', 'ScheduledDepartureTime', 'trainDepartureTime', 'TrainDepartureTime', 'departureTime', 'DepartureTime'])
    : '');
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
    boardingTime,
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
      if (!data.boardingTime && data.trainNumber && data.boarding) {
        const schedule = await getBoardingDeparture(data.trainNumber, data.boarding);
        data.boardingTime = schedule.time || '';
        if (schedule.error) data.scheduleError = schedule.error;
      }
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
