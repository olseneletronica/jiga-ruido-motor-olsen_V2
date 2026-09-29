// Jiga Ruído Motor V2 — Olsen — dashboard
// Lê a planilha publicada (TSV) direto do Google. Com ?fonte=exemplo usa os
// dados sintéticos de data/exemplo/raw_exemplo.tsv.
// A classificação (data/classificacao.csv) é opcional: vem do pipeline Python.

// ============================================================================
// CONFIG — manter sincronizado com scripts/config.py
// ============================================================================
const CONFIG = {
  SHEET_URL:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQPQHZZCerggzoirByMfiJk7NSo08Od6YgiiOQeEy_bTaKEAC_xa1tYhqeRWMJgIkeVBiNwD0h-jXoh/pub?gid=1681403093&single=true&output=tsv",
  EXEMPLO_URL: "../data/exemplo/raw_exemplo.tsv",
  CLASSIF_URL: "../data/classificacao.csv",
  FREQS: [15000, 20000],
  SENTIDOS: ["H", "AH"],
  LIMITE_REL_PCT: { mean: 10, std: 40 },
  LIMITE_DB: 3,
  MIN_CANAIS_ASSIMETRIA: 3,
  MAX_COMPARAR: 8,
};

const TEXT_COLUMNS = ["timestamp", "firmware", "sentido"];

// stat = estatística usada no resumo e na comparação de sentidos
// modo = "rel" (diferença %) ou "db" (diferença absoluta em dB)
const METRICS = [
  { key: "tensao_v", label: "Tensão", unit: "V", group: "Elétrica", stat: "mean", modo: "rel", dec: 2 },
  { key: "corrente_a", label: "Corrente", unit: "A", group: "Elétrica", stat: "mean", modo: "rel", dec: 3 },
  { key: "potencia_w", label: "Potência", unit: "W", group: "Elétrica", stat: "mean", modo: "rel", dec: 2 },
  { key: "accel_x_g", label: "Vibração X", unit: "g", group: "Vibração", stat: "std", modo: "rel", dec: 4 },
  { key: "accel_y_g", label: "Vibração Y", unit: "g", group: "Vibração", stat: "std", modo: "rel", dec: 4 },
  { key: "accel_z_g", label: "Vibração Z", unit: "g", group: "Vibração", stat: "std", modo: "rel", dec: 4 },
  { key: "accel_resultante_g", label: "Vibração resultante", unit: "g", group: "Vibração", stat: "std", modo: "rel", dec: 4 },
  { key: "gyro_x_dps", label: "Giroscópio X", unit: "°/s", group: "Giroscópio", stat: "std", modo: "rel", dec: 3 },
  { key: "gyro_y_dps", label: "Giroscópio Y", unit: "°/s", group: "Giroscópio", stat: "std", modo: "rel", dec: 3 },
  { key: "gyro_z_dps", label: "Giroscópio Z", unit: "°/s", group: "Giroscópio", stat: "std", modo: "rel", dec: 3 },
  { key: "audio1_dbfs", label: "Áudio 1", unit: "dBFS", group: "Áudio", stat: "mean", modo: "db", dec: 2 },
  { key: "audio1_peak_dbfs", label: "Áudio 1 pico", unit: "dBFS", group: "Áudio", stat: "mean", modo: "db", dec: 2 },
  { key: "audio2_dbfs", label: "Áudio 2", unit: "dBFS", group: "Áudio", stat: "mean", modo: "db", dec: 2 },
  { key: "audio2_peak_dbfs", label: "Áudio 2 pico", unit: "dBFS", group: "Áudio", stat: "mean", modo: "db", dec: 2 },
];
const GROUPS = ["Elétrica", "Vibração", "Giroscópio", "Áudio"];
const NUMERIC_COLUMNS = ["ensaio", "frequencia_hz", "segundo", ...METRICS.map((m) => m.key)];

const SENT_LABEL = { H: "Horário", AH: "Anti-horário" };
const freqLabel = (f) => `${f / 1000} kHz`;
const condKey = (s, f) => `${s}_${f}`;
const condLabel = (s, f) => `${freqLabel(f)} · ${SENT_LABEL[s] || s}`;
const CONDICOES = CONFIG.FREQS.flatMap((f) => CONFIG.SENTIDOS.map((s) => ({ s, f })));

// ============================================================================
// Estado
// ============================================================================
let rows = [];
let ensaios = [];          // [{id, inicio, fim, firmware, n, condicoes}]
let classif = {};          // ensaio -> linha de classificacao.csv
let condStats = {};        // `${ensaio}|${s}|${f}` -> {metric: {mean,std,max,min}, n, inicio}
const charts = {};

// ============================================================================
// Utilidades
// ============================================================================
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const seriesColor = (i) => css(`--s${(i % 8) + 1}`);
const freqColor = (f) => seriesColor(CONFIG.FREQS.indexOf(f));

function toNumberBR(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim();
  if (s === "") return NaN;
  return parseFloat(s.replace(",", "."));
}

function normalizaSentido(v) {
  let s = String(v ?? "").trim().toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[-_\s]/g, "");
  if (["H", "HORARIO", "CW", "HOR"].includes(s)) return "H";
  if (["AH", "ANTIHORARIO", "CCW", "AHOR", "ANTI"].includes(s)) return "AH";
  return s;
}

// "29/09/2026 08:33:00" -> Date
function parseTimestamp(t) {
  const m = String(t || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
}
const fmtDataHora = (d) => d ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
const fmtDataHoraCurta = (d) => d ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "sem data";
function fmtDuracao(s) {
  if (!Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m ? `${m} min ${String(r).padStart(2, "0")} s` : `${r} s`;
}
const fmtNum = (v, dec = 2) => Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—";
const fmtDelta = (d, modo) => !Number.isFinite(d) ? "—" : `${d > 0 ? "+" : ""}${fmtNum(d, 1)}${modo === "db" ? " dB" : " %"}`;

function stats(vals) {
  const v = vals.filter(Number.isFinite);
  if (!v.length) return { mean: NaN, std: NaN, max: NaN, min: NaN };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const std = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { mean, std, max: Math.max(...v), min: Math.min(...v) };
}

// ============================================================================
// Carga de dados
// ============================================================================
const params = new URLSearchParams(location.search);
const usandoExemplo = params.get("fonte") === "exemplo";

async function loadRows() {
  const base = usandoExemplo ? CONFIG.EXEMPLO_URL : CONFIG.SHEET_URL;
  const url = `${base}${base.includes("?") ? "&" : "?"}_=${Date.now()}`; // cache-buster da CDN do Google
  const text = await (await fetch(url)).text();
  const parsed = Papa.parse(text, { header: true, delimiter: "\t", skipEmptyLines: true, transformHeader: (h) => h.trim() }).data;
  return parsed.map((r) => {
    const o = { timestamp: r.timestamp, firmware: r.firmware, sentido: normalizaSentido(r.sentido) };
    NUMERIC_COLUMNS.forEach((c) => (o[c] = toNumberBR(r[c])));
    o.frequencia_hz = Math.round(o.frequencia_hz);
    o.date = parseTimestamp(r.timestamp);
    return o;
  }).filter((r) => Number.isFinite(r.ensaio) && Number.isFinite(r.frequencia_hz) && r.sentido);
}

async function loadClassif() {
  try {
    const resp = await fetch(`${CONFIG.CLASSIF_URL}?_=${Date.now()}`);
    if (!resp.ok) return {};
    const data = Papa.parse(await resp.text(), { header: true, skipEmptyLines: true }).data;
    return Object.fromEntries(data.map((r) => [Number(r.ensaio), r]));
  } catch { return {}; }
}

function buildIndex() {
  const byEnsaio = new Map();
  rows.forEach((r) => {
    if (!byEnsaio.has(r.ensaio)) byEnsaio.set(r.ensaio, []);
    byEnsaio.get(r.ensaio).push(r);
  });
  ensaios = [...byEnsaio.entries()].sort((a, b) => a[0] - b[0]).map(([id, rs]) => {
    const dates = rs.map((r) => r.date).filter(Boolean).sort((a, b) => a - b);
    const conds = [...new Set(rs.map((r) => condKey(r.sentido, r.frequencia_hz)))];
    return { id, rows: rs, inicio: dates[0] || null, fim: dates[dates.length - 1] || null,
             firmware: rs[0].firmware, n: rs.length, condicoes: conds };
  });

  condStats = {};
  ensaios.forEach((e) => {
    CONDICOES.forEach(({ s, f }) => {
      const rs = e.rows.filter((r) => r.sentido === s && r.frequencia_hz === f);
      if (!rs.length) return;
      const st = { n: rs.length };
      const d = rs.map((r) => r.date).filter(Boolean).sort((a, b) => a - b);
      st.inicio = d[0] || null;
      METRICS.forEach((m) => (st[m.key] = stats(rs.map((r) => r[m.key]))));
      condStats[`${e.id}|${s}|${f}`] = st;
    });
  });
}

// Mesma regra de scripts/sentido.py
function assimetria(ensaioId) {
  const out = [];
  CONFIG.FREQS.forEach((f) => {
    const h = condStats[`${ensaioId}|H|${f}`], ah = condStats[`${ensaioId}|AH|${f}`];
    METRICS.forEach((m) => {
      if (!h || !ah) { out.push({ f, m, h: NaN, ah: NaN, delta: NaN, limite: NaN, flag: false }); return; }
      const vh = h[m.key][m.stat], vah = ah[m.key][m.stat];
      let delta, limite;
      if (m.modo === "db") { delta = vah - vh; limite = CONFIG.LIMITE_DB; }
      else {
        const ref = (Math.abs(vh) + Math.abs(vah)) / 2;
        delta = ref > 1e-12 ? ((vah - vh) / ref) * 100 : NaN;
        limite = CONFIG.LIMITE_REL_PCT[m.stat];
      }
      out.push({ f, m, h: vh, ah: vah, delta, limite, flag: Number.isFinite(delta) && Math.abs(delta) > limite });
    });
  });
  return out;
}

function resumoAssimetria(ensaioId) {
  const a = assimetria(ensaioId);
  const temAmbos = CONFIG.FREQS.some((f) => condStats[`${ensaioId}|H|${f}`] && condStats[`${ensaioId}|AH|${f}`]);
  if (!temAmbos) return { status: "NA", n: 0, f: null, a };
  let best = { n: -1, f: null };
  CONFIG.FREQS.forEach((f) => {
    const n = a.filter((x) => x.f === f && x.flag).length;
    if (n > best.n) best = { n, f };
  });
  return { status: best.n >= CONFIG.MIN_CANAIS_ASSIMETRIA ? "SIM" : "NAO", n: best.n, f: best.f, a };
}

// ============================================================================
// Gráficos
// ============================================================================
function baseOptions(title, extra = {}) {
  const tick = { color: css("--muted"), font: { size: 11 } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "nearest", axis: "x", intersect: false },
    plugins: {
      title: { display: true, text: title, color: css("--text"), align: "start", font: { size: 13, weight: "600" } },
      legend: { labels: { color: css("--text-2"), boxWidth: 22, boxHeight: 2, usePointStyle: false } },
      tooltip: { backgroundColor: css("--surface-2"), titleColor: css("--text"), bodyColor: css("--text-2"), borderColor: css("--border"), borderWidth: 1 },
    },
    scales: {
      x: { ticks: tick, grid: { color: css("--grid") }, border: { color: css("--axis") } },
      y: { ticks: tick, grid: { color: css("--grid") }, border: { color: css("--axis") } },
    },
    ...extra,
  };
}

function makeChart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas, config);
}

function chartCard(id) {
  return `<div class="card"><div class="chart-box"><canvas id="${id}"></canvas></div></div>`;
}

// Monta os blocos "Elétrica / Vibração / Giroscópio / Áudio" com um card por grandeza.
function renderMetricGrid(containerId, prefix) {
  document.getElementById(containerId).innerHTML = GROUPS.map((g) =>
    `<h3>${g}</h3><div class="grid">${METRICS.filter((m) => m.group === g).map((m) => chartCard(`${prefix}_${m.key}`)).join("")}</div>`
  ).join("");
}

// ============================================================================
// Seletor de ensaio + info (abas 1 e 2)
// ============================================================================
function currentEnsaio() {
  return Number(document.getElementById("ensaioSelect").value);
}

function populateSelect() {
  const sel = document.getElementById("ensaioSelect");
  sel.innerHTML = ensaios.map((e) => `<option value="${e.id}">Ensaio ${e.id}</option>`).join("");
  sel.value = ensaios[ensaios.length - 1].id; // abre no ensaio mais recente
  sel.addEventListener("change", renderEnsaioViews);
}

function badge(cls, texto) {
  return `<span class="badge ${cls}"><span class="dot"></span>${texto}</span>`;
}
const STATUS_TXT = { OK: "✓ OK", ATENCAO: "! Atenção", FALHA_PROVAVEL: "✕ Falha provável" };

function renderInfo(e) {
  const c = classif[e.id];
  // Sem classificacao.csv (pipeline ainda não rodou) o selo simplesmente some.
  const temClassif = Object.keys(classif).length > 0;
  document.getElementById("statusBadge").innerHTML = c
    ? badge(c.status, STATUS_TXT[c.status] || c.status)
    : temClassif ? badge("NA", "Sem classificação") : "";
  const ra = resumoAssimetria(e.id);
  document.getElementById("assimBadge").innerHTML =
    ra.status === "NA" ? badge("NA", "Sentidos incompletos")
    : ra.status === "SIM" ? badge("SIM", `⚠ Assimetria de sentido (${freqLabel(ra.f)})`)
    : badge("NAO", "Sentidos equivalentes");

  const faltando = CONDICOES.filter(({ s, f }) => !e.condicoes.includes(condKey(s, f))).map(({ s, f }) => condLabel(s, f));
  const items = [
    ["Início do ensaio", fmtDataHora(e.inicio)],
    ["Fim do ensaio", fmtDataHora(e.fim)],
    ["Duração total", fmtDuracao(e.inicio && e.fim ? (e.fim - e.inicio) / 1000 : NaN)],
    ["Firmware", e.firmware || "—"],
    ["Leituras", e.n.toLocaleString("pt-BR")],
    ["Condições", faltando.length ? `${4 - faltando.length}/4 (falta: ${faltando.join(", ")})` : "4/4 completas"],
  ];
  document.getElementById("ensaioInfo").innerHTML = items.map(([k, v]) => `<div class="item"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
}

// ============================================================================
// Aba 1 — Ensaio individual
// ============================================================================
function renderResumoTable(e) {
  const conds = CONDICOES.filter(({ s, f }) => condStats[`${e.id}|${s}|${f}`]);
  const head = `<tr><th>Grandeza</th>${conds.map(({ s, f }) => `<th>${condLabel(s, f)}</th>`).join("")}</tr>`;
  const inicio = `<tr><td class="muted">Início da condição</td>${conds.map(({ s, f }) => `<td>${fmtDataHoraCurta(condStats[`${e.id}|${s}|${f}`].inicio)}</td>`).join("")}</tr>`;
  const body = METRICS.map((m) => {
    const lab = `${m.label} ${m.stat === "std" ? "(desvio)" : "(média)"} [${m.unit}]`;
    return `<tr><td>${lab}</td>${conds.map(({ s, f }) => `<td>${fmtNum(condStats[`${e.id}|${s}|${f}`][m.key][m.stat], m.dec)}</td>`).join("")}</tr>`;
  }).join("");
  document.getElementById("resumoTable").innerHTML = head + inicio + body;
}

function condDatasets(e, metricKey) {
  return CONDICOES.map(({ s, f }) => {
    const rs = e.rows.filter((r) => r.sentido === s && r.frequencia_hz === f).sort((a, b) => a.segundo - b.segundo);
    const color = freqColor(f);
    return {
      label: condLabel(s, f),
      data: rs.map((r) => ({ x: r.segundo, y: r[metricKey] })),
      borderColor: color, backgroundColor: color,
      borderWidth: 2, borderDash: s === "AH" ? [6, 4] : [],
      pointRadius: 0, pointHoverRadius: 4, tension: 0.15,
    };
  }).filter((d) => d.data.length);
}

function renderEnsaioCharts(e) {
  renderMetricGrid("ensaioCharts", "ens");
  METRICS.forEach((m) => {
    const opts = baseOptions(`${m.label} (${m.unit})`);
    opts.parsing = false;
    opts.scales.x.type = "linear";
    opts.scales.x.title = { display: true, text: "segundo", color: css("--muted") };
    makeChart(`ens_${m.key}`, { type: "line", data: { datasets: condDatasets(e, m.key) }, options: opts });
  });
}

// ============================================================================
// Aba 2 — Horário × Anti-horário
// ============================================================================
function renderSentidoTab(e) {
  const ra = resumoAssimetria(e.id);
  const callout = document.getElementById("assimCallout");
  callout.className = `callout ${ra.status}`;
  if (ra.status === "NA") {
    callout.innerHTML = `<strong>Ensaio ${e.id}:</strong> não tem os dois sentidos na mesma frequência — comparação indisponível.`;
  } else {
    const flags = ra.a.filter((x) => x.flag);
    callout.innerHTML = `<strong>Ensaio ${e.id} — ${ra.status === "SIM" ? "⚠ assimetria de sentido" : "✓ sentidos equivalentes"}.</strong> `
      + (flags.length
        ? `Canais acima do limite: ${flags.map((x) => `${x.m.label} @ ${freqLabel(x.f)} (${fmtDelta(x.delta, x.m.modo)})`).join("; ")}.`
        : "Nenhum canal acima do limite.")
      + ` <span class="muted">Regra: ≥ ${CONFIG.MIN_CANAIS_ASSIMETRIA} canais acima do limite na mesma frequência.</span>`;
  }

  const blocos = [
    { id: "assimEletrica", title: "Elétrica — média (%)", filt: (m) => m.group === "Elétrica", lim: CONFIG.LIMITE_REL_PCT.mean, unit: "%" },
    { id: "assimDinamica", title: "Vibração e giroscópio — desvio-padrão (%)", filt: (m) => m.stat === "std", lim: CONFIG.LIMITE_REL_PCT.std, unit: "%" },
    { id: "assimAudio", title: "Áudio — média (dB)", filt: (m) => m.modo === "db", lim: CONFIG.LIMITE_DB, unit: "dB" },
  ];
  blocos.forEach((b) => {
    const ms = METRICS.filter(b.filt);
    const labels = ms.map((m) => m.label.replace("Vibração ", "Vib. ").replace("Giroscópio ", "Giro "));
    const datasets = CONFIG.FREQS.map((f) => ({
      type: "bar",
      label: freqLabel(f),
      data: ms.map((m) => { const x = ra.a.find((y) => y.f === f && y.m.key === m.key); return x ? x.delta : null; }),
      backgroundColor: freqColor(f), borderColor: css("--surface"), borderWidth: 1,
      borderRadius: 4, maxBarThickness: 22,
    }));
    [b.lim, -b.lim].forEach((v, i) => datasets.push({
      type: "line", label: i === 0 ? `Limite ±${b.lim} ${b.unit}` : `-lim`, data: ms.map(() => v),
      borderColor: css("--muted"), borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, _hide: i === 1,
    }));
    const opts = baseOptions(b.title);
    opts.interaction = { mode: "index", intersect: false };
    opts.plugins.legend.labels.filter = (item, data) => !data.datasets[item.datasetIndex]._hide;
    opts.plugins.tooltip.filter = (item) => item.dataset.type === "bar";
    opts.plugins.tooltip.callbacks = { label: (c) => `${c.dataset.label}: ${fmtNum(c.raw, 1)} ${b.unit}` };
    opts.scales.y.title = { display: true, text: `AH − H (${b.unit})`, color: css("--muted") };
    makeChart(b.id, { data: { labels, datasets }, options: opts });
  });

  // Tabela de valores
  const head = `<tr><th>Canal</th>${CONFIG.FREQS.map((f) => `<th>H ${freqLabel(f)}</th><th>AH ${freqLabel(f)}</th><th>Δ ${freqLabel(f)}</th>`).join("")}</tr>`;
  const body = METRICS.map((m) => `<tr><td>${m.label} ${m.stat === "std" ? "(desvio)" : "(média)"} [${m.unit}]</td>${CONFIG.FREQS.map((f) => {
    const x = ra.a.find((y) => y.f === f && y.m.key === m.key);
    return `<td>${fmtNum(x.h, m.dec)}</td><td>${fmtNum(x.ah, m.dec)}</td><td class="${x.flag ? "flag" : ""}">${x.flag ? "⚠ " : ""}${fmtDelta(x.delta, m.modo)}</td>`;
  }).join("")}</tr>`).join("");
  document.getElementById("assimTable").innerHTML = head + body;
}

// Cor divergente: azul (AH menor) ↔ cinza ↔ vermelho (AH maior), escala = limite.
function mixHex(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}
function heatColor(delta, limite) {
  if (!Number.isFinite(delta)) return "transparent";
  const t = Math.max(-1, Math.min(1, delta / (limite * 1.5)));
  const mid = css("--div-mid");
  return t >= 0 ? mixHex(mid, css("--div-pos"), t * 0.75) : mixHex(mid, css("--div-neg"), -t * 0.75);
}

function renderHeatmaps() {
  const short = (m) => m.label.replace("Vibração ", "Vib. ").replace("Giroscópio ", "Giro ").replace("resultante", "result.");
  document.getElementById("assimHeatmaps").innerHTML = CONFIG.FREQS.map((f) => {
    const head = `<tr><th>Ensaio</th>${METRICS.map((m) => `<th title="${m.label}">${short(m)}</th>`).join("")}</tr>`;
    const body = ensaios.map((e) => {
      const a = assimetria(e.id).filter((x) => x.f === f);
      return `<tr><td>Ensaio ${e.id}</td>${a.map((x) =>
        `<td class="heat ${x.flag ? "flag" : ""}" style="background:${heatColor(x.delta, x.limite)}" title="${x.m.label}: H ${fmtNum(x.h, x.m.dec)} · AH ${fmtNum(x.ah, x.m.dec)}">${x.flag ? "⚠ " : ""}${fmtDelta(x.delta, x.m.modo)}</td>`
      ).join("")}</tr>`;
    }).join("");
    return `<h3>${freqLabel(f)}</h3><div class="table-wrap"><table>${head}${body}</table></div>`;
  }).join("");
}

// ============================================================================
// Aba 3 — Comparar ensaios
// ============================================================================
function renderCmpChecks() {
  const box = document.getElementById("cmpChecks");
  box.innerHTML = ensaios.map((e, i) =>
    `<label><input type="checkbox" value="${e.id}" ${i >= ensaios.length - 3 ? "checked" : ""}> Ensaio ${e.id}</label>
  ).join("");
  box.querySelectorAll("input").forEach((cb) => cb.addEventListener("change", () => { enforceMax(); renderComparar(); }));
  document.querySelectorAll("input[name=cmpFreq], input[name=cmpSent]").forEach((r) => r.addEventListener("change", renderComparar));
  document.getElementById("cmpClear").addEventListener("click", () => {
    box.querySelectorAll("input").forEach((cb) => (cb.checked = false));
    enforceMax(); renderComparar();
  });
  enforceMax();
}

// Paleta categórica tem 8 cores — acima disso as cores se repetiriam.
function enforceMax() {
  const boxes = [...document.querySelectorAll("#cmpChecks input")];
  const n = boxes.filter((b) => b.checked).length;
  boxes.forEach((b) => (b.disabled = !b.checked && n >= CONFIG.MAX_COMPARAR));
}

function renderComparar() {
  const sel = [...document.querySelectorAll("#cmpChecks input:checked")].map((i) => Number(i.value));
  const f = Number(document.querySelector("input[name=cmpFreq]:checked").value);
  const sentSel = document.querySelector("input[name=cmpSent]:checked").value;
  const sents = sentSel === "AMBOS" ? CONFIG.SENTIDOS : [sentSel];
  const cont = document.getElementById("cmpCharts");
  if (!sel.length) { cont.innerHTML = `<div class="empty" style="margin-top:16px">Marque pelo menos um ensaio.</div>`; return; }

  renderMetricGrid("cmpCharts", "cmp");
  // Cor fica presa ao ensaio (ordem da lista completa), não à posição na seleção.
  const colorOf = (id) => seriesColor(ensaios.findIndex((e) => e.id === id));
  METRICS.forEach((m) => {
    const datasets = [];
    sel.forEach((id) => {
      const e = ensaios.find((x) => x.id === id);
      sents.forEach((s) => {
        const rs = e.rows.filter((r) => r.sentido === s && r.frequencia_hz === f).sort((a, b) => a.segundo - b.segundo);
        if (!rs.length) return;
        datasets.push({
          label: sents.length > 1 ? `Ensaio ${id} · ${s}` : `Ensaio ${id}`,
          data: rs.map((r) => ({ x: r.segundo, y: r[m.key] })),
          borderColor: colorOf(id), backgroundColor: colorOf(id),
          borderWidth: 2, borderDash: s === "AH" ? [6, 4] : [], pointRadius: 0, pointHoverRadius: 4, tension: 0.15,
        });
      });
    });
    const opts = baseOptions(`${m.label} (${m.unit}) — ${freqLabel(f)}${sents.length === 1 ? ` · ${SENT_LABEL[sents[0]]}` : ""}`);
    opts.parsing = false;
    opts.scales.x.type = "linear";
    opts.scales.x.title = { display: true, text: "segundo", color: css("--muted") };
    makeChart(`cmp_${m.key}`, { type: "line", data: { datasets }, options: opts });
  });
}

// ============================================================================
// Aba 4 — Visão geral
// ============================================================================
function renderGeral() {
  const head = `<tr><th>Ensaio</th><th>Início</th><th>Fim</th><th>Duração</th><th>Firmware</th><th>Leituras</th><th>Condições</th><th>Classificação</th><th>Sentidos</th></tr>`;
  const body = ensaios.slice().reverse().map((e) => {
    const c = classif[e.id];
    const ra = resumoAssimetria(e.id);
    const st = c ? badge(c.status, STATUS_TXT[c.status] || c.status) : `<span class="muted">—</span>`;
    const as = ra.status === "SIM" ? badge("SIM", `⚠ ${ra.n} canais @ ${freqLabel(ra.f)}`) : ra.status === "NAO" ? badge("NAO", "Equivalentes") : badge("NA", "Incompleto");
    return `<tr><td>Ensaio ${e.id}</td><td>${fmtDataHora(e.inicio)}</td><td>${fmtDataHora(e.fim)}</td><td>${fmtDuracao(e.inicio && e.fim ? (e.fim - e.inicio) / 1000 : NaN)}</td><td>${e.firmware || "—"}</td><td>${e.n}</td><td>${e.condicoes.length}/4</td><td>${st}</td><td>${as}</td></tr>`;
  }).join("");
  document.getElementById("geralTable").innerHTML = head + body;

  renderMetricGrid("geralCharts", "ger");
  const labels = ensaios.map((e) => `Ensaio ${e.id}`);
  METRICS.forEach((m) => {
    const datasets = CONDICOES.map(({ s, f }) => ({
      label: condLabel(s, f),
      data: ensaios.map((e) => { const st = condStats[`${e.id}|${s}|${f}`]; return st ? st[m.key][m.stat] : null; }),
      borderColor: freqColor(f), backgroundColor: freqColor(f),
      showLine: false, pointStyle: s === "AH" ? "triangle" : "circle",
      pointRadius: s === "AH" ? 6 : 5, pointHoverRadius: 8, pointBorderColor: css("--surface"), pointBorderWidth: 1,
    }));
    const opts = baseOptions(`${m.label} — ${m.stat === "std" ? "desvio-padrão" : "média"} (${m.unit})`);
    opts.interaction = { mode: "index", intersect: false };
    opts.plugins.legend.labels.usePointStyle = true;
    opts.plugins.legend.labels.boxWidth = 9;
    opts.plugins.legend.labels.boxHeight = 9;
    opts.plugins.tooltip.callbacks = {
      title: (items) => { const e = ensaios[items[0].dataIndex]; return `Ensaio ${e.id}`; },
      label: (c) => `${c.dataset.label}: ${fmtNum(c.raw, m.dec)} ${m.unit}`,
    };
    makeChart(`ger_${m.key}`, { type: "line", data: { labels, datasets }, options: opts });
  });
}

// ============================================================================
// Abas, tema e inicialização
// ============================================================================
let activeTab = "ensaio";

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".tab-panel").forEach((p) => (p.style.display = p.id === `tab-${activeTab}` ? "" : "none"));
    const usaSelect = activeTab === "ensaio" || activeTab === "sentido";
    document.getElementById("ensaioBar").style.display = usaSelect ? "" : "none";
    document.getElementById("ensaioInfo").style.display = usaSelect ? "" : "none";
    renderActive();
  }));
}

function renderEnsaioViews() {
  const e = ensaios.find((x) => x.id === currentEnsaio());
  if (!e) return;
  renderInfo(e);
  if (activeTab === "ensaio") { renderResumoTable(e); renderEnsaioCharts(e); }
  if (activeTab === "sentido") { renderSentidoTab(e); renderHeatmaps(); }
}

function renderActive() {
  if (!ensaios.length) return;
  if (activeTab === "ensaio" || activeTab === "sentido") renderEnsaioViews();
  if (activeTab === "comparar") renderComparar();
  if (activeTab === "geral") renderGeral();
}

function setupTheme() {
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem("jiga-v2-tema"); } catch {}
  if (saved) root.dataset.theme = saved;
  document.getElementById("themeBtn").addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("jiga-v2-tema", root.dataset.theme); } catch {}
    renderActive(); // cores dos gráficos vêm das variáveis CSS
  });
}

function showEmpty(html) {
  document.getElementById("loading").style.display = "none";
  const el = document.getElementById("emptyState");
  el.style.display = "";
  el.innerHTML = html;
}

async function init() {
  setupTabs();
  setupTheme();

  try {
    [rows, classif] = await Promise.all([loadRows(), usandoExemplo ? Promise.resolve({}) : loadClassif()]);
  } catch (err) {
    showEmpty(`Não foi possível ler a planilha (${err.message}). <br><a href="?fonte=exemplo">Abrir com dados de exemplo</a>`);
    return;
  }
  if (!rows.length) {
    showEmpty(`A planilha ainda não tem leituras válidas (com ensaio, sentido e frequência).<br><a href="?fonte=exemplo">Abrir com dados de exemplo</a> para ver o dashboard funcionando.`);
    return;
  }

  buildIndex();
  document.getElementById("loading").style.display = "none";
  document.getElementById("app").style.display = "";
  populateSelect();
  renderCmpChecks();
  renderActive();
}

init();
