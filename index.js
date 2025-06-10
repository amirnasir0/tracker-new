const express = require('express');
const puppeteer = require('puppeteer');
const app = express();

app.get('/', (req, res) => {
  res.send('Tracker-checker is live. Use /check?url=<site>');
});

app.get('/health', (req, res) => res.send('OK'));

app.get('/check', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url query parameter');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  const hostname = new URL(url).hostname;

  let requests = [];
  let setCookieHeaders = [];
  let proxyTrackers = [];

  page.on('request', req => requests.push(req));
  page.on('response', async response => {
    const headers = response.headers();
    if (headers['set-cookie']) {
      setCookieHeaders.push({ url: response.url(), header: headers['set-cookie'] });
    }
  });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.scrollBy(0, 500));
  await new Promise(resolve => setTimeout(resolve, 4000));

  const scriptUrls = await page.$$eval('script[src]', nodes => nodes.map(n => n.src));

  const inlineScripts = await page.$$eval('script', scripts => scripts.map(s => s.innerText || ''));

  const fbPixelIds = inlineScripts
    .map(code => {
      const match = code.match(/fbq\(\s*['"]init['"],\s*['"](\d{10,20})['"]\)/);
      return match ? match[1] : null;
    })
    .filter(Boolean);

  const shopifyCapiDetected = inlineScripts.some(script =>
    script.includes('trekkie.load') &&
    script.includes('facebookCapiEnabled') &&
    script.includes('true')
  );

  const cookies = await page.cookies();

  const knownTrackers = [
    { name: /^_ga/, label: 'Google Analytics' },
    { name: /^_gid$/, label: 'Google Analytics' },
    { name: /^_fbp/, label: 'Facebook Pixel' },
    { name: /^gclid$/, label: 'Google Ads Auto Tagging' },
    { name: /^FPID$/, label: 'Enhanced Conversions' },
    { name: /^_cl/, label: 'Microsoft Clarity' },
    { name: /^_tt/, label: 'TikTok Pixel' },
    { name: /^ajs_/, label: 'Segment' },
    { name: /^li_fat_id$/, label: 'LinkedIn Insight' },
    { name: /^_hj/, label: 'Hotjar' },
    { name: /^_pinterest_/, label: 'Pinterest Tag' },
    { name: /^_twitter_sess$/, label: 'Twitter Pixel' }
  ];

  const detectedCookies = cookies.map(cookie => {
    const trackerMatch = knownTrackers.find(t => t.name.test(cookie.name));
    const isFirstParty = cookie.domain.includes(hostname);
    const relatedScript = scriptUrls.find(src => src.includes(cookie.domain.replace(/^\./, '')));
    const setBy = setCookieHeaders.some(h => h.header.includes(cookie.name)) ? 'http' : 'js';

    return {
      name: cookie.name,
      domain: cookie.domain,
      isFirstParty,
      tracker: trackerMatch ? trackerMatch.label : 'Unknown',
      setBy,
      relatedScript: relatedScript || null
    };
  });

  for (let req of requests) {
    try {
      const url = req.url();
      const method = req.method();
      const domainMatch = url.includes(hostname);
      const pathSuspicious = /track|log|event|data|collect|analytics|pixel/i.test(url);
      const body = method === 'POST' ? (await req.postData()) : '';
      const payloadSuspicious = body && /event_name|client_id|fbp|fbc/.test(body);

      let score = 0;
      if (domainMatch) score += 30;
      if (pathSuspicious) score += 20;
      if (method === 'POST') score += 10;
      if (payloadSuspicious) score += 40;

      if (score >= 60) {
        proxyTrackers.push({ url, method, score });
      }
    } catch {}
  }

  const hasMetaCAPI = requests.some(r => r.url().includes('graph.facebook.com')) || proxyTrackers.length > 0 || shopifyCapiDetected;
  const hasGA4Server = requests.some(r => r.url().includes('google-analytics.com/g/collect'));
  const hasMetaPixelScript = scriptUrls.some(url => url.includes('connect.facebook.net'));
  const fbqAvailable = await page.evaluate(() => typeof fbq === 'function').catch(() => false);
  const hasMetaPixelDetected = hasMetaPixelScript || fbqAvailable || fbPixelIds.length > 0;

  await browser.close();

  const generateHtmlReport = (data) => {
    const statusIcon = (val) => val ? '✅' : '❌';

    const cookieRows = data.trackingCookies.map(c => `
      <tr>
        <td>${c.name}</td>
        <td>${c.tracker}</td>
        <td>${c.isFirstParty ? '1P' : '3P'}</td>
        <td>${c.setBy.toUpperCase()}</td>
        <td><a href="${c.relatedScript}" target="_blank">${c.relatedScript ? 'View Script' : '-'}</a></td>
      </tr>`).join('');

    const proxyRows = data.proxyTrackers.map(p => `
      <tr>
        <td>${p.url}</td>
        <td>${p.method}</td>
        <td>${p.score}</td>
        <td>Likely Server-side</td>
      </tr>`).join('');

    return `
      <html>
        <head>
          <title>Tracking Checker Results</title>
          <style>
            body { font-family: Arial; padding: 2rem; }
            table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
            th, td { border: 1px solid #ccc; padding: 0.5rem; text-align: left; }
            th { background-color: #f5f5f5; }
            h2 { margin-top: 2rem; }
          </style>
        </head>
        <body>
          <h1>Tracking Report for <a href="${data.url}" target="_blank">${data.url}</a></h1>
          <p><strong>Total Network Requests:</strong> ${data.totalRequests}</p>

          <h2>Tracking Summary</h2>
          <ul>
            <li>Meta Pixel JS: ${statusIcon(data.hasMetaPixelJs)}</li>
            <li>Meta Conversions API: ${statusIcon(data.hasMetaCAPI)}</li>
            <li>GA4 Server-Side: ${statusIcon(data.hasGA4Server)}</li>
            <li>Shopify CAPI Detected: ${statusIcon(data.shopifyCapiDetected)}</li>
          </ul>

          <h2>🍪 Tracking Cookies</h2>
          <table>
            <tr>
              <th>Cookie Name</th>
              <th>Tracker</th>
              <th>1P/3P</th>
              <th>Set By</th>
              <th>Related Script</th>
            </tr>
            ${cookieRows}
          </table>

          <h2>🔍 Proxy-Based Tracking Requests</h2>
          <table>
            <tr>
              <th>URL</th>
              <th>Method</th>
              <th>Score</th>
              <th>Type</th>
            </tr>
            ${proxyRows}
          </table>
        </body>
      </html>
    `;
  };

  res.send(generateHtmlReport({
    url,
    hasMetaPixelJs: hasMetaPixelDetected,
    hasMetaCAPI,
    hasGA4Server,
    fbPixelIds,
    shopifyCapiDetected,
    totalRequests: requests.length,
    trackingCookies: detectedCookies,
    proxyTrackers
  }));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
