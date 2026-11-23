# PricePulse

PricePulse is a product price-tracking web application. Keep a personal watch list, record prices as you find them, review price history, and receive in-app alerts when products reach a target price or meet a price-drop threshold.

**Live demo:** [PricePulse](https://pricepulse-a5kl.onrender.com)

## Features

The features below are implemented in the application. Backend workflows have automated test coverage; the browser interface itself does not currently have automated browser tests.

- **Accounts and privacy:** Create an account with an email and password, sign in and out, and keep your products, notes, targets, and recorded prices private to your account. Change your display name or password, sign out of all devices, or delete your account and its data.
- **Demo mode:** Explore a temporary demo account with sample products, price history, alerts, and a purchase. Demo data is private to the visitor and is removed when the demo ends or expires.
- **Product watch list:** Add, edit, and remove products. Product details can include a retailer, category, product link, externally hosted image link, description, private notes, list price, target price, starting price, and currency. Duplicate product links are detected.
- **Price history:** Record prices manually, including a date and optional note. Review price history and statistics for 7 days, 30 days, 90 days, or all time, including latest, lowest, highest, average, and price change. Manually entered price records can be deleted.
- **In-app alerts:** Receive an alert when a recorded price crosses from above your target to at or below it. Optionally enable price-drop alerts and choose a minimum percentage drop. Manage notifications by marking them read or unread, marking all as read, or deleting them.
- **Search and organization:** Search the watch list and filter by category, retailer, status, or whether the target price has been met. Sort by name, price, target, latest change, biggest drop, or date added.
- **Dashboard:** Review products at their target price, recent price changes, biggest drops, recently added products, and recent alerts.
- **Purchase tracking:** Mark a product as purchased, record what you paid, undo a purchase, compare the purchase price with the lowest recorded price, and review totals grouped by currency.
- **Display preferences:** Choose light, dark, or device-matched theme preferences. Choose a default currency for new products.

## Current limitations

- **Manual price tracking is the default.** PricePulse does not scrape retailer websites and does not include a price data provider.
- **Optional price API connection:** The application includes a generic connector for a JSON price API that you are authorized to use. Configure a provider using the supported `PRICE_PROVIDER_HTTP_NAME`, `PRICE_PROVIDER_HTTP_ENDPOINT`, and `PRICE_PROVIDER_HTTP_API_KEY` environment variables. When configured, a "Check price now" action is available for products with a product link. Prices are not checked automatically or on a schedule.
- **In-app notifications only:** There are no email, browser push, or mobile push notifications.
- **Account recovery:** There is no password reset or email verification, and account email addresses cannot be changed.
- **Images:** Product images are provided as external image links. Image uploads are not supported.
- **Purchases:** A purchase can be undone, but an existing purchase record cannot be edited.
- **Currency:** Eight currencies are supported for product records. The app does not convert between currencies; totals are grouped by currency.
- **Mobile testing:** The interface includes responsive styling, but phone and tablet behavior has not been verified through device testing.
- **Frontend testing:** The browser interface, including forms, charts, navigation, theme switching, and responsive layouts, does not currently have automated browser tests.

## Built with

- Node.js 22.9 or newer
- Express 5
- MongoDB and the official MongoDB Node.js driver
- HTML, CSS, and JavaScript

## Requirements

- Node.js 22.9 or newer
- npm
- A MongoDB Atlas cluster or local MongoDB server

## Run locally

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/Nlewi-glitch089/PricePulse.git
   cd PricePulse
   npm install
   ```

2. Copy the example environment file:

   **macOS / Linux / Git Bash**
   ```bash
   cp .env.example .env
   ```

   **Windows PowerShell**
   ```powershell
   Copy-Item .env.example .env
   ```

3. Edit `.env` and configure the required values:

   | Variable | Required | Purpose |
   | --- | --- | --- |
   | `MONGODB_URI` | Yes | MongoDB connection string |
   | `MONGODB_DB` | No | Database name; defaults to `pricepulse` |
   | `SESSION_SECRET` | Yes in production | Secret used to sign session cookies |
   | `NODE_ENV` | No | Set to `development` locally and `production` in production |
   | `PORT` | No | Server port; defaults to `3000` |
   | `PRICE_PROVIDER_HTTP_NAME` | No | Name for an optional authorized price provider |
   | `PRICE_PROVIDER_HTTP_ENDPOINT` | No | Endpoint for the optional JSON price API |
   | `PRICE_PROVIDER_HTTP_API_KEY` | No | Optional API key sent to the configured provider |

   Generate a session secret with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Start the application:

   ```bash
   npm start
   ```

   Open [http://localhost:3000](http://localhost:3000). For automatic server restarts during development, run `npm run dev`.

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

The automated tests use a temporary MongoDB instance rather than your configured application database. The first test run may take longer while the temporary database is downloaded.

## Automated testing

The project has 95 automated tests covering backend routes, database-backed workflows, validation, price calculations, alert rules, and the optional price API connector. The tests include multi-step API workflows such as account creation, adding products, recording prices, triggering alerts, purchases, and dashboard data.

These tests do not automate browser interactions. The frontend screens, forms, chart, theme switcher, and responsive layouts have not been covered by automated browser tests.

## Deploying to Render

PricePulse is deployed as a Render Web Service:

[https://pricepulse-a5kl.onrender.com](https://pricepulse-a5kl.onrender.com)

To configure a deployment manually:

1. Create a **Web Service** in [Render](https://render.com) and connect this GitHub repository.
2. Select the Node runtime.
3. Set the build command to `npm install`.
4. Set the start command to `npm start`.
5. Configure these environment variables in the Render service:
   - `MONGODB_URI` — production MongoDB connection string.
   - `MONGODB_DB` — optional database name.
   - `SESSION_SECRET` — a strong, unique random secret.
   - `NODE_ENV` — `production`.
6. Configure MongoDB Atlas network access and a database user with the permissions required by the application.
7. Deploy and verify the application.

Render provides the `PORT` environment variable. Keep production database credentials and session secrets out of the repository. This repository does not include a `render.yaml` deployment blueprint.
