// Proxies BYMA lebacs API (their SSL cert is broken, so browsers can't call it directly)
// Returns LECAP/BONCAP prices with T+1 settlement data
const https = require('https');

const BYMA_URL = 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/lebacs';

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const data = await fetchBYMA();
    const items = data.data || [];

    // Filter T+1 settlement (settlementType=2) with valid prices
    const result = [];
    for (const item of items) {
      if (item.settlementType !== '2') continue;
      const offer = parseFloat(item.offerPrice) || 0;
      const close = parseFloat(item.closingPrice) || 0;
      const price = offer > 0 ? offer : close;
      if (price <= 0) continue;

      result.push({
        symbol: item.symbol,
        price,
        offer,
        bid: parseFloat(item.bidPrice) || 0,
        close,
        trade: parseFloat(item.trade) || 0,
        maturityDate: item.maturityDate,
        daysToMaturity: item.daysToMaturity,
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ data: result }) };
  } catch (e) {
    console.error('BYMA fetch error:', e);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to fetch BYMA data' }) };
  }
};

function fetchBYMA() {
  return new Promise((resolve, reject) => {
    const body = '{}';
    const url = new URL(BYMA_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      rejectUnauthorized: false, // BYMA has broken SSL cert
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from BYMA')); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
