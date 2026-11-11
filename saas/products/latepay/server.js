// Starts PaidOnTime: `node products/latepay/server.js` (or `npm run latepay`).
// `--run-jobs` runs the daily jobs once (for cron); `--waitlist` prints the waitlist as CSV.
import { createApp } from '../../core/app.js';
import { definition } from './definition.js';
import { waitlistCsv } from './pages/guides.js';

const app = createApp(definition);
if (process.argv.includes('--waitlist')) {
  process.stdout.write(waitlistCsv(app.services.db));
  app.services.db.close();
} else {
  await app.cli();
}
