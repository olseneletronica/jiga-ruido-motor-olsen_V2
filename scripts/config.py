"""
config.py — constantes compartilhadas por todos os scripts do pipeline V2.

Qualquer mudança no cabeçalho da planilha, nas frequências do roteiro ou nos
limites de assimetria deve ser feita AQUI (e espelhada em dashboard/app.js,
seção CONFIG, para o dashboard continuar coerente com o pipeline).
"""
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
EXEMPLO_DIR = DATA_DIR / "exemplo"

RAW_PATH = DATA_DIR / "raw_ensaios.csv"
POINT_PATH = DATA_DIR / "features_por_condicao.csv"
ENSAIO_PATH = DATA_DIR / "features_por_ensaio.csv"
SENTIDO_PATH = DATA_DIR / "assimetria_sentido.csv"
BASELINE_PATH = DATA_DIR / "baseline.json"
CLASSIF_PATH = DATA_DIR / "classificacao.csv"
EXEMPLO_TSV = EXEMPLO_DIR / "raw_exemplo.tsv"
EXEMPLO_MOTORES_TSV = EXEMPLO_DIR / "motores_exemplo.tsv"
MOTORES_PATH = DATA_DIR / "motores.csv"

# Leitura AO VIVO da planilha (exige "Qualquer pessoa com o link: Leitor").
# Devolve CSV com todos os campos entre aspas e vírgula decimal (locale BR).
LIVE_URL = (
    "https://docs.google.com/spreadsheets/d/1EoOMY2sz4lsfE4Ih1M0O-X2gurAkqWX6_AQtDyLDPfQ/"
    "gviz/tq?tqx=out:csv&gid=1681403093&headers=1"
)

# Aba MOTORES da mesma planilha: associa o número do ensaio ao motor testado.
# Colunas: ensaio | motor | observacao
MOTORES_URL = (
    "https://docs.google.com/spreadsheets/d/1EoOMY2sz4lsfE4Ih1M0O-X2gurAkqWX6_AQtDyLDPfQ/"
    "gviz/tq?tqx=out:csv&sheet=MOTORES&headers=1"
)

# Alternativa: cópia do "Publicar na Web" em TSV (Google atualiza a cada ~5 min).
SHEET_URL = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vQPQHZZCerggzoirByMfiJk7NSo08Od6YgiiOQeEy_bTaKEAC_xa1tYhqeRWMJgIkeVBiNwD0h-jXoh/"
    "pub?gid=1681403093&single=true&output=tsv"
)

# Cabeçalho exato da planilha V2 (ordem incluída).
EXPECTED_COLUMNS = [
    "timestamp", "firmware", "ensaio", "sentido", "frequencia_hz", "segundo",
    "tensao_v", "corrente_a", "potencia_w",
    "accel_x_g", "accel_y_g", "accel_z_g", "accel_resultante_g",
    "gyro_x_dps", "gyro_y_dps", "gyro_z_dps",
    "audio1_dbfs", "audio1_peak_dbfs", "audio2_dbfs", "audio2_peak_dbfs",
]

TEXT_COLUMNS = ["timestamp", "firmware", "sentido"]
NUMERIC_COLUMNS = [c for c in EXPECTED_COLUMNS if c not in TEXT_COLUMNS]

SIGNAL_COLUMNS = [
    "tensao_v", "corrente_a", "potencia_w",
    "accel_x_g", "accel_y_g", "accel_z_g", "accel_resultante_g",
    "gyro_x_dps", "gyro_y_dps", "gyro_z_dps",
    "audio1_dbfs", "audio1_peak_dbfs", "audio2_dbfs", "audio2_peak_dbfs",
]

# Roteiro V2: só 15 kHz e 20 kHz, cada uma nos dois sentidos.
FREQUENCIAS_HZ = [15000, 20000]
SENTIDOS = ["H", "AH"]  # H = horário, AH = anti-horário
SENTIDO_LABEL = {"H": "Horário", "AH": "Anti-horário"}

# Condição de ensaio = sentido + frequência (ex: "H_15000").
GROUP_KEYS = ["ensaio", "sentido", "frequencia_hz"]


def normaliza_sentido(valor) -> str:
    """Aceita as grafias mais prováveis vindas do firmware/planilha e devolve
    'H' ou 'AH'. Valores desconhecidos voltam em maiúsculas, sem alteração,
    para aparecerem no dashboard e serem corrigidos na origem."""
    if valor is None:
        return ""
    s = str(valor).strip().upper()
    s = (s.replace("Á", "A").replace("-", "").replace("_", "").replace(" ", ""))
    if s in {"H", "HORARIO", "CW", "HOR"}:
        return "H"
    if s in {"AH", "ANTIHORARIO", "CCW", "AHOR", "ANTI"}:
        return "AH"
    return s


# --- Comparação horário × anti-horário ----------------------------------
#
# Para cada canal, qual estatística comparar entre os sentidos e como medir a
# diferença:
#   "rel" -> diferença relativa em %:  (AH - H) / média(|H|, |AH|) * 100
#   "db"  -> diferença absoluta em dB: AH - H (áudio já é logarítmico)
#
# Vibração e giroscópio usam o DESVIO-PADRÃO dentro do bloco (componente
# dinâmica), porque a média do acelerômetro carrega a gravidade e mascara a
# vibração real do motor.
ASSIMETRIA_CANAIS = [
    ("corrente_a", "mean", "rel"),
    ("potencia_w", "mean", "rel"),
    ("tensao_v", "mean", "rel"),
    ("accel_x_g", "std", "rel"),
    ("accel_y_g", "std", "rel"),
    ("accel_z_g", "std", "rel"),
    ("accel_resultante_g", "std", "rel"),
    ("gyro_x_dps", "std", "rel"),
    ("gyro_y_dps", "std", "rel"),
    ("gyro_z_dps", "std", "rel"),
    ("audio1_dbfs", "mean", "db"),
    ("audio1_peak_dbfs", "mean", "db"),
    ("audio2_dbfs", "mean", "db"),
    ("audio2_peak_dbfs", "mean", "db"),
]

# Limites iniciais — calibrar quando houver ensaios suficientes de motores bons.
# O desvio-padrão de ~30 leituras oscila bem mais que a média, por isso os
# canais comparados por "std" têm um limite relativo mais largo.
LIMITE_ASSIMETRIA_REL_PCT = {"mean": 10.0, "std": 40.0}
LIMITE_ASSIMETRIA_DB = 3.0

# Um ensaio só é marcado com assimetria de sentido quando pelo menos este
# número de canais passa do limite NA MESMA frequência (um canal isolado
# costuma ser ruído de medição).
MIN_CANAIS_ASSIMETRIA = 3
