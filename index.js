const express = require('express');
const puppeteer = require('puppeteer');
const app = express();

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
  await browser.close();

  const hasMetaCAPI = requests.some(u => u.includes('graph.facebook.com'));
  const hasGAc4 = requests.some(u => u.includes('google-analytics.com/g/collect'));
  const hasMetaPixel = requests.some(u => u.includes('connect.facebook.net'));

  res.json({
    url,
    hasMetaPixelJs: hasMetaPixel,
    hasMetaCAPI,
    hasGA4Server: hasGAc4,
    totalRequests: requests.length
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));