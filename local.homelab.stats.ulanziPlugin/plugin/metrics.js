const DEFAULT_SETTINGS = { metric: 'cpu', host: 'http://localhost:61208', interval: '5' };
const FETCH_TIMEOUT_MS = 4000;
const FONT_STACK = '"Source Han Sans SC", "Segoe UI", system-ui, sans-serif';

const METRICS = {
  cpu: { label: 'CPU', path: 'cpu/total', percent: (d) => d.total },
  mem: { label: 'RAM', path: 'mem/percent', percent: (d) => d.percent },
  swap: { label: 'SWAP', path: 'memswap/percent', percent: (d) => d.percent },
  load: {
    label: 'LOAD',
    path: 'load',
    percent: (d) => (d.min1 / d.cpucore) * 100,
    text: (d) => d.min1.toFixed(1),
  },
};

const COLORS = {
  background: '#1e1f22',
  label: '#9da5b4',
  value: '#ffffff',
  track: '#2f3136',
  ok: '#3fb950',
  warn: '#d29922',
  danger: '#f85149',
  offline: '#6e7681',
};

function levelColor(percent) {
  if (percent >= 90) return COLORS.danger;
  if (percent >= 70) return COLORS.warn;
  return COLORS.ok;
}

function drawMetric(label, valueText, percent) {
  const size = 144;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const offline = percent === null;

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, size, size);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.label;
  ctx.font = `600 22px ${FONT_STACK}`;
  ctx.fillText(label, size / 2, 26);

  ctx.fillStyle = offline ? COLORS.offline : COLORS.value;
  let fontSize = offline ? 30 : 50;
  do {
    ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
    fontSize -= 2;
  } while (ctx.measureText(valueText).width > size - 20 && fontSize > 12);
  ctx.fillText(valueText, size / 2, 76);

  ctx.fillStyle = COLORS.track;
  ctx.fillRect(16, 114, size - 32, 12);
  if (!offline) {
    const clamped = Math.max(0, Math.min(100, percent));
    ctx.fillStyle = levelColor(clamped);
    ctx.fillRect(16, 114, ((size - 32) * clamped) / 100, 12);
  }

  return canvas.toDataURL('image/png');
}

if (typeof module !== 'undefined') module.exports = { DEFAULT_SETTINGS, METRICS, levelColor };
