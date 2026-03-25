// Fetches exchange rates: Dólar Oficial (Yahoo), CCL & MEP (data912), Riesgo País (ArgentinaDatos)
const https = require('https');

function fetchJSON(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        res.resume();
        return resolve(fetchJSON(res.headers.location, maxRedirects - 1));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from ' + url)); }
      });
    }).on('error', reject);
  });
}

exports.handler = async () => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' };

  try {
    const [yahooData, bonds, riesgo] = await Promise.allSettled([
      fetchJSON('https://query1.finance.yahoo.com/v8/finance/chart/ARS%3DX?interval=1d&range=5d'),
      fetchJSON('https://data912.com/live/arg_bonds'),
      fetchJSON('https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo'),
    ]);

    // Dólar Oficial from Yahoo Finance (ARS=X is USD/ARS)
    let oficial = null;
    if (yahooData.status === 'fulfilled') {
      try {
        const meta = yahooData.value.chart.result[0].meta;
        oficial = { price: meta.regularMarketPrice, prevClose: meta.chartPreviousClose || meta.previousClose || 0 };
      } catch (e) { /* ignore */ }
    }

    // CCL & MEP from data912 (AL30 ARS, AL30D USD MEP, AL30C USD Cable)
    let ccl = null, mep = null;
    if (bonds.status === 'fulfilled' && Array.isArray(bonds.value)) {
      const al30 = bonds.value.find(b => b.symbol === 'AL30');
      const al30d = bonds.value.find(b => b.symbol === 'AL30D');
      const al30c = bonds.value.find(b => b.symbol === 'AL30C');
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

    // Riesgo País from ArgentinaDatos
    let riesgoPais = null;
    if (riesgo.status === 'fulfilled') {
      const val = riesgo.value;
      if (val && val.valor != null) {
        riesgoPais = { value: val.valor };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        oficial,
        ccl,
        mep,
        riesgoPais,
        updated: new Date().toISOString(),
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
