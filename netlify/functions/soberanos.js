// Fetches sovereign bond prices from data912 and converts to USD via CCL
const https = require('https');

const BONDS_URL = 'https://data912.com/live/arg_bonds';
const CCL_URL = 'https://data912.com/live/ccl';

const TICKERS = ['AL29','AL30','AL35','AE38','AL41','GD29','GD30','GD35','GD38','GD41'];

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const [bonds, ccl] = await Promise.all([fetchJSON(BONDS_URL), fetchJSON(CCL_URL)]);

    // CCL reference = median of top-10 most liquid from ccl endpoint
    const cclSorted = ccl
      .filter(c => parseFloat(c.CCL_mark) > 0 && parseFloat(c.ars_volume) > 0)
      .sort((a, b) => parseFloat(b.ars_volume) - parseFloat(a.ars_volume));
    const top10 = cclSorted.slice(0, 10).map(c => parseFloat(c.CCL_mark)).sort((a, b) => a - b);
    const mid = Math.floor(top10.length / 2);
    const cclRef = top10.length % 2 === 0 ? (top10[mid - 1] + top10[mid]) / 2 : top10[mid];

    // Build result
    const result = [];
    for (const bond of bonds) {
      if (!TICKERS.includes(bond.symbol)) continue;
      const priceArs = parseFloat(bond.c) || 0;
      if (priceArs <= 0) continue;
      // data912 bond prices are per 100 VN in ARS
      const priceUsd = priceArs / cclRef;
      result.push({
        symbol: bond.symbol,
        price_ars: priceArs,
        price_usd: priceUsd,
        volume: bond.v || 0,
        pct_change: bond.pct_change || 0,
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ data: result, ccl: cclRef, source: 'data912' }),
    };
  } catch (e) {
    console.error('Soberanos fetch error:', e);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to fetch sovereign bond data' }) };
  }
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from ' + url)); }
      });
    }).on('error', reject);
  });
}
