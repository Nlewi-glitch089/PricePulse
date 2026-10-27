// Price math. Every function takes recorded points ({ priceCents, observedAt })
// and never estimates anything between them.

function sortSeries(points) {
  return [...points].sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));
}

function percentChange(fromCents, toCents) {
  if (fromCents === 0) return null;
  return Math.round(((toCents - fromCents) / fromCents) * 10000) / 100;
}

// The cached summary stored on a watch-list entry (see services/prices.js).
function summarizeSeries(points) {
  const sorted = sortSeries(points);
  if (sorted.length === 0) {
    return {
      currentPriceCents: null,
      previousPriceCents: null,
      firstPriceCents: null,
      lowestPriceCents: null,
      highestPriceCents: null,
      totalChangeCents: null,
      lastPriceAt: null,
      lastPriceChangeAt: null,
      changeFromPriceCents: null,
    };
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const prices = sorted.map((p) => p.priceCents);

  // The most recent record whose price differs from the one before it.
  let lastPriceChangeAt = null;
  let changeFromPriceCents = null;
  for (let i = sorted.length - 1; i > 0; i--) {
    if (sorted[i].priceCents !== sorted[i - 1].priceCents) {
      lastPriceChangeAt = new Date(sorted[i].observedAt);
      changeFromPriceCents = sorted[i - 1].priceCents;
      break;
    }
  }

  return {
    currentPriceCents: last.priceCents,
    previousPriceCents: sorted.length > 1 ? sorted[sorted.length - 2].priceCents : null,
    firstPriceCents: first.priceCents,
    lowestPriceCents: Math.min(...prices),
    highestPriceCents: Math.max(...prices),
    totalChangeCents: sorted.length > 1 ? last.priceCents - first.priceCents : null,
    lastPriceAt: new Date(last.observedAt),
    lastPriceChangeAt,
    changeFromPriceCents,
  };
}

// Statistics for one selected time range (points already filtered to it).
// Change figures compare the first and last recorded prices in the range and
// need at least two records.
function computeRangeStats(points) {
  const sorted = sortSeries(points);
  const count = sorted.length;
  if (count === 0) {
    return {
      count,
      currentCents: null,
      lowestCents: null,
      highestCents: null,
      averageCents: null,
      firstCents: null,
      changeCents: null,
      changePercent: null,
      firstObservedAt: null,
      lastObservedAt: null,
    };
  }
  const prices = sorted.map((p) => p.priceCents);
  const first = sorted[0];
  const last = sorted[count - 1];
  const hasChange = count > 1;
  return {
    count,
    currentCents: last.priceCents,
    lowestCents: Math.min(...prices),
    highestCents: Math.max(...prices),
    averageCents: Math.round(prices.reduce((a, b) => a + b, 0) / count),
    firstCents: first.priceCents,
    changeCents: hasChange ? last.priceCents - first.priceCents : null,
    changePercent: hasChange ? percentChange(first.priceCents, last.priceCents) : null,
    firstObservedAt: new Date(first.observedAt),
    lastObservedAt: new Date(last.observedAt),
  };
}

module.exports = { sortSeries, percentChange, summarizeSeries, computeRangeStats };
