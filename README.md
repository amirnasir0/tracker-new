# Tracker Checker

Simple tracker analysis tool using Puppeteer.

## Endpoint

**GET** `/check?url=https://example.com`

### Response
```json
{
  "url": "https://example.com",
  "hasMetaPixelJs": false,
  "hasMetaCAPI": true,
  "hasGA4Server": false,
  "totalRequests": 85
}
```

## Deploy on Railway
1. Push this project to GitHub.
2. Go to [railway.app](https://railway.app)
3. New Project → Deploy from GitHub → Select your repo
4. Done!