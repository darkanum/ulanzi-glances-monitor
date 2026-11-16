const KEYS = {};

class MetricKey {
  constructor(context, settings) {
    this.context = context;
    this.settings = { ...DEFAULT_SETTINGS };
    this.timer = null;
    this.inFlight = false;
    this.applySettings(settings);
  }

  applySettings(settings) {
    this.settings = { ...this.settings, ...(settings || {}) };
    this.start();
  }

  start() {
    this.stop();
    const seconds = Math.max(2, Number(this.settings.interval) || 5);
    this.poll();
    this.timer = setInterval(() => this.poll(), seconds * 1000);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async poll() {
    if (this.inFlight) return;
    const metric = METRICS[this.settings.metric] || METRICS.cpu;
    const url = `${String(this.settings.host).replace(/\/+$/, '')}/api/4/${metric.path}`;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
    this.inFlight = true;
    try {
      const response = await fetch(url, { signal: abort.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const percent = metric.percent(data);
      const text = metric.text ? metric.text(data) : `${Math.round(percent)}%`;
      this.render(metric.label, text, percent);
    } catch (error) {
      this.render(metric.label, 'offline', null);
    } finally {
      clearTimeout(timeout);
      this.inFlight = false;
    }
  }

  render(label, text, percent) {
    $UD.setBaseDataIcon(this.context, drawMetric(label, text, percent), '');
  }
}

$UD.connect('local.homelab.ulanzistudio.stats');

$UD.onAdd((jsn) => {
  const existing = KEYS[jsn.context];
  if (existing) existing.applySettings(jsn.param);
  else KEYS[jsn.context] = new MetricKey(jsn.context, jsn.param);
});

$UD.onParamFromApp((jsn) => KEYS[jsn.context]?.applySettings(jsn.param));
$UD.onParamFromPlugin((jsn) => KEYS[jsn.context]?.applySettings(jsn.param));

$UD.onRun((jsn) => {
  const key = KEYS[jsn.context];
  if (key) key.poll();
  else $UD.emit('add', jsn);
});

$UD.onSetActive((jsn) => {
  const key = KEYS[jsn.context];
  if (!key) return;
  if (jsn.active) key.start();
  else key.stop();
});

$UD.onClear((jsn) => {
  for (const item of jsn.param || []) {
    KEYS[item.context]?.stop();
    delete KEYS[item.context];
  }
});
