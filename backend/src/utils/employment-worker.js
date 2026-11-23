'use strict';
// Scheduling/observability only. The existing service owns every business rule.
function createEmploymentWorker({processDue, intervalMs = 60000, staleAfterMs = 180000,
  now = Date.now, schedule = setInterval, unschedule = clearInterval,
  log = event => console.info(JSON.stringify(event))}) {
  let timer, startedAt = null, completedAt = null, lastSucceeded = false, stopping = false, inFlight;
  async function run() {
    if (stopping || inFlight) return;
    const began = now();
    inFlight = Promise.resolve().then(processDue).then(result => {
      lastSucceeded = !(Number(result?.failed) > 0);
    }, () => { lastSucceeded = false; }).then(() => {
      completedAt = now();
      log({event: 'employment_worker_tick', outcome: lastSucceeded ? 'success' : 'failure',
        durationMs: Math.max(0, completedAt - began)});
    }).finally(() => { inFlight = undefined; });
    await inFlight;
  }
  function start() {
    if (timer || startedAt !== null) return;
    stopping = false; startedAt = now(); timer = schedule(() => { void run(); }, intervalMs);
    timer.unref?.();
  }
  async function stop() {
    stopping = true;
    if (timer) unschedule(timer);
    timer = undefined; await inFlight;
  }
  function health() {
    if (stopping || startedAt === null) return {healthy: false, state: 'stopped'};
    if (now() - (completedAt ?? startedAt) > staleAfterMs) return {healthy: false, state: 'stale'};
    if (completedAt === null) return {healthy: true, state: 'starting'};
    return {healthy: lastSucceeded, state: lastSucceeded ? 'healthy' : 'degraded'};
  }
  return {start, stop, health};
}
module.exports = {createEmploymentWorker};

