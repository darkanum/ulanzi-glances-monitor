(function (root) {
  const SIZE = 144;
  const FONT = '"Source Han Sans SC", "Segoe UI", system-ui, sans-serif';
  const COLORS = {
    background: '#1e1f22',
    label: '#9da5b4',
    value: '#ffffff',
    track: '#2f3136',
    ok: '#3fb950',
    warn: '#d29922',
    danger: '#f85149',
    neutral: '#58a6ff',
    muted: '#6e7681',
  };

  const STATE_TEXT = {
    en: { setup: 'Set URL', offline: 'Offline', auth: 'Login', notfound: 'Not found', nodata: 'No data', notglances: 'Not Glances' },
    pt_PT: { setup: 'Definir URL', offline: 'Offline', auth: 'Login', notfound: 'Não existe', nodata: 'Sem dados', notglances: 'Não é Glances' },
    es_ES: { setup: 'Falta URL', offline: 'Sin conexión', auth: 'Login', notfound: 'No existe', nodata: 'Sin datos', notglances: 'No es Glances' },
    de_DE: { setup: 'URL fehlt', offline: 'Offline', auth: 'Login', notfound: 'Fehlt', nodata: 'Keine Daten', notglances: 'Kein Glances' },
    zh_CN: { setup: '设置地址', offline: '离线', auth: '认证失败', notfound: '未找到', nodata: '无数据', notglances: '非 Glances' },
    zh_HK: { setup: '設定地址', offline: '離線', auth: '認證失敗', notfound: '未找到', nodata: '無數據', notglances: '非 Glances' },
    ja_JP: { setup: 'URL未設定', offline: 'オフライン', auth: '認証エラー', notfound: '見つかりません', nodata: 'データなし', notglances: 'Glancesではない' },
    ko_KR: { setup: 'URL 설정', offline: '오프라인', auth: '인증 실패', notfound: '없음', nodata: '데이터 없음', notglances: 'Glances 아님' },
  };

  function stateText(code, language) {
    const table = STATE_TEXT[language] || STATE_TEXT.en;
    return table[code] || STATE_TEXT.en[code] || code;
  }

  function fitText(ctx, text, weight, maxSize, minSize, maxWidth) {
    let size = maxSize;
    ctx.font = `${weight} ${size}px ${FONT}`;
    while (ctx.measureText(text).width > maxWidth && size > minSize) {
      size -= 1;
      ctx.font = `${weight} ${size}px ${FONT}`;
    }
    if (ctx.measureText(text).width <= maxWidth) return text;
    let clipped = text;
    while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) clipped = clipped.slice(0, -1);
    return `${clipped}…`;
  }

  function drawText(ctx, text, y, color, weight, maxSize, minSize) {
    ctx.fillStyle = color;
    ctx.fillText(fitText(ctx, text, weight, maxSize, minSize, SIZE - 20), SIZE / 2, y);
  }

  function drawKey(view) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, SIZE, SIZE);

    drawText(ctx, view.label, 24, COLORS.label, 600, 20, 13);

    if (view.state) {
      const color = view.state === 'offline' ? COLORS.muted : COLORS.warn;
      drawText(ctx, view.stateText, 76, color, 700, 30, 14);
    } else if (view.lines) {
      drawText(ctx, view.lines[0], 64, COLORS.value, 700, 34, 16);
      drawText(ctx, view.lines[1], 102, COLORS.value, 700, 34, 16);
    } else {
      drawText(ctx, view.text, 74, COLORS.value, 700, 50, 18);
    }

    if (!view.lines) {
      ctx.fillStyle = COLORS.track;
      ctx.fillRect(16, 114, SIZE - 32, 12);
      if (!view.state && typeof view.bar === 'number') {
        const clamped = Math.max(0, Math.min(100, view.bar));
        ctx.fillStyle = COLORS[view.level] || COLORS.neutral;
        ctx.fillRect(16, 114, ((SIZE - 32) * clamped) / 100, 12);
      }
    }

    return canvas.toDataURL('image/png');
  }

  root.GlancesRender = { drawKey, stateText };
})(this);
