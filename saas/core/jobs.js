// Daily background jobs. Each workspace runs once per day; progress is stored in kv so restarts don't repeat work.
import { todayISO } from './util.js';

export function createJobs(services) {
  const { db, definition } = services;
  const log = services.log || console;
  let timer = null;
  let running = false;

  async function runDaily(date = todayISO(services.config.TIMEZONE)) {
    if (running) return { skipped: true };
    running = true;
    const results = [];
    try {
      for (const { id } of db.all('SELECT id FROM orgs ORDER BY id')) {
        const key = `job:daily:${id}:${date}`;
        if (db.kvGet(key)) continue;
        const org = services.auth.getOrg(id);
        if (!org) continue;
        try {
          const out = await definition.jobs?.daily?.(services, org, date);
          db.kvSet(key, JSON.stringify({ at: new Date().toISOString(), out: out ?? null }));
          results.push({ orgId: id, ok: true, out: out ?? null });
        } catch (err) {
          log.error?.(`[jobs] org ${id}: ${err.stack || err}`);
          results.push({ orgId: id, ok: false, error: String(err.message || err) });
        }
      }
      const now = new Date().toISOString();
      db.run('DELETE FROM sessions WHERE expires_at < ?', now);
      db.run('DELETE FROM tokens WHERE expires_at < ?', new Date(Date.now() - 30 * 86400000).toISOString());
      const cutoff = new Date(Date.now() - 2 * 86400000).toISOString();
      for (const o of db.all('SELECT id FROM orgs WHERE is_demo = 1 AND created_at < ?', cutoff)) services.deleteOrg?.(o.id);
    } finally {
      running = false;
    }
    return { date, results };
  }

  function start(everyMs = 15 * 60 * 1000) {
    if (timer) return;
    const tick = () => runDaily().catch((err) => log.error?.(`[jobs] ${err.stack || err}`));
    setTimeout(tick, 5000).unref();
    timer = setInterval(tick, everyMs);
    timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { runDaily, start, stop };
}
