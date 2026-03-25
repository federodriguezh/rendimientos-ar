# CLAUDE.md

## Proyecto

Rendimientos AR - Sitio para comparar rendimientos de productos financieros en Argentina, monitorear mercados globales, y gestionar portfolios de inversiones. Live en [rendimientos.co](https://rendimientos.co).

## Stack

- **Frontend**: Vanilla JS + CSS (no framework), Chart.js para graficos
- **Backend**: Express.js (local dev), Netlify Functions (prod)
- **Datos**: ArgentinaDatos API (FCIs, Plazo Fijo), data912 (LECAPs, Bonos, ONs), Yahoo Finance (Monitor Global), Google News RSS
- **Deploy**: Netlify (`npx netlify deploy --prod`)
- **Dominio**: rendimientos.co (canonical), rendimientos-ar.netlify.app (legacy)

## Estructura clave

- `public/index.html` - SPA con 5 secciones: Mundo, ARS, Bonos, ONs, Portfolio
- `public/app.js` - Toda la logica del frontend (~2900 lineas)
- `public/config.json` - Config estatica (billeteras, LECAPs, flujos bonos)
- `public/styles.css` - Estilos + dark mode con CSS variables
- `server.js` - Server Express para dev local
- `netlify/functions/` - Funciones serverless (proxies de APIs)

### Funciones Netlify

- `cafci.js` - Proxy para FCIs via ArgentinaDatos
- `cer.js`, `cer-precios.js`, `cer-ultimo.js` - Datos CER (BCRA + data912)
- `lecaps.js` - LECAPs/BONCAPs via data912
- `soberanos.js` - Bonos soberanos USD via data912
- `ons.js` - Obligaciones Negociables via data912
- `mundo.js` - Monitor global via Yahoo Finance
- `news.js` - Noticias financieras via Google News RSS

### Portfolio (localStorage)

- **Storage key `holdings`**: Portfolio en localStorage como JSON array
- Cada holding: `{ id, asset_type, ticker, quantity, purchase_price, purchase_date, metadata }`
- `metadata.operations` trackea operaciones buy/sell para PPP (precio promedio ponderado)
- Sin autenticacion — datos locales al browser

## Desarrollo local

```bash
npm install && npm start  # http://localhost:3000
```

Variables de entorno necesarias (`.env`):
```
PORT=3000
```

Nota: Las Netlify functions (mundo, soberanos, news, etc) solo funcionan en produccion. El server local sirve FCIs, config y endpoints de acciones/CEDEARs.

## Reglas

- Mantener el sitio vanilla (sin frameworks JS/CSS)
- Respetar el sistema de temas dark/light con CSS variables
- Los logos de bancos vienen de BCRA (http -> siempre upgradar a https)
- Los datos de billeteras/cuentas remuneradas son manuales en config.json
- El SEO usa el dominio `rendimientos.co`, no el legacy de Netlify
- Las calculadoras de bonos incluyen campos de Arancel e Impuestos (editables por el usuario)
- El portfolio usa localStorage — datos locales al browser del usuario
- El tipo de cambio implicito (CCL) se calcula desde AL30/AL30D de data912

## Portfolio

El feature de portfolio soporta estos tipos de activos:
- **Soberanos** (AL29, GD30, etc) - precio live en USD, flujos de fondos
- **ONs** (MGCR, BACG, etc) - precio live en USD, flujos de fondos
- **Bonos CER** (TX26, DICP, etc) - precio live en ARS, flujos ajustados por CER
- **LECAPs** (S17A6, etc) - precio live en ARS, pago al vencimiento
- **FCIs** - valor cuotaparte
- **Billeteras** - monto fijo con TNA
- **Cash** - USD o ARS
- **Custom** - activos personalizados (Bitcoin, acciones, etc) con precio manual

---

## Prompts para agentes

Prompts listos para usar con Claude Code u otros agentes AI para operar sobre este repo.

### Actualizar tasas de billeteras

```
Lee public/config.json y actualiza las TNA de las billeteras/cuentas remuneradas
que hayan cambiado. Los datos estan en la seccion "garantizados".
Cada entrada tiene: nombre, tipo, limite, tna, vigente_desde.
Actualiza vigente_desde a la fecha de hoy en formato DD/MM/YYYY.
No modifiques entradas cuya tasa no cambio.

Billeteras a actualizar:
- [nombre]: [nueva TNA]%
```

### Agregar nueva billetera/cuenta remunerada

```
Agrega una nueva entrada en public/config.json, seccion "garantizados".
Sigue el formato existente. El campo "id" es kebab-case del nombre.
Si tiene logo propio, agrega el mapping en ENTITY_LOGOS en public/app.js.
Si tiene condiciones especiales, ponerlo en la seccion "especiales" en vez de "garantizados".

Datos:
- Nombre: [nombre]
- Tipo: Billetera | Cuenta Remunerada
- Limite: [ej: $1 M]
- TNA: [numero]
- Vigente desde: [DD/MM/YYYY]
- Logo (2 letras): [XX]
- Color logo: [hex]
```

### Agregar nuevo bono soberano

```
Agrega un nuevo bono soberano en public/config.json, seccion "soberanos".
Necesitas los flujos de fondos futuros (cupon + amortizacion) por cada 100 VN.
Sigue el formato de los bonos existentes (AL30, GD30, etc).

Datos:
- Ticker (local): [ej: AL30]
- Ticker data912 (con D): [ej: AL30D]
- Ley: Local | NY
- Vencimiento: [YYYY-MM-DD]
- Flujos: [lista de {fecha, cupon, amortizacion}]
```

### Actualizar LECAPs/BONCAPs

```
Los LECAPs y BONCAPs se leen de public/config.json, seccion "lecaps".
Cuando se emite una nueva LECAP/BONCAP, agrega la entrada con:
- ticker: [ej: S17A6]
- tipo: LECAP | BONCAP
- vencimiento: [YYYY-MM-DD]
- pago_final: [monto por 100 VN]

Los precios se obtienen en vivo de data912, no hace falta actualizar precios.
```

### Dogfood / QA del sitio

```
Navega https://rendimientos.co/ como un usuario real.
Revisa cada seccion: Mundo, ARS (Billeteras, Plazo Fijo, LECAPs, CER), Bonos, ONs, Portfolio.
Busca:
- Links rotos o que no funcionan
- Datos desactualizados o inconsistentes
- Problemas visuales en mobile y desktop
- Errores en consola del browser
- Problemas de accesibilidad (contraste, labels, keyboard nav)
- SEO (meta tags, OG, canonical)
Documenta cada hallazgo con severidad, categoria y pasos para reproducir.
```

### Deploy

```
Ejecuta `npx netlify deploy --prod` desde la raiz del repo.
Verifica que el sitio cargue correctamente en https://rendimientos.co/
```
