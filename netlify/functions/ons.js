// Fetches corporate bond (ON) prices from data912
const https = require('https');

const DATA912_URL = 'https://data912.com/live/arg_corp';

function fetch912() {
  return new Promise((resolve, reject) => {
    https.get(DATA912_URL, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

exports.handler = async () => {
  try {
    const allBonds = await fetch912();
    // Filter USD bonds (ending in D) with valid prices
    const usdBonds = allBonds.filter(b => b.symbol.endsWith('D') && b.c > 0);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify({ data: usdBonds, timestamp: new Date().toISOString() })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Failed to fetch ON prices', message: error.message })
    };
  }
};
