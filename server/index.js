import { join } from 'node:path';
import { createApp, projectRoot } from './app.js';
import { config } from './config.js';
import { createStore } from './store.js';

const port = Number(process.env.PORT) || 3000;
const dataFile = process.env.DATA_FILE || join(projectRoot, 'server', 'data', 'scores.json');

const app = createApp({ store: createStore(dataFile), config });

const server = app.listen(port, () => {
  console.log(`${config.name} API listening on http://localhost:${port}`);
  console.log(`Leaderboard data: ${dataFile}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
