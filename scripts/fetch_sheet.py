"""
fetch_sheet.py — baixa a planilha e salva um snapshot limpo em
data/raw_ensaios.csv.

- Fonte: leitura ao vivo da aba DADOS (CSV via gviz, selecionada pelo nome).
- Aba MOTORES: pelo Apps Script (?acao=listar); gviz só como reserva.
- Separador decimal: a planilha está em locale BR, então os números chegam
  com vírgula ("31,779"). Aqui tudo é convertido para ponto antes de salvar.
- `sentido` é normalizado para "H" (horário) / "AH" (anti-horário).

Uso:
    python scripts/fetch_sheet.py              # planilha real
    python scripts/fetch_sheet.py --exemplo    # dados sintéticos de demonstração
    python scripts/fetch_sheet.py --dados DADOS.tsv --motores MOTORES.tsv
                                               # exportações da planilha (offline)
"""
import argparse
import io
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from config import (
    DATA_DIR, EXEMPLO_MOTORES_TSV, EXEMPLO_TSV, EXPECTED_COLUMNS, IMU_COLUMNS, LIVE_URL,
    MOTORES_API_URL, MOTORES_PATH, MOTORES_URL, NUMERIC_COLUMNS, RAW_PATH,
    normaliza_sentido,
)


def _baixa_texto(url: str) -> str:
    # O Google serve o link publicado por vários servidores de borda (CDN);
    # o parâmetro que muda a cada chamada evita pegar uma resposta em cache.
    sep = "&" if "?" in url else "?"
    with urllib.request.urlopen(f"{url}{sep}_={int(time.time())}", timeout=60) as resp:
        return resp.read().decode("utf-8")


def _para_numero(serie: pd.Series) -> pd.Series:
    texto = serie.astype(str).str.strip().str.replace(",", ".", regex=False)
    return pd.to_numeric(texto.replace({"": None, "nan": None}), errors="coerce")


def parse_tabela(texto: str, sep: str) -> pd.DataFrame:
    df = pd.read_csv(io.StringIO(texto), sep=sep, dtype=str, keep_default_na=False)
    df.columns = [c.strip() for c in df.columns]

    faltando = [c for c in EXPECTED_COLUMNS if c not in df.columns]
    if faltando:
        raise ValueError(f"Colunas ausentes na planilha: {faltando}")

    df = df[EXPECTED_COLUMNS].copy()
    for col in NUMERIC_COLUMNS:
        df[col] = _para_numero(df[col])
    df["sentido"] = df["sentido"].map(normaliza_sentido)

    # IMU inteiro zerado = falha de leitura do sensor -> ausente (NaN).
    falha_imu = (df[IMU_COLUMNS] == 0).all(axis=1)
    df.loc[falha_imu, IMU_COLUMNS] = float("nan")
    if falha_imu.any():
        print(f"[fetch_sheet] {int(falha_imu.sum())} leituras com IMU zerado tratadas como ausentes")

    # Linhas sem ensaio/frequência/sentido não servem para nenhuma análise.
    df = df.dropna(subset=["ensaio", "frequencia_hz"])
    df = df[df["sentido"] != ""]
    df["ensaio"] = df["ensaio"].astype(int)
    df["frequencia_hz"] = df["frequencia_hz"].round().astype(int)

    # Timestamp vem como "dd/mm/aaaa hh:mm:ss"; guarda também em ISO.
    df["timestamp_iso"] = pd.to_datetime(
        df["timestamp"], format="%d/%m/%Y %H:%M:%S", errors="coerce"
    ).dt.strftime("%Y-%m-%dT%H:%M:%S")
    return df


COLS_MOTORES = ["ensaio", "motor", "observacao", "classificacao", "atualizado_em"]


def parse_motores(texto: str, sep: str) -> pd.DataFrame:
    """Aba MOTORES (ensaio | motor | observacao | classificacao | atualizado_em).
    Se a aba não existir o Google
    pode devolver a primeira aba — só aceitamos se houver a coluna 'motor'."""
    df = pd.read_csv(io.StringIO(texto), sep=sep, dtype=str, keep_default_na=False)
    df.columns = [c.strip() for c in df.columns]
    if not {"ensaio", "motor"} <= set(df.columns):
        return pd.DataFrame(columns=COLS_MOTORES)
    for c in COLS_MOTORES:
        if c not in df.columns:
            df[c] = ""
    df = df[COLS_MOTORES].apply(lambda c: c.str.strip())
    df["ensaio"] = pd.to_numeric(df["ensaio"], errors="coerce")
    df = df.dropna(subset=["ensaio"])
    df = df[(df["motor"] != "") | (df["observacao"] != "") | (df["classificacao"] != "")]
    df["ensaio"] = df["ensaio"].astype(int)
    return df.drop_duplicates("ensaio", keep="last")


def _sep(caminho: Path) -> str:
    """Exportação do Google: .tsv separa por tabulação, .csv por vírgula."""
    return "\t" if caminho.suffix.lower() in (".tsv", ".txt") else ","


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exemplo", action="store_true",
                        help="Usa data/exemplo/raw_exemplo.tsv em vez da planilha")
    parser.add_argument("--dados", type=Path,
                        help="Arquivo exportado da aba DADOS (.tsv ou .csv) em vez da planilha")
    parser.add_argument("--motores", type=Path,
                        help="Arquivo exportado da aba MOTORES (.tsv ou .csv); usado com --dados")
    args = parser.parse_args()
    if args.exemplo:
        args.dados, args.motores = EXEMPLO_TSV, EXEMPLO_MOTORES_TSV

    if args.dados:
        df = parse_tabela(args.dados.read_text(encoding="utf-8-sig"), _sep(args.dados))
        origem = str(args.dados)
    else:
        df = parse_tabela(_baixa_texto(LIVE_URL), ",")
        origem = "planilha (aba DADOS, ao vivo)"

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(RAW_PATH, index=False)

    try:
        if args.dados:
            if not args.motores:
                raise ValueError("sem --motores")
            motores = parse_motores(args.motores.read_text(encoding="utf-8-sig"), _sep(args.motores))
        else:
            try:
                r = json.loads(_baixa_texto(MOTORES_API_URL))
                if not (r.get("ok") and isinstance(r.get("linhas"), list)):
                    raise ValueError("Apps Script sem 'listar' (reimplante a nova versão)")
                linhas = pd.DataFrame(r["linhas"], columns=COLS_MOTORES).fillna("")
                motores = parse_motores(linhas.to_csv(index=False), ",")
            except Exception as err:
                print(f"[fetch_sheet] MOTORES via Apps Script falhou ({err}); usando gviz.")
                motores = parse_motores(_baixa_texto(MOTORES_URL), ",")
    except Exception as err:
        print(f"[fetch_sheet] Aba MOTORES indisponível ({err}).")
        motores = parse_motores(",".join(COLS_MOTORES) + "\n", ",")
    motores.to_csv(MOTORES_PATH, index=False)
    sem_motor = sorted(set(df["ensaio"]) - set(motores["ensaio"]))
    print(f"[fetch_sheet] {len(motores)} motores cadastrados -> {MOTORES_PATH}")
    if sem_motor:
        print(f"[fetch_sheet] AVISO: ensaios sem motor na aba MOTORES: {sem_motor}")

    desconhecidos = sorted(set(df["sentido"]) - {"H", "AH"})
    print(
        f"[fetch_sheet] {len(df)} linhas de {origem} -> {RAW_PATH} "
        f"({df['ensaio'].nunique()} ensaios) — {datetime.now(timezone.utc).isoformat()}"
    )
    if desconhecidos:
        print(f"[fetch_sheet] AVISO: valores de 'sentido' não reconhecidos: {desconhecidos}")
    freqs = sorted(df["frequencia_hz"].unique())
    if set(freqs) - {15000, 20000}:
        print(f"[fetch_sheet] AVISO: frequências fora do roteiro V2 encontradas: {freqs}")


if __name__ == "__main__":
    main()
