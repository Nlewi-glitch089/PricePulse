// Decides a watch-list entry's derived status and which alerts a price event produces.
// Pure function: no database access, so it's easy to test.
//
// Target alerts fire once per "episode": when the latest recorded price moves
// from above the target to at/below it. While the price stays at/below the
// target, no more target alerts are produced; once it rises above, the episode
// ends and a later drop can alert again. Each alert carries a dedupe key built
// from the price record (and target) that caused it. The notifications
// collection has a unique index on (userId, dedupeKey), so processing the same
// event twice can never create a second alert.

const { ACTIVE_STATUSES } = require('./domain');
const { percentChange } = require('./priceStats');

// reason:
//   'new-price'  a price was just recorded and it is now the latest price
//   'settings'   the target or status changed; re-check the existing latest price
//   'correction' history changed without a new observation (a record was deleted
//                or a back-dated record was added)
function evaluateEntry({ entry, latestPoint, prefs, reason }) {
  const alerts = [];
  const entryId = String(entry._id);

  // Purchased / not-interested items are no longer evaluated.
  if (!ACTIVE_STATUSES.includes(entry.status)) {
    return { status: entry.status, targetMetAt: null, alerts };
  }

  const target = entry.targetPriceCents ?? null;
  const current = latestPoint ? latestPoint.priceCents : null;
  const isMet = target !== null && current !== null && current <= target;

  let targetMetAt = entry.targetMetAt || null;
  if (isMet) {
    if (targetMetAt === null) {
      targetMetAt = new Date(latestPoint.observedAt);
      if (prefs.targetAlerts && reason !== 'correction') {
        alerts.push({
          type: 'TARGET_REACHED',
          dedupeKey: `target:${entryId}:${latestPoint._id}:${target}`,
          priceCents: latestPoint.priceCents,
          targetPriceCents: target,
          previousPriceCents: entry.previousPriceCents ?? null,
          dropPercent: null,
          pricePointId: latestPoint._id,
        });
      }
    }
  } else {
    targetMetAt = null;
  }

  const previous = entry.previousPriceCents ?? null;
  if (reason === 'new-price' && prefs.priceDropAlerts && latestPoint && previous !== null && latestPoint.priceCents < previous) {
    const change = percentChange(previous, latestPoint.priceCents);
    const dropPercent = change === null ? null : Math.abs(change);
    if (dropPercent !== null && dropPercent >= prefs.priceDropMinPercent) {
      alerts.push({
        type: 'PRICE_DROP',
        dedupeKey: `drop:${entryId}:${latestPoint._id}`,
        priceCents: latestPoint.priceCents,
        targetPriceCents: target,
        previousPriceCents: previous,
        dropPercent,
        pricePointId: latestPoint._id,
      });
    }
  }

  return { status: isMet ? 'TARGET_REACHED' : 'WATCHING', targetMetAt, alerts };
}

module.exports = { evaluateEntry };
