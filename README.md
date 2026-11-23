# PricePulse

PricePulse is a web app for keeping track of things you want to buy and the prices you see them at. Add a product, record its price whenever you check it, and set the price you'd be happy to pay. PricePulse keeps the price history, shows how the price has moved, and lets you know when a recorded price drops to your target.

## Live Demo

[Visit PricePulse](https://pricepulse-a5kl.onrender.com)

## Features

- Create an account and log in. Each person's watch list is private.
- Add products with a name, store, category, link, picture, notes, and a target price.
- Edit or remove products. Adding the same product link twice is caught as a duplicate.
- Search your watch list, filter it by category, store, or status, and sort it by name, price, target, or most recent change.
- Record prices as you see them and view the history as a chart, with the lowest, highest, and average price over the last 7, 30, or 90 days or all time.
- Get an alert in the app when a recorded price reaches your target.
- See a dashboard of target prices, recent changes, and the biggest drops.
- Mark products as purchased and look back at what you paid.
- Use it on a phone or a computer, in light or dark mode.

## Built With

- Node.js 22.9 or newer
- Express 5
- MongoDB (official Node.js driver)
- HTML, CSS, and JavaScript

## Requirements

- Node.js 22.9 or newer
- npm
- MongoDB Atlas cluster or local MongoDB server

## Run locally

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/Nlewi-glitch089/PricePulse.git
   cd PricePulse
   npm install
   ```

2. Copy the example settings file:

   **macOS / Linux / Git Bash**
   ```bash
   cp .env.example .env
   ```

   **Windows PowerShell**
   ```powershell
   Copy-Item .env.example .env
   ```

3. Edit `.env` and set:

   | Variable | Required | Purpose |
   | --- | --- | --- |
   | `MONGODB_URI` | Yes | MongoDB connection string |
   | `MONGODB_DB` | No | Database name; defaults to `pricepulse` |
   | `SESSION_SECRET` | Yes for production | Long random string used to sign session cookies |
   | `NODE_ENV` | No | Use `development` locally and `production` on the host |
   | `PORT` | No | Port; defaults to `3000` |
   | `PRICE_PROVIDER_HTTP_NAME` | No | Name of an optional authorized price provider |
   | `PRICE_PROVIDER_HTTP_ENDPOINT` | No | Optional provider endpoint |
   | `PRICE_PROVIDER_HTTP_API_KEY` | No | Optional server-side provider key |
   | `PRICE_PROVIDER_HTTP_HOSTS` | No | Allowed provider hosts |

   Generate a session secret with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Start the application:

   ```bash
   npm start
   ```

Open [http://localhost:3000](http://localhost:3000). For development with automatic server restarts, use `npm run dev`.

## Available commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Start with Node's watch mode |
| `npm test` | Run the automated test suite |
| `npm run db:init` | Check the database connection and initialize database indexes |
| `npm run catalog:seed` | Load the built-in catalog |
| `npm run catalog:refresh` | Refresh catalog metadata (requires TMDB credentials if configured) |
| `npm run catalog:build` | Rebuild the catalog data |

The tests use a temporary MongoDB instance and do not use your configured application database. The first test run may take longer while the temporary database is downloaded.

## Deploying to Render

The repository does not currently include a `render.yaml` deployment blueprint. Create the service manually:

1. Create a **Web Service** in [Render](https://render.com) and connect this GitHub repository.
2. Choose the Node runtime.
3. Set the build command to `npm install`.
4. Set the start command to `npm start`.
5. Add these environment variables in the Render service settings:
   - `MONGODB_URI` — your production MongoDB connection string.
   - `MONGODB_DB` — optional production database name.
   - `SESSION_SECRET` — a strong, unique random secret.
   - `NODE_ENV` — `production`.
6. In MongoDB Atlas, allow network access from the Render service and use a database user with only the permissions the app needs.
7. Deploy and verify registration, sign-in, watchlist isolation, and product updates.

Render supplies the `PORT` value automatically. Do not commit the production database URI or session secret.

The production service is deployed at [https://pricepulse-a5kl.onrender.com](https://pricepulse-a5kl.onrender.com).

## Limitations

- Prices are entered manually unless you configure a compatible price provider. PricePulse does not scrape store websites.
- Optional price-provider credentials must remain server-side and should only be used with a provider you are authorized to access.
- Notifications are in-app only; there are no email or push notifications yet.
