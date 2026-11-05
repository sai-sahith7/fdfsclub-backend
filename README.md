# FDFSClub backend

API and scan workers for [FDFSClub](https://fdfsclub.in): people pick a city, movie, date and theatres, and get a Telegram message or email when tickets open. The web app lives in [fdfsclub-frontend](https://github.com/sai-sahith7/fdfsclub-frontend).

## Stack

Node 20, Express, Mongoose (MongoDB), Passport (Google sign-in and JWT), node-cron for the workers, Nodemailer for email, the Telegram Bot API over plain HTTP, and Upstash Redis for shared rate limits. Tests use Jest, Supertest and mongodb-memory-server.

## Setup

```bash
npm install
cp .env.example .env   # then fill it in
npm run dev            # API on http://localhost:8000
npm run worker         # scan workers, in a second terminal
```

The example values are for local development. They use port 8000 because macOS keeps port 5000 for AirPlay Receiver. The SMTP defaults point at a local mail catcher such as [Mailpit](https://mailpit.axllent.org) on port 1025, so alert emails never leave your machine.

| Variable | Purpose |
| --- | --- |
| `MONGO` | MongoDB connection string |
| `PORT` | API port, default 5000 |
| `FRONTEND_URL` | Web app URL, used in links and allowed for CORS |
| `CORS_ORIGINS` | Extra allowed origins, comma separated |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Google sign-in |
| `JWT_SECRET` | Signs the 7-day session token |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Alert emails |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Telegram bot and its webhook check |
| `WORKER_ROLE` | `all`, `district` or `bookmyshow`: which jobs this worker runs |
| `BMS_PROXY_URL`, `BMS_MIN_INTERVAL_MS`, `BMS_SCAN_BUDGET`, `BMS_DAILY_REQUEST_CAP` | BookMyShow scanning: optional proxy and request limits |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared rate-limit counts. Without them each instance counts on its own |
| `LOG_LEVEL` | `debug` for extra logging |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API with reload on change |
| `npm start` | API |
| `npm run worker` | Scheduled jobs (scans, syncs, retries) |
| `npm run jobs:once` | Run every job once and exit |
| `npm run lint` | ESLint |
| `npm test` | Full test suite |
| `npm run test:unit`, `test:services`, `test:routes` | One part of the suite |

## Layout

```text
index.js        API entry (Express app, also the Vercel function)
worker.js       worker entry (cron jobs from workers/scheduler.js)
routes/         URL to controller wiring
controllers/    request handling and validation
services/       alert creation, scans, syncs, notifications, Telegram conversations
clients/        District, BookMyShow and Telegram HTTP clients
models/         Mongoose schemas
middleware/     auth, rate limits and the Redis store
renderers/      email, Telegram caption and seat-map image
dtos/ utils/ constants/ config/ templates/ assets/
tests/          unit/, services/, routes/
```

## How alerts work

The worker groups active alerts by movie, city and date, checks showtimes every 2 minutes on District and every 10 minutes on BookMyShow, and sends an email (plus Telegram when linked) the first time a matching show opens. Each alert is sent once. Failed sends retry for up to a day.

## Deploy

- **API:** Vercel, from `index.js` (`vercel.json`). Pushing to `master` deploys.
- **Production env:** `NODE_ENV=production`, `FRONTEND_URL=https://fdfsclub.in`, `CORS_ORIGINS=https://fdfsclub.in,https://www.fdfsclub.in`, `GOOGLE_CALLBACK_URL=https://api.fdfsclub.in/auth/google/callback`, plus real values for every secret.
- **Workers:** any always-on machine with Docker: `docker compose --profile worker up -d --build`. The `bms-worker` profile runs a separate BookMyShow-only worker, and `api` runs the API in a container.

## License

[MIT](LICENSE). To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).
