// Tiny backend for the Car Depreciation Tracker. Node 18+, no dependencies.
// Run:  node server.js   then open http://localhost:3000
// Put this file next to your index.html.
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.mudah.my';
const UA = 'Mozilla/5.0 (compatible; personal-depreciation-tracker)';
const MAX_PAGES_PER_YEAR = 3;          // each Mudah page shows about 40 listings
const YEARS_BACK = 14;
const cache = new Map();               // url -> {t, body}
const TTL = 30 * 60 * 1000;

async function get(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < TTL) return hit.body;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!r.ok) throw new Error('Mudah returned HTTP ' + r.status + ' for ' + url);
  const body = await r.text();
  cache.set(url, { t: Date.now(), body });
  return body;
}
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const unique = a => [...new Set(a)];

// "Toyota Harrier" -> "/malaysia/cars-for-sale/toyota/harrier"
async function resolveModel(query) {
  const nq = norm(query);
  const home = await get(BASE + '/malaysia/cars-for-sale');
  const brands = unique([...home.matchAll(/href="\/malaysia\/cars-for-sale\/([a-z0-9-]+)"/g)].map(m => m[1]));
  const brand = brands.filter(b => nq.includes(norm(b))).sort((a, b) => b.length - a.length)[0];
  if (!brand) throw new Error('Could not find a brand in "' + query + '". Try "Brand Model", for example "Toyota Harrier".');
  const rest = nq.replace(norm(brand), '');
  const bp = await get(BASE + '/malaysia/cars-for-sale/' + brand);
  const models = unique([...bp.matchAll(new RegExp('href="/malaysia/cars-for-sale/' + brand + '/([a-z0-9-]+)"', 'g'))].map(m => m[1]))
    .filter(m => !/^(suvs|sedan|mpvs|hatchback|others|coupe|sports|pick-up|4-wheels|petrol|diesel|electric|auto-transmission|manual-transmission)$/.test(m) && !/^(price|mfg)-/.test(m));
  const model = models.filter(m => rest.includes(norm(m))).sort((a, b) => b.length - a.length)[0];
  if (!model) throw new Error('No model matching "' + query + '" under ' + brand + '.');
  return { brand, model, base: '/malaysia/cars-for-sale/' + brand + '/' + model };
}

// Parse listing cards out of a results page. The listing links end in -<id>.htm.
function parseListings(html) {
  const out = [];
  for (const m of html.matchAll(/<a[^>]+href="[^"]*?-(\d{6,})\.htm"[^>]*>([\s\S]*?)<\/a>/g)) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    const price = text.match(/RM\s*([\d,]{5,})/);
    const year = text.match(/\b(20[0-2]\d|19\d\d)\s+\1\b/) || text.match(/\b(20[0-2]\d)\b/);
    const km = text.match(/(\d+)k\s*-\s*(\d+)k|<\s*(\d+)k/);
    const cond = /\bRecon\b/.test(text) ? 'recon' : /\bUsed\b/.test(text) ? 'used' : /\bNew\b/.test(text) ? 'new' : '';
    if (!price || !year) continue;
    out.push({
      id: m[1], year: Number(year[1]), price: Number(price[1].replace(/,/g, '')), condition: cond,
      mileageKm: km ? (km[3] ? Number(km[3]) / 2 : (Number(km[1]) + Number(km[2])) / 2) * 1000 : null
    });
  }
  return out;
}

async function listingsFor(query) {
  const { base } = await resolveModel(query);
  const seen = new Map();
  const thisYear = new Date().getFullYear();
  for (let y = thisYear; y >= thisYear - YEARS_BACK; y--) {
    for (let p = 1; p <= MAX_PAGES_PER_YEAR; p++) {
      let html;
      try { html = await get(BASE + base + '/mfg-year-' + y + (p > 1 ? '?o=' + p : '')); } catch (e) { break; }
      const found = parseListings(html).filter(l => l.year === y);
      const before = seen.size;
      found.forEach(l => seen.set(l.id, l));
      if (seen.size === before) break;   // no new listings, stop paging this year
    }
  }
  return [...seen.values()];
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/listings') {
    try {
      const q = (u.searchParams.get('model') || '').trim();
      if (!q) throw new Error('Missing model');
      const listings = await listingsFor(q);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ listings }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(404); res.end('index.html not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(data);
  });
}).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
