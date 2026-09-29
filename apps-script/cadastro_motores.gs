/**
 * Cadastro de motores — Jiga Ruído Motor V2 (Olsen)
 *
 * Recebe do dashboard (GitHub Pages) o motor testado em cada ensaio (motor,
 * observação e classificação: Aprovado / Reprovado / Em análise) e grava
 * na aba MOTORES da planilha. Se o ensaio já tiver cadastro, atualiza a linha;
 * se não, cria uma nova.
 *
 * É um projeto Apps Script SEPARADO (script.google.com → Novo projeto), para
 * não mexer no script que recebe os dados da jiga (ESP32).
 *
 * Configuração (uma vez só):
 *   1. Configurações do projeto (engrenagem) → Propriedades do script →
 *      adicionar  TOKEN = <uma senha à sua escolha>
 *   2. Implantar → Nova implantação → tipo "App da Web"
 *        Executar como: Eu
 *        Quem pode acessar: Qualquer pessoa
 *      Autorize o acesso à planilha quando pedido.
 *   3. Copie a URL do app da Web (termina em /exec) e cole em
 *      CONFIG.MOTORES_WRITE_URL no dashboard/app.js.
 *
 * A senha NÃO vai para o repositório: quem cadastra digita no dashboard.
 */

const PLANILHA_ID = "1EoOMY2sz4lsfE4Ih1M0O-X2gurAkqWX6_AQtDyLDPfQ";
const ABA = "MOTORES";
const CABECALHO = ["ensaio", "motor", "observacao", "classificacao", "atualizado_em"];
const CLASSES = ["", "Aprovado", "Reprovado", "Em análise"];

function resposta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    const token = PropertiesService.getScriptProperties().getProperty("TOKEN");
    if (!token) return resposta_({ ok: false, erro: "TOKEN não configurado no Apps Script" });
    if (body.token !== token) return resposta_({ ok: false, erro: "Senha inválida" });

    const ensaio = Number(body.ensaio);
    const motor = String(body.motor || "").trim().slice(0, 80);
    const obs = String(body.observacao || "").trim().slice(0, 300);
    if (!Number.isInteger(ensaio) || ensaio <= 0) return resposta_({ ok: false, erro: "Número de ensaio inválido" });
    const classe = String(body.classificacao || "").trim();
    if (!motor) return resposta_({ ok: false, erro: "Informe o motor" });
    if (CLASSES.indexOf(classe) < 0) return resposta_({ ok: false, erro: "Classificação inválida" });

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const ss = SpreadsheetApp.openById(PLANILHA_ID);
      let sh = ss.getSheetByName(ABA);
      if (!sh) {
        sh = ss.insertSheet(ABA);
        sh.appendRow(CABECALHO);
      }
      // Cabeçalho completo (inclui colunas novas numa aba criada à mão).
      sh.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]);
      // Texto puro, para "0451" não virar 451.
      sh.getRange("B:D").setNumberFormat("@");
      const agora = Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy HH:mm:ss");
      const linha = [ensaio, motor, obs, classe, agora];

      const valores = sh.getDataRange().getValues();
      for (let i = 1; i < valores.length; i++) {
        if (Number(valores[i][0]) === ensaio) {
          sh.getRange(i + 1, 1, 1, linha.length).setValues([linha]);
          return resposta_({ ok: true, acao: "atualizado", ensaio, motor, observacao: obs, classificacao: classe });
        }
      }
      sh.appendRow(linha);
      return resposta_({ ok: true, acao: "criado", ensaio, motor, observacao: obs, classificacao: classe });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return resposta_({ ok: false, erro: String(err) });
  }
}

// GET
//   .../exec                 -> {"ok":true,"servico":"cadastro-motores",...} (teste)
//   .../exec?acao=listar     -> todas as linhas da aba MOTORES, com o TEXTO
//                               exato de cada célula (getDisplayValues). Evita o
//                               problema do gviz, que apaga valores de tipos
//                               misturados na mesma coluna. Não exige senha:
//                               a planilha já é pública para leitura.
function doGet(e) {
  const acao = e && e.parameter && e.parameter.acao;
  if (acao !== "listar") {
    return resposta_({ ok: true, servico: "cadastro-motores", aba: ABA, versao: 2 });
  }
  try {
    const sh = SpreadsheetApp.openById(PLANILHA_ID).getSheetByName(ABA);
    if (!sh || sh.getLastRow() < 1) return resposta_({ ok: true, linhas: [] });
    const valores = sh.getDataRange().getDisplayValues();
    const cab = valores[0].map(function (c) { return String(c).trim(); });
    const linhas = valores.slice(1)
      .filter(function (l) { return String(l[0]).trim() !== ""; })
      .map(function (l) {
        const o = {};
        cab.forEach(function (c, i) { if (c) o[c] = l[i]; });
        return o;
      });
    return resposta_({ ok: true, linhas: linhas });
  } catch (err) {
    return resposta_({ ok: false, erro: String(err) });
  }
}
