// ============================================================
// SOMENTE REGISTRO — cópia do script que roda vinculado à planilha
// (Extensões → Apps Script). Recebe os dados do ESP32 e grava na aba DADOS.
// Alterações devem ser feitas lá; esta cópia é só documentação.
// ============================================================
//
// ============================================================
// OLSEN - JIGA MOTOR - GOOGLE APPS SCRIPT V0.03
// ============================================================
//
// Recebe dados do ESP32 via HTTP POST.
//
// Nova informacao nesta versao:
//   sentido     = HORARIO ou ANTIHORARIO
//
// O ESP32 envia uma linha por segundo para cada etapa:
//   Sentido 1: 15 kHz x 20 s + 20 kHz x 20 s
//   Sentido 2: 15 kHz x 20 s + 20 kHz x 20 s
//
// ============================================================

const SHEET_NAME = 'DADOS';

function doGet(e) {
  return respostaJSON({
    ok: true,
    projeto: 'OLSEN - JIGA MOTOR',
    firmware: 'V0.03',
    timestamp: new Date().toISOString()
  });
}

function doPost(e) {
  try {
    if (!e || !e.parameter) {
      return respostaJSON({
        ok: false,
        erro: 'Nenhum parametro recebido'
      });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
    }

    criarCabecalho(sheet);

    const p = e.parameter;

    const row = [
      new Date(),
      p.firmware || '',
      numero(p.ensaio),
      p.sentido || '',
      numero(p.frequencia_hz),
      numero(p.segundo),

      numero(p.tensao_v),
      numero(p.corrente_a),
      numero(p.potencia_w),

      numero(p.accel_x_g),
      numero(p.accel_y_g),
      numero(p.accel_z_g),
      numero(p.accel_resultante_g),

      numero(p.gyro_x_dps),
      numero(p.gyro_y_dps),
      numero(p.gyro_z_dps),

      numero(p.audio1_dbfs),
      numero(p.audio1_peak_dbfs),

      numero(p.audio2_dbfs),
      numero(p.audio2_peak_dbfs)
    ];

    sheet.appendRow(row);

    return respostaJSON({
      ok: true,
      mensagem: 'Dados gravados',
      linha: sheet.getLastRow(),
      sentido: p.sentido || '',
      frequencia_hz: p.frequencia_hz || '',
      segundo: p.segundo || ''
    });

  } catch (err) {
    return respostaJSON({
      ok: false,
      erro: String(err)
    });
  }
}

function criarCabecalho(sheet) {
  const headers = [
    'timestamp',
    'firmware',
    'ensaio',
    'sentido',
    'frequencia_hz',
    'segundo',

    'tensao_v',
    'corrente_a',
    'potencia_w',

    'accel_x_g',
    'accel_y_g',
    'accel_z_g',
    'accel_resultante_g',

    'gyro_x_dps',
    'gyro_y_dps',
    'gyro_z_dps',

    'audio1_dbfs',
    'audio1_peak_dbfs',

    'audio2_dbfs',
    'audio2_peak_dbfs'
  ];

  const numCols = headers.length;

  if (sheet.getMaxColumns() < numCols) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      numCols - sheet.getMaxColumns()
    );
  }

  const current = sheet
    .getRange(1, 1, 1, numCols)
    .getValues()[0];

  let needsHeader = false;

  for (let i = 0; i < numCols; i++) {
    if (current[i] !== headers[i]) {
      needsHeader = true;
      break;
    }
  }

  if (needsHeader) {
    sheet.getRange(1, 1, 1, numCols).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function numero(valor) {
  if (valor === undefined || valor === null || valor === '') {
    return '';
  }

  const n = Number(valor);

  return isNaN(n) ? '' : n;
}

function respostaJSON(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
