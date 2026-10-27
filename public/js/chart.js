// Price-history chart, drawn as plain SVG.
//
// The line is a step: each recorded price is held flat until the next record,
// because the price between records isn't known. Dots are the actual records:
// hollow for prices the user entered, filled for prices from an automatic
// source. Nothing is interpolated or estimated. Colors come from CSS classes
// (see style.css), so the chart follows light/dark themes without redrawing.
//
// Interaction: hover or touch shows the nearest record; the chart is focusable
// and the arrow keys step through records. A table of every record sits below
// the chart on the product page for screen-reader and keyboard users.

function renderPriceChart(container, { points, currency, targetPrice }) {
  const data = points.map((p) => ({ ...p, t: new Date(p.observedAt).getTime() }));
  const wrap = h('div', { class: 'chart-wrap' });
  const legend = chartLegend(targetPrice !== null);
  container.append(h('figure', { style: 'margin:0' }, wrap, legend));

  let active = -1;
  let geometry = null;

  function draw() {
    clear(wrap);
    const width = Math.max(wrap.clientWidth || container.clientWidth || 600, 280);
    const height = width < 640 ? 260 : 320;
    const m = { top: 18, right: 16, bottom: 28, left: 64 };
    const innerW = width - m.left - m.right;
    const innerH = height - m.top - m.bottom;

    // Domains
    let tMin = data[0].t;
    let tMax = data[data.length - 1].t;
    if (tMax === tMin) {
      tMin -= 12 * 3600 * 1000;
      tMax += 12 * 3600 * 1000;
    }
    const values = data.map((d) => d.price);
    if (targetPrice !== null) values.push(targetPrice);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max((hi - lo) * 0.12, hi * 0.03, 1);
    const yMin = Math.max(0, Math.floor(lo - pad));
    const yMax = Math.ceil(hi + pad);

    const x = (t) => m.left + ((t - tMin) / (tMax - tMin)) * innerW;
    const y = (v) => m.top + (1 - (v - yMin) / (yMax - yMin)) * innerH;

    const svg = h('svg', {
      class: 'chart-svg',
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      tabindex: '0',
      role: 'img',
      'aria-label': chartSummary(data, currency),
    });

    // Horizontal grid lines + price labels
    for (let i = 0; i <= 4; i++) {
      const v = yMin + ((yMax - yMin) * i) / 4;
      const yy = y(v);
      svg.append(h('line', { class: 'grid-line', x1: m.left, x2: width - m.right, y1: yy, y2: yy }));
      svg.append(h('text', { class: 'axis-label', x: m.left - 8, y: yy + 4, 'text-anchor': 'end' }, compactMoney(v, currency)));
    }

    // Date labels
    const spanDays = (tMax - tMin) / 864e5;
    const dateOpts = spanDays > 300 ? { month: 'short', year: '2-digit' } : spanDays < 2 ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' };
    const ticks = Math.max(2, Math.min(6, Math.floor(innerW / 90)));
    for (let i = 0; i <= ticks; i++) {
      const t = tMin + ((tMax - tMin) * i) / ticks;
      const anchor = i === 0 ? 'start' : i === ticks ? 'end' : 'middle';
      svg.append(h('text', { class: 'axis-label', x: x(t), y: height - 6, 'text-anchor': anchor }, formatDate(new Date(t).toISOString(), dateOpts)));
    }

    // Target line
    if (targetPrice !== null) {
      const ty = y(targetPrice);
      svg.append(h('line', { class: 'target-line', x1: m.left, x2: width - m.right, y1: ty, y2: ty }));
      svg.append(h('text', { class: 'target-label', x: m.left + 6, y: ty - 6 }, `Target ${formatMoney(targetPrice, currency)}`));
    }

    // Step line through the records
    if (data.length > 1) {
      let d = `M${x(data[0].t)},${y(data[0].price)}`;
      for (let i = 1; i < data.length; i++) d += `H${x(data[i].t)}V${y(data[i].price)}`;
      svg.append(h('path', { class: 'price-line', d }));
    }

    const crosshair = h('line', { class: 'crosshair', y1: m.top, y2: m.top + innerH, visibility: 'hidden' });
    svg.append(crosshair);

    const dots = data.map((p) =>
      h('circle', { class: p.source === 'MANUAL' ? 'dot-manual' : 'dot-provider', cx: x(p.t), cy: y(p.price), r: 4.5 }),
    );
    svg.append(...dots);

    const tooltip = h('div', { class: 'chart-tooltip', hidden: true, role: 'status' });
    wrap.append(svg, tooltip);
    geometry = { svg, dots, crosshair, tooltip, x, y, width };

    // Pointer: snap to the nearest record by time.
    svg.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * width;
      let best = 0;
      for (let i = 1; i < data.length; i++) if (Math.abs(x(data[i].t) - px) < Math.abs(x(data[best].t) - px)) best = i;
      setActive(best);
    });
    svg.addEventListener('pointerleave', () => setActive(-1));
    svg.addEventListener('blur', () => setActive(-1));
    svg.addEventListener('focus', () => setActive(data.length - 1));
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = active < 0 ? data.length - 1 : active + (e.key === 'ArrowLeft' ? -1 : 1);
        setActive(Math.max(0, Math.min(data.length - 1, next)));
      } else if (e.key === 'Escape') {
        setActive(-1);
      }
    });
    if (active >= 0) setActive(Math.min(active, data.length - 1));
  }

  function setActive(index) {
    if (!geometry) return;
    const { dots, crosshair, tooltip, x, y } = geometry;
    if (active >= 0 && dots[active]) dots[active].classList.remove('dot-active');
    active = index;
    if (index < 0) {
      crosshair.setAttribute('visibility', 'hidden');
      tooltip.hidden = true;
      return;
    }
    const p = data[index];
    dots[index].classList.add('dot-active');
    crosshair.setAttribute('x1', x(p.t));
    crosshair.setAttribute('x2', x(p.t));
    crosshair.setAttribute('visibility', 'visible');
    appendChildren(clear(tooltip), [
      h('div', { class: 'muted tiny' }, formatDateTime(p.observedAt)),
      h('div', { class: 'num', style: 'font-weight:700;font-size:0.95rem' }, formatMoney(p.price, currency)),
      h('div', { class: 'tiny secondary' }, p.source === 'MANUAL' ? 'Recorded manually' : `Retrieved from ${p.providerName}`),
      p.note && h('div', { class: 'tiny muted' }, `“${p.note}”`),
    ]);
    tooltip.hidden = false;
    // Keep the tooltip inside the chart horizontally.
    const svgRect = geometry.svg.getBoundingClientRect();
    const scale = svgRect.width / geometry.width;
    const left = Math.min(Math.max(x(p.t) * scale, 80), svgRect.width - 80);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${y(p.price) * scale}px`;
  }

  draw();
  // Redraw at the new size when the layout changes (rotate phone, resize window).
  let lastWidth = wrap.clientWidth;
  const ro = new ResizeObserver(() => {
    if (!wrap.isConnected) {
      ro.disconnect(); // the user moved to another view
      return;
    }
    if (Math.abs(wrap.clientWidth - lastWidth) > 4) {
      lastWidth = wrap.clientWidth;
      draw();
    }
  });
  ro.observe(wrap);
}

function compactMoney(v, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: v >= 10000 ? 'compact' : 'standard',
      maximumFractionDigits: v >= 100 ? 0 : 2,
    }).format(v);
  } catch {
    return String(v);
  }
}

function chartSummary(data, currency) {
  const first = data[0];
  const last = data[data.length - 1];
  const count = `${data.length} recorded price${data.length === 1 ? '' : 's'}`;
  return `Price history chart with ${count} from ${formatDate(first.observedAt)} to ${formatDate(last.observedAt)}, latest ${formatMoney(last.price, currency)}. Use the left and right arrow keys to read each record; the full list is in the table below.`;
}

function chartLegend(hasTarget) {
  const swatch = (children, w = 22) => h('svg', { class: 'chart-svg legend-swatch', width: w, height: 12, viewBox: `0 0 ${w} 12`, 'aria-hidden': 'true', style: `width:${w}px;height:12px` }, children);
  return h(
    'figcaption',
    { class: 'chart-legend', style: 'margin-top:8px' },
    h('span', { class: 'legend-item' }, swatch(h('path', { class: 'price-line', d: 'M1 9h8V3h12' })), 'Last recorded price (held until the next record)'),
    h('span', { class: 'legend-item' }, swatch(h('circle', { class: 'dot-manual', cx: 6, cy: 6, r: 4 }), 12), 'Manual record'),
    h('span', { class: 'legend-item' }, swatch(h('circle', { class: 'dot-provider', cx: 6, cy: 6, r: 4.5 }), 12), 'Automatic record'),
    hasTarget && h('span', { class: 'legend-item' }, swatch(h('line', { class: 'target-line', x1: 1, x2: 21, y1: 6, y2: 6 })), 'Your target'),
  );
}
