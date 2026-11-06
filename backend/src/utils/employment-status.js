'use strict';

const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : value;
const timestamp = value => value == null ? '' : new Date(value).toISOString();

// Resolve the effective status, rather than treating a future transition as current.
// Stable tie-breaking agrees with report/dashboard SQL and never mutates input.
function statusOn(episode, date) {
  const events = [...(episode.statusEvents || [])].sort((a, b) =>
    day(a.effectiveDate).localeCompare(day(b.effectiveDate))
    || timestamp(a.createdAt).localeCompare(timestamp(b.createdAt))
    || String(a.id).localeCompare(String(b.id)));
  const prior = events.filter(event => day(event.effectiveDate) <= date).at(-1);
  if (prior) return prior.toStatus;
  const next = events.find(event => day(event.effectiveDate) > date);
  if (next) return next.fromStatus;
  return day(episode.statusEffectiveDate) <= date ? episode.status : null;
}

module.exports = { statusOn };
