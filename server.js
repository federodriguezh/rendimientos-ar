const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
// Make fetch available globally
global.fetch = fetch;
const PORT = parseInt(process.env.PORT || '3000', 10);
const CONFIG_PATH = path.join(__dirname, 'public', 'config.json');

app.disable('x-powered-by');
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "connect-src 'self' https://api.argentinadatos.com https://data912.com https://api.bcra.gob.ar",
      "frame-src 'none'",
      "object-src 'none'",
    ].join('; ')
  );
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// --- Config API ---

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

// Public read
app.get('/api/config', (req, res) => {
  res.json(readConfig());
});

// --- FCI Data (via ArgentinaDatos) ---

app.get('/api/fci', async (req, res) => {
  try {
    const [mmLatest, mmPrevious, rmLatest, rmPrevious] = await Promise.all([
      fetch('https://api.argentinadatos.com/v1/finanzas/fci/mercadoDinero/ultimo').then(r => r.json()),
      fetch('https://api.argentinadatos.com/v1/finanzas/fci/mercadoDinero/penultimo').then(r => r.json()),
      fetch('https://api.argentinadatos.com/v1/finanzas/fci/rentaMixta/ultimo').then(r => r.json()),
      fetch('https://api.argentinadatos.com/v1/finanzas/fci/rentaMixta/penultimo').then(r => r.json()),
    ]);
    const filterValid = d => d.filter(x => x.fecha && x.vcp);
    const allLatest = [...filterValid(mmLatest), ...filterValid(rmLatest)];
    const allPrevious = [...filterValid(mmPrevious), ...filterValid(rmPrevious)];
    const prevMap = {};
    for (const f of allPrevious) prevMap[f.fondo] = f;
    const results = [];
    for (const fund of allLatest) {
      const prev = prevMap[fund.fondo];
      if (!prev || !prev.vcp || !fund.vcp) continue;
      const days = Math.abs(Math.round((new Date(fund.fecha) - new Date(prev.fecha)) / 86400000));
      if (days <= 0) continue;
      const tna = Math.round(((fund.vcp - prev.vcp) / prev.vcp / days) * 365 * 100 * 100) / 100;
      results.push({ nombre: fund.fondo, tna, patrimonio: fund.patrimonio, fechaDesde: prev.fecha, fechaHasta: fund.fecha });
    }
    res.json({ data: results });
  } catch (err) {
    console.error('FCI proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch FCI data' });
  }
});

// --- CAFCI Ficha Proxy (for comparar.html) ---

app.get('/api/cafci/ficha/:fondoId/:claseId', async (req, res) => {
  const { fondoId, claseId } = req.params;
  const url = `https://api.cafci.org.ar/estadisticas/informacion/diaria/ficha/${encodeURIComponent(fondoId)}/${encodeURIComponent(claseId)}`;
  try {
    const resp = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Referer': 'https://www.cafci.org.ar/',
        'Origin': 'https://www.cafci.org.ar',
      }
    });
    if (!resp.ok) throw new Error(`CAFCI API returned ${resp.status}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error('CAFCI ficha proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch CAFCI ficha data' });
  }
});

// --- Soberanos USD Prices (data912 proxy) ---

app.get('/api/soberanos', async (req, res) => {
  try {
    const response = await fetch('https://data912.com/live/arg_bonds');
    if (!response.ok) {
      throw new Error(`data912 API error: ${response.status}`);
    }
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      throw new Error('Invalid data912 API response format');
    }

    const TICKERS_USD = ['BPD7D','AO27D','AN29D','AL29D','AL30D','AL35D','AE38D','AL41D','GD29D','GD30D','GD35D','GD38D','GD41D'];
    
    const result = [];
    for (const bond of data) {
      if (!TICKERS_USD.includes(bond.symbol)) continue;
      const priceUsd = parseFloat(bond.c) || 0;
      if (priceUsd <= 0) continue;
      const baseSymbol = bond.symbol.replace(/D$/, '');
      result.push({
        symbol: baseSymbol,
        price_usd: priceUsd,
        bid: parseFloat(bond.px_bid) || 0,
        ask: parseFloat(bond.px_ask) || 0,
        volume: bond.v || 0,
        pct_change: bond.pct_change || 0,
      });
    }

    res.json({ data: result, source: 'data912' });
  } catch (err) {
    console.error('Soberanos proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch soberanos data' });
  }
});

// --- LECAP/BONCAP Prices (data912 proxy) ---

app.get('/api/lecaps', async (req, res) => {
  try {
    const [notes, bonds] = await Promise.all([
      fetch('https://data912.com/live/arg_notes').then(r => r.json()),
      fetch('https://data912.com/live/arg_bonds').then(r => r.json()),
    ]);
    const LECAP_TICKERS = ['S17A6','S30A6','S15Y6','S29Y6','S31L6','S31G6','S30S6','S30O6','S30N6'];
    const BONCAP_TICKERS = ['T30J6','T15E7','T30A7','T31Y7','T30J7'];
    const result = [];
    for (const item of notes) {
      if (!LECAP_TICKERS.includes(item.symbol)) continue;
      if (parseFloat(item.c) <= 0) continue;
      result.push({ symbol: item.symbol, price: item.c, bid: item.px_bid || 0, ask: item.px_ask || 0, type: 'LECAP' });
    }
    for (const item of bonds) {
      if (!BONCAP_TICKERS.includes(item.symbol)) continue;
      if (parseFloat(item.c) <= 0) continue;
      result.push({ symbol: item.symbol, price: item.c, bid: item.px_bid || 0, ask: item.px_ask || 0, type: 'BONCAP' });
    }
    res.json({ data: result, source: 'data912' });
  } catch (err) {
    console.error('LECAP proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch LECAP data' });
  }
});

// --- CER Data (via BCRA API) ---

app.get('/api/cer', async (req, res) => {
  try {
    const response = await fetch('https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/30', {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error('BCRA API error: ' + response.status);

    const data = await response.json();
    const detalle = data.results?.[0]?.detalle;
    if (!detalle?.length) throw new Error('No CER data available');

    // Calcular fecha T-10 (10 días hábiles antes del settlement T+1)
    const hoy = new Date();
    const t1 = new Date(hoy);
    t1.setDate(t1.getDate() + 1);
    const fc = new Date(t1);
    fc.setDate(fc.getDate() - 14);
    const fcStr = fc.toISOString().split('T')[0];

    // BCRA retorna datos en orden descendente (más reciente primero)
    let cerT10 = null;
    for (let i = 0; i < detalle.length; i++) {
      if (detalle[i].fecha <= fcStr) { cerT10 = detalle[i]; break; }
    }
    if (!cerT10) cerT10 = detalle[detalle.length - 1];

    res.json({ cer: cerT10.valor, fecha: cerT10.fecha, fuente: 'BCRA (T-10)' });
  } catch (err) {
    console.error('CER proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch CER data' });
  }
});

// --- CER Bond Prices (via data912) ---

app.get('/api/cer-precios', async (req, res) => {
  try {
    const response = await fetch('https://data912.com/live/arg_bonds');
    const data = await response.json();
    
    const TICKERS_CER = ['TZX26', 'TZXO6', 'TX26', 'TZXD6', 'TZXM7', 'TZX27', 'TZXD7', 'TZX28', 'TX28', 'DICP', 'PARP'];
    
    const bondsArray = Array.isArray(data) ? data : (data.data || []);
    const bonosCER = bondsArray.filter(bond => TICKERS_CER.includes(bond.symbol));
    
    res.json({
      data: bonosCER,
      timestamp: new Date().toISOString(),
      count: bonosCER.length
    });
  } catch (err) {
    console.error('CER prices proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch CER bond prices' });
  }
});

// --- Acciones Argentinas (via data912) ---

app.get('/api/acciones', async (req, res) => {
  try {
    const response = await fetch('https://data912.com/live/arg_stocks');
    const data = await response.json();

    const stocks = (Array.isArray(data) ? data : []).filter(s => !s.symbol.endsWith('D') && !s.symbol.endsWith('.D'));

    res.json({ data: stocks, source: 'data912' });
  } catch (err) {
    console.error('Acciones proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch stock prices' });
  }
});

// --- CEDEARs (via data912) ---

app.get('/api/cedears', async (req, res) => {
  try {
    const response = await fetch('https://data912.com/live/arg_cedears');
    const data = await response.json();

    const cedears = (Array.isArray(data) ? data : []).filter(s => !s.symbol.endsWith('D') && !s.symbol.endsWith('C'));

    res.json({ data: cedears, source: 'data912' });
  } catch (err) {
    console.error('CEDEARs proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch CEDEAR prices' });
  }
});

// --- Hot US Movers (Yahoo Finance proxy) ---

app.get('/api/hot-movers', async (req, res) => {
  const POOL = [
    'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','AMD','NFLX','COIN',
    'PLTR','SMCI','MSTR','AVGO','CRM','UBER','SNOW','SQ','SHOP','RIVN',
    'SOFI','HOOD','INTC','BA','DIS','NKE','PYPL','BABA','JPM','V',
  ];

  try {
    const results = await Promise.allSettled(POOL.map(async (symbol) => {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const json = await r.json();
      const result = json.chart.result[0];
      const meta = result.meta;
      const price = meta.regularMarketPrice;
      const prevClose = meta.chartPreviousClose || meta.previousClose || 0;
      const change = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
      return { symbol: meta.symbol || symbol, name: meta.shortName || meta.longName || symbol, price, change: Math.round(change * 100) / 100 };
    }));

    const data = results
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter(q => q && q.price != null && q.change != null)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 5);

    res.json({ data, updated: new Date().toISOString() });
  } catch (err) {
    console.error('Hot movers proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch hot movers data' });
  }
});

// --- Cotizaciones (Dólar Oficial, CCL, MEP, Riesgo País) ---

app.get('/api/cotizaciones', async (req, res) => {
  try {
    const [yahooResp, bondsResp, riesgoResp] = await Promise.allSettled([
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/ARS%3DX?interval=1d&range=5d', { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()),
      fetch('https://data912.com/live/arg_bonds').then(r => r.json()),
      fetch('https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo').then(r => r.json()),
    ]);

    let oficial = null;
    if (yahooResp.status === 'fulfilled') {
      try {
        const meta = yahooResp.value.chart.result[0].meta;
        oficial = { price: meta.regularMarketPrice, prevClose: meta.chartPreviousClose || meta.previousClose || 0 };
      } catch (e) { /* ignore */ }
    }

    let ccl = null, mep = null;
    if (bondsResp.status === 'fulfilled' && Array.isArray(bondsResp.value)) {
      const al30 = bondsResp.value.find(b => b.symbol === 'AL30');
      const al30d = bondsResp.value.find(b => b.symbol === 'AL30D');
      const al30c = bondsResp.value.find(b => b.symbol === 'AL30C');
      const arsPrice = al30 ? parseFloat(al30.c) : 0;
      if (al30c && arsPrice > 0) {
        const cclUsd = parseFloat(al30c.c);
        if (cclUsd > 0) ccl = { price: Math.round((arsPrice / cclUsd) * 100) / 100 };
      }
      if (al30d && arsPrice > 0) {
        const mepUsd = parseFloat(al30d.c);
        if (mepUsd > 0) mep = { price: Math.round((arsPrice / mepUsd) * 100) / 100 };
      }
    }

    let riesgoPais = null;
    if (riesgoResp.status === 'fulfilled' && riesgoResp.value && riesgoResp.value.valor != null) {
      riesgoPais = { value: riesgoResp.value.valor };
    }

    res.json({ oficial, ccl, mep, riesgoPais, updated: new Date().toISOString() });
  } catch (err) {
    console.error('Cotizaciones proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch cotizaciones' });
  }
});

// --- ONs (Corporate Bonds via data912) ---

app.get('/api/ons', async (req, res) => {
  try {
    const response = await fetch('https://data912.com/live/arg_corp');
    const data = await response.json();

    const usdBonds = (Array.isArray(data) ? data : []).filter(b => b.symbol.endsWith('D') && b.c > 0);

    res.json({ data: usdBonds, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('ONs proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch ON prices' });
  }
});

// --- Mundo (Global Markets via Yahoo Finance) ---

const MUNDO_SYMBOLS = [
  { id: 'spx', symbol: 'ES%3DF', name: 'S&P 500', icon: '📈' },
  { id: 'nasdaq', symbol: 'NQ%3DF', name: 'Nasdaq 100', icon: '💻' },
  { id: 'dow', symbol: 'YM%3DF', name: 'Dow Jones', icon: '🏦' },
  { id: 'tnx', symbol: '%5ETNX', name: 'Tasa 10Y USA', icon: '🏛️' },
  { id: 'oil', symbol: 'CL%3DF', name: 'Petróleo WTI', icon: '🛢️' },
  { id: 'brent', symbol: 'BZ%3DF', name: 'Petróleo Brent', icon: '🛢️' },
  { id: 'gold', symbol: 'GC%3DF', name: 'Oro', icon: '🥇' },
  { id: 'btc', symbol: 'BTC-USD', name: 'Bitcoin', icon: '₿' },
  { id: 'eth', symbol: 'ETH-USD', name: 'Ethereum', icon: 'Ξ' },
  { id: 'eurusd', symbol: 'EURUSD%3DX', name: 'EUR/USD', icon: '🇪🇺' },
];

function fetchYahooRaw(symbolEncoded, interval, range) {
  return new Promise((resolve, reject) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbolEncoded}?interval=${interval}&range=${range}`;
    const req = require('https').get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const result = json.chart.result[0];
          const meta = result.meta;
          const closes = result.indicators.quote[0].close || [];
          const spark = closes.filter(v => v !== null);
          resolve({ price: meta.regularMarketPrice, prevClose: meta.chartPreviousClose || meta.previousClose || 0, sparkline: spark });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function fetchYahooChart(symbolEncoded, interval, range) {
  return new Promise((resolve, reject) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbolEncoded}?interval=${interval}&range=${range}`;
    const req = require('https').get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const result = json.chart.result[0];
          const timestamps = result.timestamp || [];
          const closes = result.indicators.quote[0].close || [];
          const points = [];
          for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] !== null) points.push({ t: timestamps[i] * 1000, v: closes[i] });
          }
          resolve(points);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

app.get('/api/mundo', async (req, res) => {
  const qs = req.query || {};

  // Detail mode: /api/mundo?symbol=btc  OR  /api/mundo?ticker=AAPL
  if (qs.symbol || qs.ticker) {
    try {
      let symEncoded, id, name, icon;
      if (qs.ticker) {
        symEncoded = encodeURIComponent(qs.ticker.toUpperCase());
        id = qs.ticker.toLowerCase();
        name = qs.name || qs.ticker;
        icon = '';
      } else {
        const sym = MUNDO_SYMBOLS.find(s => s.id === qs.symbol);
        if (!sym) return res.status(404).json({ error: 'Unknown symbol' });
        symEncoded = sym.symbol;
        id = sym.id;
        name = sym.name;
        icon = sym.icon;
      }
      const range = qs.range || '5d';
      const interval = range === '1d' ? '5m' : range === '5d' ? '15m' : range === '1mo' ? '1h' : '1d';
      let points = await fetchYahooChart(symEncoded, interval, range);
      if (points.length === 0 && range === '1d') {
        points = await fetchYahooChart(symEncoded, '15m', '5d');
      }
      return res.json({ id, name, icon, range, points });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Default: all symbols overview
  try {
    const fetches = MUNDO_SYMBOLS.map(async (s) => {
      try {
        const { price, prevClose, sparkline } = await fetchYahooRaw(s.symbol, '5m', '1d');
        const spark = sparkline.length < 10 ? await fetchYahooRaw(s.symbol, '15m', '5d') : { price, prevClose, sparkline };
        const p = spark.price || price;
        const pc = spark.prevClose || prevClose;
        const change = pc ? Math.round(((p - pc) / pc) * 10000) / 100 : 0;
        return { ...s, price: p, prevClose: pc, change, sparkline: spark.sparkline || sparkline };
      } catch {
        return { ...s, price: null, prevClose: null, change: null, sparkline: [], error: true };
      }
    });
    const data = await Promise.all(fetches);
    res.json({ data, updated: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- News (Google News RSS) ---

app.get('/api/news', async (req, res) => {
  try {
    const feedUrl = 'https://news.google.com/rss/search?q=when:3h+mercados+OR+dolar+OR+bolsa+OR+wall+street+OR+bitcoin+OR+acciones+OR+bonos&hl=es-419&gl=AR&ceid=AR:es-419';
    const { URL } = require('url');
    const parsed = new URL(feedUrl);
    const xml = await new Promise((resolve) => {
      const req2 = require('https').get({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000,
      }, (r) => {
        let data = '';
        r.on('data', d => data += d);
        r.on('end', () => resolve(data));
      });
      req2.on('error', () => resolve(''));
      req2.on('timeout', () => { req2.destroy(); resolve(''); });
    });

    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const block = match[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
      const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
      const source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '';
      const cleanTitle = title
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/ - [^-]+$/, '');
      if (cleanTitle) {
        items.push({
          title: cleanTitle.trim(),
          source: source.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
          link: link.trim(),
          date: pubDate.trim(),
        });
      }
    }
    res.json({ data: items.slice(0, 20), updated: new Date().toISOString() });
  } catch (err) {
    console.error('News proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch news' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
