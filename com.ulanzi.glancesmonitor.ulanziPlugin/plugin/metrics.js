(function (root) {
  const DEFAULT_SETTINGS = {
    host: '',
    username: '',
    password: '',
    metric: 'cpu',
    target: '',
    label: '',
    interval: '5',
    warn: '',
    danger: '',
  };

  const VIRTUAL_INTERFACE = /^(lo|docker\d*|veth|br-|virbr|vnet|cni|flannel|tailscale|tun|wg)/i;
  const CPU_SENSOR = /^(tctl|tdie|package id 0|cpu|coretemp|k10temp)/i;

  class MetricError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }

  function percentText(value) {
    return `${Math.round(value)}%`;
  }

  function rateText(bytesPerSecond) {
    const units = ['B', 'K', 'M', 'G', 'T'];
    let value = Math.max(0, bytesPerSecond);
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    const digits = unit > 0 && value < 10 ? 1 : 0;
    return `${value.toFixed(digits)}${units[unit]}`;
  }

  function requireList(data) {
    if (!Array.isArray(data) || data.length === 0) throw new MetricError('nodata');
    return data;
  }

  function findTarget(list, field, target) {
    const item = list.find((entry) => String(entry[field]) === target);
    if (!item) throw new MetricError('notfound');
    return item;
  }

  function diskCandidates(list) {
    return list.filter((fs) => fs.fs_type !== 'squashfs' && !String(fs.mnt_point).startsWith('/snap/'));
  }

  function pickDisk(list, target) {
    const disks = requireList(diskCandidates(requireList(list)));
    if (target) return findTarget(list, 'mnt_point', target);
    return (
      disks.find((fs) => fs.mnt_point === '/') ||
      disks.find((fs) => /^[A-Z]:\\?$/i.test(fs.mnt_point)) ||
      disks[0]
    );
  }

  function interfaceTotal(nic) {
    if (typeof nic.bytes_all_gauge === 'number') return nic.bytes_all_gauge;
    if (typeof nic.cumulative_cx === 'number') return nic.cumulative_cx;
    return 0;
  }

  function networkCandidates(list) {
    return list.filter((nic) => !VIRTUAL_INTERFACE.test(nic.interface_name));
  }

  function pickInterface(list, target) {
    requireList(list);
    if (target) return findTarget(list, 'interface_name', target);
    const nics = requireList(networkCandidates(list));
    return nics.reduce((best, nic) => (interfaceTotal(nic) > interfaceTotal(best) ? nic : best));
  }

  function interfaceRates(nic) {
    if (typeof nic.bytes_recv_rate_per_sec === 'number') {
      return { rx: nic.bytes_recv_rate_per_sec, tx: nic.bytes_sent_rate_per_sec || 0 };
    }
    const seconds = nic.time_since_update > 0 ? nic.time_since_update : 1;
    return { rx: (nic.rx || 0) / seconds, tx: (nic.tx || 0) / seconds };
  }

  function temperatureCandidates(list) {
    return list.filter((sensor) => String(sensor.type).startsWith('temperature') && typeof sensor.value === 'number');
  }

  function pickSensor(list, target) {
    requireList(list);
    if (target) return findTarget(list, 'label', target);
    const sensors = requireList(temperatureCandidates(list));
    return (
      sensors.find((sensor) => CPU_SENSOR.test(sensor.label)) ||
      sensors.reduce((hottest, sensor) => (sensor.value > hottest.value ? sensor : hottest))
    );
  }

  function pickGpu(list, target) {
    const gpus = requireList(list);
    return target ? findTarget(gpus, 'gpu_id', target) : gpus[0];
  }

  const METRICS = {
    cpu: {
      endpoint: 'cpu',
      label: 'CPU',
      thresholds: [70, 90],
      read: (data) => ({ bar: data.total, text: percentText(data.total) }),
    },
    mem: {
      endpoint: 'mem',
      label: 'RAM',
      thresholds: [70, 90],
      read: (data) => ({ bar: data.percent, text: percentText(data.percent) }),
    },
    swap: {
      endpoint: 'memswap',
      label: 'SWAP',
      thresholds: [50, 80],
      read: (data) => ({ bar: data.percent, text: percentText(data.percent) }),
    },
    load: {
      endpoint: 'load',
      label: 'LOAD',
      thresholds: [70, 100],
      read: (data) => ({
        bar: (data.min1 / (data.cpucore || 1)) * 100,
        text: data.min1.toFixed(data.min1 < 10 ? 1 : 0),
      }),
    },
    disk: {
      endpoint: 'fs',
      label: 'DISK',
      thresholds: [80, 90],
      targetField: 'mnt_point',
      candidates: diskCandidates,
      read: (data, target) => {
        const fs = pickDisk(data, target);
        return { bar: fs.percent, text: percentText(fs.percent), sublabel: fs.mnt_point };
      },
    },
    net: {
      endpoint: 'network',
      label: 'NET',
      thresholds: null,
      targetField: 'interface_name',
      candidates: networkCandidates,
      read: (data, target) => {
        const nic = pickInterface(data, target);
        const { rx, tx } = interfaceRates(nic);
        return { bar: null, lines: [`↓${rateText(rx)}`, `↑${rateText(tx)}`], sublabel: nic.interface_name };
      },
    },
    temp: {
      endpoint: 'sensors',
      label: 'TEMP',
      thresholds: [70, 85],
      targetField: 'label',
      candidates: temperatureCandidates,
      read: (data, target) => {
        const sensor = pickSensor(data, target);
        const result = { bar: sensor.value, text: `${Math.round(sensor.value)}°`, sublabel: sensor.label };
        if (sensor.warning && sensor.critical) result.thresholds = [sensor.warning, sensor.critical];
        return result;
      },
    },
    gpu: {
      endpoint: 'gpu',
      label: 'GPU',
      thresholds: [70, 90],
      targetField: 'gpu_id',
      candidates: (list) => list,
      read: (data, target) => {
        const gpu = pickGpu(data, target);
        const proc = typeof gpu.proc === 'number' ? gpu.proc : 0;
        return { bar: proc, text: percentText(proc), sublabel: gpu.gpu_id };
      },
    },
  };

  function thresholdsFor(metricKey, settings, reading) {
    const metric = METRICS[metricKey];
    const base = (reading && reading.thresholds) || metric.thresholds;
    if (!base) return null;
    const warn = parseFloat(settings.warn);
    const danger = parseFloat(settings.danger);
    return [Number.isFinite(warn) ? warn : base[0], Number.isFinite(danger) ? danger : base[1]];
  }

  function levelOf(value, thresholds) {
    if (!thresholds || value === null || value === undefined) return 'neutral';
    if (value >= thresholds[1]) return 'danger';
    if (value >= thresholds[0]) return 'warn';
    return 'ok';
  }

  function normalizeHost(host) {
    let url = String(host || '').trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    return url.replace(/\/api\/\d.*$/i, '').replace(/\/+$/, '');
  }

  function targetOptions(metricKey, data) {
    const metric = METRICS[metricKey];
    if (!metric || !metric.targetField || !Array.isArray(data)) return [];
    return metric.candidates(data).map((entry) => String(entry[metric.targetField]));
  }

  const api = {
    DEFAULT_SETTINGS,
    METRICS,
    MetricError,
    rateText,
    thresholdsFor,
    levelOf,
    normalizeHost,
    targetOptions,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GlancesMetrics = api;
})(this);
