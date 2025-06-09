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
  let requests = [];

  page.on('request', req => requests.push(req.url()));

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // Scroll to trigger lazy-loaded pixels
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(1500);

  const scriptUrls = await page.$$eval('script[src]', scripts =>
    scripts.map(s => s.src)
  );

  const hasMetaPixelScript = scriptUrls.some(url => url.includes('connect.facebook.net'));
  const hasGAScript = scriptUrls.some(url => url.includes('gtag/js') || url.includes('analytics.js'));

  const fbqAvailable = await page.evaluate(() => typeof fbq === 'function').catch(() => false);

  const hasMetaCAPI = requests.some(u => u.includes('graph.facebook.com'));
  const hasGA4Server = requests.some(u => u.includes('google-analytics.com/g/collect'));

  await browser.close();

  res.json({
    url,
    hasMetaPixelJs: hasMetaPixelScript || fbqAvailable,
    hasMetaCAPI,
    hasGA4Server,
    hasGAScript,
    totalRequests: requests.length
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
