// Fetches Argentine stock prices from data912
const https = require('https');

const STOCKS_URL = 'https://data912.com/live/arg_stocks';

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const stocks = await fetchJSON(STOCKS_URL);

    const result = (Array.isArray(stocks) ? stocks : [])
      .filter(s => !s.symbol.endsWith('D') && !s.symbol.endsWith('.D'));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ data: result, source: 'data912' }),
    };
  } catch (e) {
    console.error('Acciones fetch error:', e);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to fetch stock data' }) };
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
