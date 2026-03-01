# Adedaz Charging Center — Dashboard

Live dashboard for the Adedaz Charging Center's daily revenue records, pulling data directly from Google Sheets.

![Dashboard Preview](https://img.shields.io/badge/status-live-brightgreen) ![Tech](https://img.shields.io/badge/stack-HTML%20%7C%20CSS%20%7C%20JS-blue)

## Features

- **Live Data** — Auto-fetches from Google Sheets, refreshes every 5 minutes
- **Auto-Detect Months** — Discovers new sheet tabs (Mar, Apr…) automatically
- **6 KPI Cards** — Revenue, Expenses, Gross, Profit, Margin %, Fuel Ratio %
- **7 Interactive Charts** — Revenue trends, expense donut, profit bars, margin tracker, forecast, expense trends, day-of-week analysis
- **Best/Worst Day Alerts** — Top 3 and bottom 3 performing days
- **Break-Even Calculator** — Daily threshold and days above/below
- **Manager Payout Analysis** — Revenue/profit comparison with and without payouts
- **Weekly Summaries** — Week-by-week aggregation with trend arrows
- **Revenue Forecasting** — 14-day projection using linear regression
- **Dropdown Record Viewer** — Cascading month → day selection with detail cards
- **Running Totals** — Cumulative revenue and profit tracking

## Tech Stack

- **HTML5** + **CSS3** + **Vanilla JavaScript**
- [Chart.js](https://www.chartjs.org/) via CDN
- Google Sheets CSV export API (no API key needed)
- Dark theme with glassmorphism design

## Getting Started

```bash
# Clone the repo
git clone https://github.com/<your-username>/adedaz-charging-dashboard.git
cd adedaz-charging-dashboard

# Run locally
npx serve . -l 3000
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

1. Push to GitHub
2. Import the repo at [vercel.com/new](https://vercel.com/new)
3. Framework Preset: **Other** (static site, no build step)
4. Click **Deploy** — done!

The included `vercel.json` handles routing and caching headers automatically.

## Data Source

The dashboard reads from a publicly shared Google Sheet:
[Adedaz Charging Center Daily Revenue Record](https://docs.google.com/spreadsheets/d/17p_OfNljq6YXQrYEq4W-4t9rNfOLSvApSwoVMfsuy7U)

To add a new month, simply create a new tab in the sheet named `Mon YYYY` (e.g., `Mar 2026`). The dashboard will auto-detect it.

## License

MIT
