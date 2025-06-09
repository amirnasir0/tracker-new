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

  page.on('request', req => requests.push(req.url()));
  page.on('response', async response => {
    const headers = response.headers();
    if (headers['set-cookie']) {
      setCookieHeaders.push({ url: response.url(), header: headers['set-cookie'] });
    }
  });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  await page.evaluate(() => window.scrollBy(0, 500));
  await new Promise(resolve => setTimeout(resolve, 4000)); // Allow more time for delayed scripts

  const scriptUrls = await page.$$eval('script[src]', nodes =>
    nodes.map(n => n.src)
  );

  const inlineScripts = await page.$$eval('script', scripts =>
    scripts.map(s => s.innerText).filter(js => js.includes('fbq'))
  );

  const fbPixelIds = inlineScripts
    .map(code => {
      const match = code.match(/fbq\(\s*['"]init['"],\s*['"](\d{10,20})['"]/);
      return match ? match[1] : null;
    })
    .filter(Boolean);

  const cookies = await page.cookies();

  const knownTrackers = [
    { name: /^_ga/, label: 'Google Analytics' },
    { name: /^_gid$/, label: 'Google Analytics' },
    { name: /^_fbp/, label: 'Facebook Pixel' },
    { name: /^gclid$/, label: 'Google Ads Auto Tagging' },
    { name: /^FPID$/, label: 'Enhanced Conversions' },
    { name: /^_cl/, label: 'Microsoft Clarity' },
    { name: /^_tt/, label: 'TikTok Pixel' }
  ];

  const detectedCookies = cookies.map(cookie => {
    const trackerMatch = knownTrackers.find(t => t.name.test(cookie.name));
    const isFirstParty = cookie.domain.includes(hostname);
    const relatedScript = scriptUrls.find(src =>
      src.includes(cookie.domain.replace(/^\./, ''))
    );
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

  const hasMetaCAPI = requests.some(u => u.includes('graph.facebook.com'));
  const hasGA4Server = requests.some(u => u.includes('google-analytics.com/g/collect'));
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
      </tr>
    `).join('');

    const fbPixelList = data.fbPixelIds.length > 0
      ? `<p><strong>Detected Facebook Pixel IDs:</strong> ${data.fbPixelIds.join(', ')}</p>`
      : '';

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
          </ul>

          ${fbPixelList}

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
        </body>
      </html>
    `;
  };

  res.send(generateHtmlReport({
    url,
    hasMetaPixelJs: hasMetaPixelDetected,
    fbPixelIds,
    hasMetaCAPI,
    hasGA4Server,
    totalRequests: requests.length,
    trackingCookies: detectedCookies
  }));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
