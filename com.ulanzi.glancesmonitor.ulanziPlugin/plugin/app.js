const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.glancesmonitor';
const { DEFAULT_SETTINGS, METRICS, thresholdsFor, levelOf } = GlancesMetrics;
const { clientFor } = GlancesApi;
const { drawKey, stateText } = GlancesRender;

const KEYS = {};
const SCHEDULES = {};

function schedule(key) {
  unschedule(key);
  const seconds = Math.max(2, Number(key.settings.interval) || 5);
  if (!SCHEDULES[seconds]) {
    const keys = new Set();
    SCHEDULES[seconds] = { keys, timer: setInterval(() => keys.forEach((k) => k.refresh()), seconds * 1000) };
  }
  SCHEDULES[seconds].keys.add(key);
  key.seconds = seconds;
}

function unschedule(key) {
  const entry = SCHEDULES[key.seconds];
  if (!entry) return;
  entry.keys.delete(key);
  if (entry.keys.size === 0) {
    clearInterval(entry.timer);
    delete SCHEDULES[key.seconds];
  }
  key.seconds = null;
}

class MetricKey {
  constructor(context) {
    this.context = context;
    this.settings = { ...DEFAULT_SETTINGS };
    this.seconds = null;
    this.active = true;
  }

  apply(settings) {
    this.settings = { ...this.settings, ...(settings || {}) };
    if (this.active) this.start();
  }

  start() {
    this.active = true;
    schedule(this);
    this.refresh();
  }

  stop() {
    this.active = false;
    unschedule(this);
  }

  label(metric, reading) {
    if (this.settings.label) return this.settings.label;
    const showTarget = reading && reading.sublabel && (metric.endpoint !== 'gpu' || this.settings.target);
    return showTarget ? `${metric.label} ${reading.sublabel}` : metric.label;
  }

  async refresh() {
    const metricKey = METRICS[this.settings.metric] ? this.settings.metric : 'cpu';
    const metric = METRICS[metricKey];
    if (!this.settings.host) return this.showState(metric, 'setup');
    try {
      const data = await clientFor(this.settings).get(metric.endpoint);
      const reading = metric.read(data, this.settings.target);
      const thresholds = thresholdsFor(metricKey, this.settings, reading);
      this.draw({ ...reading, label: this.label(metric, reading), level: levelOf(reading.bar, thresholds) });
    } catch (error) {
      this.showState(metric, error.code || 'offline');
    }
  }

  showState(metric, code) {
    this.draw({ label: this.label(metric, null), state: code, stateText: stateText(code, $UD.language) });
  }

  draw(view) {
    if (KEYS[this.context] !== this) return;
    $UD.setBaseDataIcon(this.context, drawKey(view), '');
  }
}

function keyFor(jsn) {
  if (!KEYS[jsn.context]) KEYS[jsn.context] = new MetricKey(jsn.context);
  return KEYS[jsn.context];
}

$UD.connect(PLUGIN_UUID);

$UD.onAdd((jsn) => keyFor(jsn).apply(jsn.param));
$UD.onParamFromApp((jsn) => keyFor(jsn).apply(jsn.param));
$UD.onParamFromPlugin((jsn) => keyFor(jsn).apply(jsn.param));
$UD.onRun((jsn) => keyFor(jsn).refresh());

$UD.onSetActive((jsn) => {
  const key = KEYS[jsn.context];
  if (!key) return;
  if (jsn.active) key.start();
  else key.stop();
});

$UD.onClear((jsn) => {
  for (const item of jsn.param || []) {
    const key = KEYS[item.context];
    if (!key) continue;
    key.stop();
    delete KEYS[item.context];
  }
});
