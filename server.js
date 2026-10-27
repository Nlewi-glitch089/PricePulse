// Starts PricePulse: connects to MongoDB, then serves the API and the front end
// at http://localhost:PORT.
//
// Settings come from environment variables (see .env.example). `npm start`
// loads .env with Node's --env-file-if-exists flag; on Render they are set in
// the dashboard.
const { createApp } = require('./app');
const { connectToDatabase, readDatabaseConfig, describeUri } = require('./database/db');
const { loadConfiguredProviders } = require('./lib/providers');
const { createLogger } = require('./lib/logger');

const log = createLogger('Server');

const { uri: MONGODB_URI, dbName: MONGODB_DB } = readDatabaseConfig();
const { PORT = '3000' } = process.env;

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', { error: reason instanceof Error ? reason : new Error(String(reason)) });
});

async function main() {
  let connection;
  try {
    connection = await connectToDatabase(MONGODB_URI, MONGODB_DB);
  } catch (error) {
    log.error(error.message);
    process.exit(1);
  }

  let app;
  try {
    app = createApp(connection.db, { providers: loadConfiguredProviders() });
  } catch (error) {
    log.error(`Couldn't start: ${error.message}`);
    await connection.client.close();
    process.exit(1);
  }

  const server = app.listen(Number(PORT), () => {
    log.info(`Connected to ${describeUri(MONGODB_URI)}, database "${MONGODB_DB}"`);
    log.info(`PricePulse running at http://localhost:${PORT}`, { env: process.env.NODE_ENV || 'development' });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`Port ${PORT} is already in use. Stop the other program or set PORT in .env.`);
    } else {
      log.error('Failed to start', { error: err });
    }
    process.exit(1);
  });

  // Ctrl+C (SIGINT) or Render stopping the service (SIGTERM): finish open requests, then disconnect.
  function shutdown(signal) {
    log.info(`Received ${signal}; shutting down`);
    server.close(() => {
      connection.client.close().finally(() => process.exit(0));
    });
    // Don't hang forever on keep-alive connections.
    setTimeout(() => process.exit(0), 5000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
