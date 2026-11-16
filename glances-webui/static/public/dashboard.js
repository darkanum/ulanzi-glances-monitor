(function () {
  const REFRESH_MS = Math.max(1, Number(document.body.dataset.refresh) || 5) * 1000;
  const HISTORY = 60;
  const THEME_KEY = 'glances-dashboard-theme';
  const VIRTUAL_NIC = /^(lo$|loopback|docker\d*|veth|br-|virbr|vnet|cni|flannel)/i;
  const VIRTUAL_DISK = /^(loop|ram|zram)|^(nvme\d+n\d+p|mmcblk\d+p)\d+$|^(sd|hd|vd|xvd)[a-z]+\d+$/i;
  const ENDPOINTS = {
    cpu: 'cpu',
    mem: 'mem',
    memswap: 'memswap',
    load: 'load',
    gpu: 'gpu',
    percpu: 'percpu',
    sensors: 'sensors',
    fs: 'fs',
    network: 'network',
    diskio: 'diskio',
    containers: 'containers',
    alert: 'alert',
    uptime: 'uptime',
    processlist: 'processlist/top/8',
  };

  const history = new Map();
  let available = null;

  const byId = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  function num(value, digits = 0) {
    return Number.isFinite(value) ? value.toFixed(digits) : '–';
  }

  function bytes(value, digits = 1) {
    if (!Number.isFinite(value)) return '–';
    const units = ['B', 'K', 'M', 'G', 'T', 'P'];
    let v = Math.max(0, value);
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(i === 0 ? 0 : v < 10 ? digits : 0)}${units[i]}`;
  }

  function rate(value) {
    return `${bytes(value)}/s`;
  }

  function level(value, warn, danger) {
    if (!Number.isFinite(value)) return 'neutral';
    if (value >= danger) return 'danger';
    if (value >= warn) return 'warn';
    return 'ok';
  }

  function bar(percent) {
    const width = Math.max(0, Math.min(100, Number(percent) || 0));
    return `<div class="bar"><i style="width:${width}%"></i></div>`;
  }

  function track(key, value) {
    if (!history.has(key)) history.set(key, []);
    const list = history.get(key);
    list.push(Number.isFinite(value) ? value : 0);
    if (list.length > HISTORY) list.shift();
    return list;
  }

  function spark(points, max = 100) {
    if (points.length < 2) return '<svg class="spark" viewBox="0 0 100 36" preserveAspectRatio="none"></svg>';
    const top = Math.max(max, ...points);
    const step = 100 / (HISTORY - 1);
    const offset = (HISTORY - points.length) * step;
    const coords = points.map((v, i) => `${(offset + i * step).toFixed(2)},${(35 - (v / top) * 33).toFixed(2)}`);
    const area = `${coords[0].split(',')[0]},36 ${coords.join(' ')} 100,36`;
    return `<svg class="spark" viewBox="0 0 100 36" preserveAspectRatio="none"><polygon points="${area}"/><polyline points="${coords.join(' ')}"/></svg>`;
  }

  function facts(pairs) {
    const items = pairs
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`)
      .join('');
    return `<dl class="facts">${items}</dl>`;
  }

  function gauge({ label, sub, value, unit, percent, lvl, points, max, details }) {
    return `<article class="card gauge lvl-${lvl}">
      <div class="head"><span class="label">${esc(label)}</span><span class="sub">${esc(sub || '')}</span></div>
      <div class="value">${esc(value)}<small>${esc(unit)}</small></div>
      ${bar(percent)}
      ${points ? spark(points, max) : ''}
      ${details ? facts(details) : ''}
    </article>`;
  }

  function table(cols, head, rows) {
    const line = (cells, cls = '') => `<div class="tr ${cls}" style="--cols:${cols}">${cells.join('')}</div>`;
    return line(head.map((h, i) => `<span class="${i ? 'r' : ''}">${esc(h)}</span>`), 'th') + rows.map((r) => line(r.cells, r.cls)).join('');
  }

  function show(id, visible) {
    byId(id).hidden = !visible;
  }

  async function getJson(path) {
    const response = await fetch(`api/4/${path}`, { cache: 'no-store' });
    if (response.status === 401) {
      window.location.reload();
      throw new Error('auth');
    }
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  function renderGauges(d) {
    const cards = [];
    if (d.cpu) {
      const cpu = d.cpu;
      cards.push(
        gauge({
          label: 'CPU',
          sub: d.cores ? `${d.cores} cores` : '',
          value: num(cpu.total),
          unit: '%',
          percent: cpu.total,
          lvl: level(cpu.total, 70, 90),
          points: track('cpu', cpu.total),
          details: [
            ['user', `${num(cpu.user, 1)}%`],
            ['sys', `${num(cpu.system, 1)}%`],
            ['iowait', Number.isFinite(cpu.iowait) ? `${num(cpu.iowait, 1)}%` : null],
          ],
        })
      );
    }
    if (d.mem) {
      const mem = d.mem;
      cards.push(
        gauge({
          label: 'RAM',
          sub: `${bytes(mem.used)} / ${bytes(mem.total)}`,
          value: num(mem.percent),
          unit: '%',
          percent: mem.percent,
          lvl: level(mem.percent, 70, 90),
          points: track('mem', mem.percent),
          details: [
            ['free', bytes(mem.available ?? mem.free)],
            ['cached', Number.isFinite(mem.cached) ? bytes(mem.cached) : null],
          ],
        })
      );
    }
    for (const gpu of d.gpu || []) {
      const proc = Number(gpu.proc) || 0;
      const temp = Number.isFinite(gpu.temperature) ? gpu.temperature : null;
      cards.push(
        gauge({
          label: 'GPU',
          sub: gpu.name || gpu.gpu_id,
          value: num(proc),
          unit: '%',
          percent: proc,
          lvl: level(Math.max(proc, temp === null ? 0 : temp >= 85 ? 90 : temp >= 75 ? 70 : 0), 70, 90),
          points: track(`gpu:${gpu.gpu_id}`, proc),
          details: [
            ['temp', temp === null ? null : `${num(temp)}°C`],
            ['vram', Number.isFinite(gpu.mem) ? `${num(gpu.mem)}%` : null],
            ['fan', Number.isFinite(gpu.fan_speed) ? `${num(gpu.fan_speed)}%` : null],
          ],
        })
      );
    }
    if (d.memswap && d.memswap.total > 0) {
      const swap = d.memswap;
      cards.push(
        gauge({
          label: 'SWAP',
          sub: `${bytes(swap.used)} / ${bytes(swap.total)}`,
          value: num(swap.percent),
          unit: '%',
          percent: swap.percent,
          lvl: level(swap.percent, 50, 80),
          details: null,
        })
      );
    }
    if (d.load && Number.isFinite(d.load.min1)) {
      const cores = d.load.cpucore || d.cores || 1;
      const pct = (d.load.min1 / cores) * 100;
      cards.push(
        gauge({
          label: 'LOAD',
          sub: `${cores} cores`,
          value: num(d.load.min1, 2),
          unit: '',
          percent: pct,
          lvl: level(pct, 70, 100),
          details: [
            ['5m', num(d.load.min5, 2)],
            ['15m', num(d.load.min15, 2)],
          ],
        })
      );
    }
    byId('gauges').innerHTML = cards.join('');
  }

  function renderCores(list) {
    const cores = (list || []).filter((c) => Number.isFinite(c.total));
    show('cores-card', cores.length > 0);
    byId('cores').innerHTML = cores
      .map((c) => {
        const lvl = level(c.total, 70, 90);
        return `<div class="core lvl-${lvl}" title="core ${c.cpu_number}: ${num(c.total)}%"><div class="col"><i style="height:${Math.min(100, c.total)}%"></i></div><span>${esc(c.cpu_number)}</span></div>`;
      })
      .join('');
  }

  function renderSensors(list) {
    const temps = (list || []).filter((s) => String(s.type).startsWith('temperature') && Number.isFinite(s.value));
    show('sensors-card', temps.length > 0);
    byId('sensors').innerHTML = temps
      .map((s) => {
        const warn = s.warning || 75;
        const danger = s.critical || 85;
        return `<div class="row lvl-${level(s.value, warn, danger)}"><div class="line"><span class="name">${esc(s.label)}</span><span class="num">${num(s.value)}°C</span></div>${bar((s.value / danger) * 100)}</div>`;
      })
      .join('');
  }

  function renderFs(list) {
    const disks = (list || []).filter((f) => f.fs_type !== 'squashfs' && !String(f.mnt_point).startsWith('/snap/'));
    show('fs-card', disks.length > 0);
    byId('fs').innerHTML = disks
      .sort((a, b) => b.size - a.size)
      .map(
        (f) => `<div class="row lvl-${level(f.percent, 80, 90)}"><div class="line"><span class="name">${esc(f.mnt_point)}</span><span class="num">${bytes(f.used)} <small>/ ${bytes(f.size)}</small> · ${num(f.percent)}%</span></div>${bar(f.percent)}</div>`
      )
      .join('');
  }

  function renderNet(list) {
    const nics = (list || [])
      .filter((n) => !VIRTUAL_NIC.test(n.interface_name) && (n.bytes_all_gauge || n.bytes_all || 0) > 0)
      .sort((a, b) => (b.bytes_all_rate_per_sec || 0) - (a.bytes_all_rate_per_sec || 0))
      .slice(0, 8);
    show('net-card', nics.length > 0);
    byId('net').innerHTML = table(
      'minmax(0,1fr) 88px 88px',
      ['interface', '↓ in', '↑ out'],
      nics.map((n) => ({
        cls: (n.bytes_all_rate_per_sec || 0) > 0 ? '' : 'idle',
        cells: [
          `<span class="ellipsis">${esc(n.alias || n.interface_name)}</span>`,
          `<span class="r down-arrow">${rate(n.bytes_recv_rate_per_sec)}</span>`,
          `<span class="r up-arrow">${rate(n.bytes_sent_rate_per_sec)}</span>`,
        ],
      }))
    );
  }

  function renderDiskio(list) {
    const disks = (list || [])
      .filter((d) => !VIRTUAL_DISK.test(d.disk_name) && (d.read_bytes_gauge || 0) + (d.write_bytes_gauge || 0) > 0)
      .sort((a, b) => b.read_bytes_rate_per_sec + b.write_bytes_rate_per_sec - (a.read_bytes_rate_per_sec + a.write_bytes_rate_per_sec))
      .slice(0, 8);
    show('diskio-card', disks.length > 0);
    byId('diskio').innerHTML = table(
      'minmax(0,1fr) 88px 88px',
      ['disk', 'read', 'write'],
      disks.map((d) => ({
        cls: d.read_bytes_rate_per_sec + d.write_bytes_rate_per_sec > 0 ? '' : 'idle',
        cells: [
          `<span class="ellipsis">${esc(d.alias || d.disk_name)}</span>`,
          `<span class="r down-arrow">${rate(d.read_bytes_rate_per_sec)}</span>`,
          `<span class="r up-arrow">${rate(d.write_bytes_rate_per_sec)}</span>`,
        ],
      }))
    );
  }

  function renderProcs(list) {
    const procs = Array.isArray(list) ? list : [];
    show('procs-card', procs.length > 0);
    byId('procs').innerHTML = table(
      'minmax(0,1fr) 64px 64px',
      ['process', 'cpu', 'mem'],
      procs.map((p) => ({
        cells: [
          `<span class="ellipsis" title="${esc((p.cmdline || []).join(' '))}">${esc(p.name)}</span>`,
          `<span class="r lvl-${level(p.cpu_percent, 50, 90)} num">${num(p.cpu_percent, 1)}%</span>`,
          `<span class="r">${num(p.memory_percent, 1)}%</span>`,
        ],
      }))
    );
  }

  function renderContainers(list) {
    const items = (list || []).slice().sort((a, b) => (b.cpu_percent || 0) - (a.cpu_percent || 0));
    show('containers-card', items.length > 0);
    byId('containers').innerHTML = table(
      'minmax(0,1fr) auto 52px 60px',
      ['container', 'status', 'cpu', 'mem'],
      items.map((c) => {
        const status = String(c.status || '');
        const lvl = /healthy|running/.test(status) && !/unhealthy/.test(status) ? 'ok' : /exited|dead|unhealthy/.test(status) ? 'danger' : 'warn';
        return {
          cells: [
            `<span class="ellipsis">${esc(c.name)}</span>`,
            `<span class="pill lvl-${lvl}">${esc(status || '–')}</span>`,
            `<span class="r">${num(c.cpu_percent, 1)}%</span>`,
            `<span class="r">${bytes(c.memory && c.memory.usage)}</span>`,
          ],
        };
      })
    );
  }

  function renderAlerts(list) {
    const ongoing = (list || []).filter((a) => a.end === -1 || a.end === null);
    const box = byId('alerts');
    box.hidden = ongoing.length === 0;
    box.innerHTML = ongoing
      .map((a) => {
        const lvl = a.state === 'CRITICAL' ? 'danger' : 'warn';
        return `<span class="alert lvl-${lvl}">${esc(a.state)} · ${esc(a.type)} ${num(a.max, 1)}</span>`;
      })
      .join('');
  }

  function setStatus(live) {
    const status = byId('status');
    status.className = `status ${live ? 'live' : 'down'}`;
    status.textContent = live ? `live · ${new Date().toLocaleTimeString()}` : 'offline';
  }

  async function loadHeader() {
    available = new Set(await getJson('pluginslist'));
    const [system, quicklook, core] = await Promise.all(
      ['system', 'quicklook', 'core'].map((p) => (available.has(p) ? getJson(p).catch(() => null) : null))
    );
    if (system) {
      byId('hostname').textContent = system.hostname || 'Glances';
      document.title = `${system.hostname} · Glances`;
    }
    const parts = [
      system && (system.linux_distro || `${system.os_name} ${system.os_version}`),
      quicklook && quicklook.cpu_name,
      core && `${core.phys}C/${core.log}T`,
    ].filter(Boolean);
    byId('platform').textContent = parts.join(' · ');
    return core ? core.log : null;
  }

  async function tick(cores) {
    const keys = Object.keys(ENDPOINTS).filter((k) => available.has(k));
    const results = await Promise.allSettled(keys.map((k) => getJson(ENDPOINTS[k])));
    const d = { cores };
    let anyOk = false;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        d[keys[i]] = r.value;
        anyOk = true;
      }
    });
    setStatus(anyOk);
    if (!anyOk) return;
    byId('uptime').textContent = d.uptime ? `up ${d.uptime}` : '';
    renderAlerts(d.alert);
    renderGauges(d);
    renderCores(d.percpu);
    renderSensors(d.sensors);
    renderFs(d.fs);
    renderNet(d.network);
    renderDiskio(d.diskio);
    renderProcs(d.processlist);
    renderContainers(d.containers);
  }

  function setupTheme() {
    const select = byId('theme');
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch (error) {
      saved = null;
    }
    if (saved && [...select.options].some((o) => o.value === saved)) {
      document.documentElement.dataset.theme = saved;
      select.value = saved;
    }
    select.addEventListener('change', () => {
      document.documentElement.dataset.theme = select.value;
      try {
        localStorage.setItem(THEME_KEY, select.value);
      } catch (error) {
        return;
      }
    });
  }

  async function start() {
    setupTheme();
    let cores = null;
    for (;;) {
      try {
        if (!available) cores = await loadHeader();
        await tick(cores);
      } catch (error) {
        setStatus(false);
      }
      await new Promise((resolve) => setTimeout(resolve, REFRESH_MS));
    }
  }

  start();
})();
