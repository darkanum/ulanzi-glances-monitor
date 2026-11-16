const { DEFAULT_SETTINGS, METRICS, MetricError, targetOptions } = GlancesMetrics;
const { GlancesClient } = GlancesApi;

const STATUS_MESSAGES = {
  setup: 'Enter the Glances server URL',
  offline: 'Server not reachable',
  auth: 'Login failed',
  notglances: 'Not a Glances server',
  nodata: 'This server has no data for this metric',
};

let form = null;
let settings = { ...DEFAULT_SETTINGS };
let checkId = 0;

function setStatus(text, kind) {
  const status = document.querySelector('#status');
  status.textContent = text;
  status.className = `uspi-item-value status ${kind || ''}`;
}

function updateFields() {
  const metric = METRICS[settings.metric] || METRICS.cpu;
  document.querySelector('#target-field').classList.toggle('hidden-field', !metric.targetField);
  for (const field of document.querySelectorAll('.threshold-field')) {
    field.classList.toggle('hidden-field', !metric.thresholds);
  }
  const thresholds = metric.thresholds || ['', ''];
  form.elements.warn.placeholder = thresholds[0];
  form.elements.danger.placeholder = thresholds[1];
}

function fillTargets(options) {
  const select = document.querySelector('#target');
  const current = settings.target || '';
  const values = options.includes(current) || !current ? options : [current, ...options];
  select.length = 1;
  for (const value of values) select.add(new Option(value, value));
  select.value = current;
}

async function checkServer() {
  const id = ++checkId;
  updateFields();
  if (!settings.host) return setStatus($UD.t(STATUS_MESSAGES.setup), '');
  setStatus($UD.t('Checking…'), '');
  const client = new GlancesClient(settings.host, settings.username, settings.password);
  const metric = METRICS[settings.metric] || METRICS.cpu;
  try {
    const data = await client.get(metric.endpoint);
    if (id !== checkId) return;
    setStatus(`${$UD.t('Connected to Glances API')} v${client.version}`, 'ok');
    if (metric.targetField) fillTargets(targetOptions(settings.metric, data));
  } catch (error) {
    if (id !== checkId) return;
    const code = error instanceof MetricError ? error.code : 'offline';
    setStatus($UD.t(STATUS_MESSAGES[code] || STATUS_MESSAGES.offline), 'error');
    if (metric.targetField) fillTargets([]);
  }
}

function loadSettings(jsn) {
  if (!jsn || !form) return;
  settings = { ...DEFAULT_SETTINGS, ...(jsn.param || {}) };
  fillTargets([]);
  Utils.setFormValue(settings, form);
  checkServer();
}

$UD.connect();

$UD.onConnected(() => {
  form = document.querySelector('#property-inspector');
  document.querySelector('.uspi-wrapper').classList.remove('hidden');
  updateFields();
  form.addEventListener(
    'input',
    Utils.debounce(() => {
      const previous = settings;
      settings = { ...DEFAULT_SETTINGS, ...Utils.getFormValue(form) };
      if (previous.metric !== settings.metric) settings.target = '';
      $UD.sendParamFromPlugin(settings);
      const connectionChanged = ['host', 'username', 'password', 'metric'].some((k) => previous[k] !== settings[k]);
      if (connectionChanged) checkServer();
      else updateFields();
    }, 400)
  );
  checkServer();
});

$UD.onAdd(loadSettings);
$UD.onParamFromApp(loadSettings);
