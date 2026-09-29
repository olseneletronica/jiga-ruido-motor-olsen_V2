"""
fetch_sheet.py — baixa a planilha e salva um snapshot limpo em
data/raw_ensaios.csv.

- Fonte principal: leitura ao vivo (CSV via gviz). Se falhar, usa a cópia
  do "Publicar na Web" (TSV, atualizada pelo Google a cada ~5 min).
- Separador decimal: a planilha está em locale BR, então os números chegam
  com vírgula ("31,779"). Aqui tudo é convertido para ponto antes de salvar.
- `sentido` é normalizado para "H" (horário) / "AH" (anti-horário).

Uso:
    python scripts/fetch_sheet.py              # planilha real
    python scripts/fetch_sheet.py --exemplo    # dados sintéticos de demonstração
"""
import argparse
import io
import time
import urllib.request
from datetime import datetime, timezone

import pandas as pd

from config import (
    DATA_DIR, EXEMPLO_TSV, EXPECTED_COLUMNS, LIVE_URL, NUMERIC_COLUMNS, RAW_PATH,
    SHEET_URL, normaliza_sentido,
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exemplo", action="store_true",
                        help="Usa data/exemplo/raw_exemplo.tsv em vez da planilha")
    args = parser.parse_args()

    if args.exemplo:
        df = parse_tabela(EXEMPLO_TSV.read_text(encoding="utf-8"), "\t")
        origem = str(EXEMPLO_TSV)
    else:
        try:
            df = parse_tabela(_baixa_texto(LIVE_URL), ",")
            origem = "planilha (ao vivo)"
        except Exception as err:  # sem compartilhamento público, rede, etc.
            print(f"[fetch_sheet] Leitura ao vivo falhou ({err}); usando a cópia publicada.")
            df = parse_tabela(_baixa_texto(SHEET_URL), "\t")
            origem = "planilha (cópia publicada)"

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(RAW_PATH, index=False)

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
