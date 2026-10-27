# PricePulse

PricePulse is a web app for keeping track of things you want to buy and the prices you see them at. Add a product, record its price whenever you check it, and set the price you'd be happy to pay. PricePulse keeps the price history, shows how the price has moved, and lets you know when a recorded price drops to your target.

## Features

- Create an account and log in. Each person's watch list is private.
- Add products with a name, store, category, link, picture, notes, and a target price.
- Edit or remove products. Adding the same product link twice is caught as a duplicate.
- Search your watch list, filter it by category, store, or status, and sort it by name, price, target, or most recent change.
- Record prices as you see them and view the history as a chart, with the lowest, highest, and average price over the last 7, 30, or 90 days or all time.
- Get an alert in the app when a price reaches your target (once per drop, not every time you record a price).
- See a dashboard of what's at your target, recent price changes, and the biggest drops.
- Mark products as purchased and look back at what you paid.
- Use it on a phone or a computer, in light or dark mode.

## Built With

- Node.js
- Express
- MongoDB
- HTML, CSS, and JavaScript

## Getting Started

You'll need [Node.js](https://nodejs.org) 22.9 or newer and a MongoDB database, either [MongoDB Community Server](https://www.mongodb.com/try/download/community) on your computer or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster.

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Copy the example settings file:

   ```bash
   cp .env.example .env
   ```

3. Open `.env` and fill in:
   - `MONGODB_URI`: your MongoDB connection string (for a local install, `mongodb://127.0.0.1:27017`)
   - `SESSION_SECRET`: any long random string. You can make one with:

     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```

4. Start the app:

   ```bash
   npm start
   ```

   Then open http://localhost:3000 and create an account. Use `npm run dev` instead if you want the server to restart when you change a file.

To run the tests, use `npm test`. The first run downloads a temporary copy of MongoDB for testing, so it takes a few minutes.

The repo also includes a `render.yaml` file for deploying to [Render](https://render.com). Render will ask for your `MONGODB_URI` and generate the session secret.

## Limitations

- **Prices are entered by hand unless you set up a price provider.** PricePulse doesn't scrape store websites. If you have access to a price API, you can connect it with the `PRICE_PROVIDER_HTTP_*` settings in `.env`, and a "Check price now" button will appear on products with a link.
- **Notifications are in-app only.** Alerts show up in the app's notification center; there are no email or push notifications yet.
