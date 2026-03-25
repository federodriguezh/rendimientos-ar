// Fetches stock + CEDEAR prices from data912
const https = require('https');

const STOCKS_URL = 'https://data912.com/live/arg_stocks';
const CEDEARS_URL = 'https://data912.com/live/arg_cedears';

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

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=60'
  };

  try {
    const [stocks, cedears] = await Promise.all([
      fetchJSON(STOCKS_URL),
      fetchJSON(CEDEARS_URL),
    ]);

    const all = [
      ...(Array.isArray(stocks) ? stocks : []),
      ...(Array.isArray(cedears) ? cedears : [])
    ];

    // Optional filter by symbols query param
    const params = event.queryStringParameters || {};
    let data = all;
    if (params.symbols) {
      const requested = new Set(params.symbols.split(',').map(s => s.trim().toUpperCase()));
      data = all.filter(item => requested.has(item.symbol));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ data, timestamp: new Date().toISOString() }),
    };
  } catch (e) {
    console.error('Portfolio fetch error:', e.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch stock/CEDEAR data' }),
    };
  }
};
