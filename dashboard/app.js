// Jiga Ruído Motor V2 — Olsen — dashboard
// Lê a planilha publicada (TSV) direto do Google. Com ?fonte=exemplo usa os
// dados sintéticos de data/exemplo/raw_exemplo.tsv.
// A classificação (data/classificacao.csv) é opcional: vem do pipeline Python.

// ============================================================================
// CONFIG — manter sincronizado com scripts/config.py
// ============================================================================
const CONFIG = {
  // Leitura AO VIVO da aba DADOS (onde o ESP32 grava). Exige compartilhamento
  // "Qualquer pessoa com o link: Leitor". Devolve CSV com campos entre aspas.
  // Selecionada pelo NOME da aba (sheet=DADOS), não pelo gid: se a aba for
  // recriada, o gid muda e o link antigo passaria a ler uma aba parada.
  LIVE_URL:
    "https://docs.google.com/spreadsheets/d/1EoOMY2sz4lsfE4Ih1M0O-X2gurAkqWX6_AQtDyLDPfQ/gviz/tq?tqx=out:csv&sheet=DADOS&headers=1",
  // Aba MOTORES (ensaio | motor | observacao | classificacao | atualizado_em).
  // Lida primeiro pelo Apps Script (?acao=listar), que devolve o texto exato das
  // células; o gviz abaixo é só reserva — ele "adivinha" o tipo de cada coluna e
  // apaga valores que não se encaixam (ex: motor "5" misturado com "BOSCH-…").
  MOTORES_URL:
    "https://docs.google.com/spreadsheets/d/1EoOMY2sz4lsfE4Ih1M0O-X2gurAkqWX6_AQtDyLDPfQ/gviz/tq?tqx=out:csv&sheet=MOTORES&headers=1",
  // URL do app da Web do Apps Script que grava na aba MOTORES
  // (ver apps-script/cadastro_motores.gs). Vazio = formulário desativado.
  MOTORES_WRITE_URL: "https://script.google.com/macros/s/AKfycbyFvojPXspkoJNJOpHwEKKKehGACw-Kj54iGgbK0b1dLtfzMvk_2lazoiv3F3WAHYADag/exec",
  EXEMPLO_URL: "../data/exemplo/raw_exemplo.tsv",
  EXEMPLO_MOTORES_URL: "../data/exemplo/motores_exemplo.tsv",
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
let motores = {};          // ensaio -> {motor, obs, classe}  (aba MOTORES da planilha)
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

const withBuster = (u) => `${u}${u.includes("?") ? "&" : "?"}_=${Date.now()}`;

async function fetchTable(url, delimiter) {
  const resp = await fetch(withBuster(url));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  // Sem compartilhamento público o Google devolve a página de login (HTML).
  if (/^\s*</.test(text)) throw new Error("resposta não é uma tabela (planilha sem compartilhamento público?)");
  const data = Papa.parse(text, { header: true, delimiter, skipEmptyLines: true, transformHeader: (h) => h.trim() }).data;
  if (!data.length || !("ensaio" in data[0])) throw new Error("cabeçalho inesperado");
  return data;
}

async function loadRows() {
  let parsed;
  if (usandoExemplo) {
    parsed = await fetchTable(CONFIG.EXEMPLO_URL, "\t");
  } else {
    parsed = await fetchTable(CONFIG.LIVE_URL, ",");
  }
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

// Aba MOTORES: associa cada número de ensaio ao motor testado.
// Se a aba não existir, o Google pode devolver a primeira aba da planilha —
// por isso só aceitamos a resposta se ela tiver a coluna "motor".
function motoresFromRows(data) {
  const out = {};
  data.forEach((r) => {
    const id = Number(String(r.ensaio ?? "").trim());
    const m = {
      motor: String(r.motor ?? "").trim(),
      obs: String(r.observacao ?? "").trim(),
      classe: String(r.classificacao ?? "").trim(),
    };
    // Mantém o cadastro mesmo sem nome de motor (ex: só classificação).
    if (Number.isInteger(id) && id > 0 && (m.motor || m.obs || m.classe)) out[id] = m;
  });
  return out;
}

async function loadMotores() {
  if (usandoExemplo) {
    try { return motoresFromRows(await fetchTable(CONFIG.EXEMPLO_MOTORES_URL, "\t")); } catch { return {}; }
  }
  // 1) Apps Script: texto exato das células, sem adivinhação de tipo.
  if (CONFIG.MOTORES_WRITE_URL) {
    try {
      const resp = await fetch(withBuster(`${CONFIG.MOTORES_WRITE_URL}?acao=listar`));
      const r = await resp.json();
      if (r.ok && Array.isArray(r.linhas)) return motoresFromRows(r.linhas);
      // Script antigo (sem "listar") responde ok sem "linhas": cai no gviz.
    } catch (err) {
      console.warn("Leitura da aba MOTORES pelo Apps Script falhou:", err.message);
    }
  }
  // 2) Reserva: gviz.
  try {
    const data = await fetchTable(CONFIG.MOTORES_URL, ",");
    return "motor" in data[0] ? motoresFromRows(data) : {};
  } catch { return {}; }
}

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const motorDe = (id) => (motores[id] ? motores[id].motor : "");
// "Ensaio 3 · BOSCH-0457" (ou só "Ensaio 3" quando o motor ainda não foi cadastrado)
const ensaioNome = (id) => (motorDe(id) ? `Ensaio ${id} · ${motorDe(id)}` : `Ensaio ${id}`);

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

function fillSelectOptions() {
  const sel = document.getElementById("ensaioSelect");
  const atual = sel.value;
  sel.innerHTML = ensaios.map((e) => `<option value="${e.id}">${esc(ensaioNome(e.id))}</option>`).join("");
  const existe = ensaios.some((e) => String(e.id) === atual);
  sel.value = existe ? atual : ensaios[ensaios.length - 1].id; // abre no ensaio mais recente
}

function populateSelect() {
  fillSelectOptions();
  document.getElementById("ensaioSelect").addEventListener("change", renderEnsaioViews);
}

// --- Cadastro do motor (grava na aba MOTORES via Apps Script) -------------
const TOKEN_KEY = "jiga-v2-token";

function fillMotorForm(e) {
  const m = motores[e.id] || {};
  document.getElementById("fMotor").value = m.motor || "";
  document.getElementById("fObs").value = m.obs || "";
  document.getElementById("fEnsaio").value = `Ensaio ${e.id}`;
  document.getElementById("fClass").value = CLASSES.includes(m.classe) ? m.classe : "";
  document.querySelector("#motorForm summary").textContent =
    m.motor ? `✎ Editar motor do Ensaio ${e.id}` : `✎ Cadastrar motor do Ensaio ${e.id}`;
  const msg = document.getElementById("fMsg");
  msg.textContent = ""; msg.className = "form-msg";
}

function setupMotorForm() {
  const form = document.getElementById("motorFormEl");
  const msg = document.getElementById("fMsg");
  const btn = document.getElementById("fSalvar");
  const tokenIn = document.getElementById("fToken");
  const lembrar = document.getElementById("fLembrar");
  try { const t = localStorage.getItem(TOKEN_KEY); if (t) { tokenIn.value = t; lembrar.checked = true; } } catch {}

  const aviso = usandoExemplo
    ? "Modo demonstração: o cadastro não é gravado na planilha."
    : !CONFIG.MOTORES_WRITE_URL
      ? "Cadastro ainda não configurado: falta a URL do Apps Script em CONFIG.MOTORES_WRITE_URL (ver README)."
      : "";
  if (aviso) { msg.textContent = aviso; msg.className = "form-msg"; }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = currentEnsaio();
    const motor = document.getElementById("fMotor").value.trim();
    const observacao = document.getElementById("fObs").value.trim();
    const classificacao = document.getElementById("fClass").value;
    if (!motor) return;
    if (aviso) { msg.textContent = aviso; msg.className = "form-msg erro"; return; }

    btn.disabled = true;
    msg.textContent = "Salvando…"; msg.className = "form-msg";
    try {
      // text/plain evita o "preflight" de CORS, que o Apps Script não atende.
      const resp = await fetch(CONFIG.MOTORES_WRITE_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: tokenIn.value, ensaio: id, motor, observacao, classificacao }),
      });
      const r = await resp.json();
      if (!r.ok) throw new Error(r.erro || "falha ao gravar");

      try { lembrar.checked ? localStorage.setItem(TOKEN_KEY, tokenIn.value) : localStorage.removeItem(TOKEN_KEY); } catch {}
      motores[id] = { motor: r.motor, obs: r.observacao || "", classe: r.classificacao || "" };
      if (activeTab === "geral") renderGeral();
      fillSelectOptions();
      renderEnsaioViews();
      refreshCmpLabels();
      msg.textContent = `✓ Ensaio ${id} ${r.acao === "criado" ? "cadastrado" : "atualizado"}: ${r.motor}`;
      msg.className = "form-msg ok";
    } catch (err) {
      msg.textContent = `✕ ${err.message}`;
      msg.className = "form-msg erro";
    } finally {
      btn.disabled = false;
    }
  });
}

function badge(cls, texto) {
  return `<span class="badge ${cls}"><span class="dot"></span>${texto}</span>`;
}
// Classificação manual (definida por quem cadastra o motor)
const CLASSES = ["Aprovado", "Reprovado", "Em análise"];
const classeKey = (c) => String(c || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
const classeBadge = (c) => (c ? badge(classeKey(c), esc(c)) : '<span class="muted">—</span>');

// Classificação automática (pipeline Python: data/classificacao.csv)
const STATUS_TXT = { OK: "✓ OK", ATENCAO: "! Atenção", FALHA_PROVAVEL: "✕ Falha provável" };

function renderInfo(e) {
  const c = classif[e.id];
  // Sem classificacao.csv (pipeline ainda não rodou) o selo simplesmente some.
  const temClassif = Object.keys(classif).length > 0;
  document.getElementById("statusBadge").innerHTML = c
    ? badge(c.status, `Automática: ${STATUS_TXT[c.status] || c.status}`)
    : temClassif ? badge("NA", "Sem análise automática") : "";
  const ra = resumoAssimetria(e.id);
  document.getElementById("assimBadge").innerHTML =
    ra.status === "NA" ? badge("NA", "Sentidos incompletos")
    : ra.status === "SIM" ? badge("SIM", `⚠ Assimetria de sentido (${freqLabel(ra.f)})`)
    : badge("NAO", "Sentidos equivalentes");

  const faltando = CONDICOES.filter(({ s, f }) => !e.condicoes.includes(condKey(s, f))).map(({ s, f }) => condLabel(s, f));
  const m = motores[e.id];
  const items = [
    ["Motor", m ? esc(m.motor) : '<span class="muted">não cadastrado</span>'],
    ["Classificação", classeBadge(m && m.classe)],
    ...(m && m.obs ? [["Observação", esc(m.obs)]] : []),
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
    callout.innerHTML = `<strong>${esc(ensaioNome(e.id))}:</strong> não tem os dois sentidos na mesma frequência — comparação indisponível.`;
  } else {
    const flags = ra.a.filter((x) => x.flag);
    callout.innerHTML = `<strong>${esc(ensaioNome(e.id))} — ${ra.status === "SIM" ? "⚠ assimetria de sentido" : "✓ sentidos equivalentes"}.</strong> `
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
      return `<tr><td>${esc(ensaioNome(e.id))}</td>${a.map((x) =>
        `<td class="heat ${x.flag ? "flag" : ""}" style="background:${heatColor(x.delta, x.limite)}" title="${x.m.label}: H ${fmtNum(x.h, x.m.dec)} · AH ${fmtNum(x.ah, x.m.dec)}">${x.flag ? "⚠ " : ""}${fmtDelta(x.delta, x.m.modo)}</td>`
      ).join("")}</tr>`;
    }).join("");
    return `<h3>${freqLabel(f)}</h3><div class="table-wrap"><table>${head}${body}</table></div>`;
  }).join("");
}

// ============================================================================
// Aba 3 — Comparar ensaios
// ============================================================================
// Monta os checkboxes. Na primeira vez marca os 3 ensaios mais recentes;
// ao atualizar os dados, mantém o que já estava marcado.
function renderCmpChecks() {
  const box = document.getElementById("cmpChecks");
  const antes = box.querySelectorAll("input").length
    ? new Set([...box.querySelectorAll("input:checked")].map((i) => Number(i.value)))
    : null;
  box.innerHTML = ensaios.map((e, i) => {
    const on = antes ? antes.has(e.id) : i >= ensaios.length - 3;
    return `<label><input type="checkbox" value="${e.id}" ${on ? "checked" : ""}> ${esc(ensaioNome(e.id))}</label>`;
  }).join("");
  box.querySelectorAll("input").forEach((cb) => cb.addEventListener("change", () => { enforceMax(); renderComparar(); }));
  enforceMax();
}

function setupCmpControls() {
  document.querySelectorAll("input[name=cmpFreq], input[name=cmpSent]").forEach((r) => r.addEventListener("change", renderComparar));
  document.getElementById("cmpClear").addEventListener("click", () => {
    document.querySelectorAll("#cmpChecks input").forEach((cb) => (cb.checked = false));
    enforceMax(); renderComparar();
  });
}

// Atualiza só os nomes dos checkboxes (ex: depois de cadastrar um motor),
// mantendo o que já estava marcado.
function refreshCmpLabels() {
  document.querySelectorAll("#cmpChecks label").forEach((lab) => {
    const cb = lab.querySelector("input");
    lab.lastChild.textContent = ` ${ensaioNome(Number(cb.value))}`;
  });
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
          label: sents.length > 1 ? `${ensaioNome(id)} · ${s}` : ensaioNome(id),
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
  const temAuto = Object.keys(classif).length > 0;
  const head = `<tr><th>Ensaio</th><th>Motor</th><th>Observação</th><th>Início</th><th>Fim</th><th>Duração</th><th>Firmware</th><th>Leituras</th><th>Condições</th><th>Classificação</th>${temAuto ? "<th>Análise automática</th>" : ""}<th>Sentidos</th></tr>`;
  const body = ensaios.slice().reverse().map((e) => {
    const c = classif[e.id];
    const ra = resumoAssimetria(e.id);
    const st = c ? badge(c.status, STATUS_TXT[c.status] || c.status) : `<span class="muted">—</span>`;
    const as = ra.status === "SIM" ? badge("SIM", `⚠ ${ra.n} canais @ ${freqLabel(ra.f)}`) : ra.status === "NAO" ? badge("NAO", "Equivalentes") : badge("NA", "Incompleto");
    const m = motores[e.id];
    return `<tr><td>Ensaio ${e.id}</td><td>${m ? esc(m.motor) : '<span class="muted">não cadastrado</span>'}</td><td class="obs">${m && m.obs ? esc(m.obs) : ""}</td><td>${fmtDataHora(e.inicio)}</td><td>${fmtDataHora(e.fim)}</td><td>${fmtDuracao(e.inicio && e.fim ? (e.fim - e.inicio) / 1000 : NaN)}</td><td>${e.firmware || "—"}</td><td>${e.n}</td><td>${e.condicoes.length}/4</td><td>${classeBadge(m && m.classe)}</td>${temAuto ? `<td>${st}</td>` : ""}<td>${as}</td></tr>`;
  }).join("");
  document.getElementById("geralTable").innerHTML = head + body;

  renderMetricGrid("geralCharts", "ger");
  const labels = ensaios.map((e) => ensaioNome(e.id));
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
      title: (items) => { const e = ensaios[items[0].dataIndex]; return ensaioNome(e.id); },
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
  if (activeTab === "ensaio") { fillMotorForm(e); renderResumoTable(e); renderEnsaioCharts(e); }
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

function carregarTudo() {
  return Promise.all([loadRows(), usandoExemplo ? Promise.resolve({}) : loadClassif(), loadMotores()]);
}

function setStamp(texto, erro = false) {
  const el = document.getElementById("dataStamp");
  el.textContent = texto;
  el.classList.toggle("erro", erro);
}
const horaAgora = () => new Date().toLocaleTimeString("pt-BR");

// Botão "Atualizar dados": busca a planilha de novo SEM recarregar a página,
// mantendo aba, ensaio selecionado e ensaios marcados na comparação.
async function atualizarDados() {
  const btn = document.getElementById("refreshBtn");
  btn.disabled = true;
  setStamp("Atualizando…");
  try {
    const [r, c, m] = await carregarTudo();
    if (!r.length) throw new Error("planilha sem leituras válidas");
    rows = r; classif = c; motores = m;
    buildIndex();
    fillSelectOptions();
    renderCmpChecks();
    renderActive();
    setStamp(`Dados de ${horaAgora()} · ${ensaios.length} ensaio(s), ${rows.length} leituras`);
  } catch (err) {
    setStamp(`Falha ao atualizar (${err.message}) — mostrando os dados anteriores`, true);
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  setupTabs();
  setupTheme();
  document.getElementById("refreshBtn").addEventListener("click", atualizarDados);

  try {
    [rows, classif, motores] = await carregarTudo();
  } catch (err) {
    showEmpty(`Não foi possível ler a planilha (${esc(err.message)}). <br><a href="?fonte=exemplo">Abrir com dados de exemplo</a>`);
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
  setupCmpControls();
  setupMotorForm();
  renderActive();
  setStamp(`Dados de ${horaAgora()} · ${ensaios.length} ensaio(s), ${rows.length} leituras`);
}

init();
