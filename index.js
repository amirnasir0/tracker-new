
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

  // Trigger lazy-loaded scripts
  await page.evaluate(() => window.scrollBy(0, 500));
  await new Promise(resolve => setTimeout(resolve, 1500));

  const scriptUrls = await page.$$eval('script[src]', nodes =>
    nodes.map(n => n.src)
  );

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

  await browser.close();

  res.json({
    url,
    hasMetaPixelJs: hasMetaPixelScript || fbqAvailable,
    hasMetaCAPI,
    hasGA4Server,
    totalRequests: requests.length,
    trackingCookies: detectedCookies
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
