"""
features.py — constrói a "assinatura" de cada ensaio.

No V2 a unidade de análise é a CONDIÇÃO de ensaio = (sentido, frequência):
cada motor passa por 4 condições — 15 kHz H, 15 kHz AH, 20 kHz H, 20 kHz AH.

Uso:
    python scripts/features.py
Gera:
    data/features_por_condicao.csv  (um resumo por ensaio + sentido + frequência)
    data/features_por_ensaio.csv    (um resumo por ensaio, com início/fim)
"""
import pandas as pd

from config import ENSAIO_PATH, GROUP_KEYS, MOTORES_PATH, POINT_PATH, RAW_PATH, SIGNAL_COLUMNS


def build_condicao_features(df: pd.DataFrame) -> pd.DataFrame:
    grouped = df.groupby(GROUP_KEYS).agg({c: ["mean", "std", "max", "min"] for c in SIGNAL_COLUMNS})
    grouped.columns = ["_".join(c) for c in grouped.columns]
    extra = df.groupby(GROUP_KEYS).agg(
        n_leituras=("segundo", "count"),
        duracao_s=("segundo", "max"),
        inicio=("timestamp_iso", "min"),
    )
    return grouped.join(extra).reset_index()


def build_ensaio_features(df: pd.DataFrame) -> pd.DataFrame:
    base = df.groupby("ensaio").agg(
        firmware=("firmware", "first"),
        inicio=("timestamp_iso", "min"),
        fim=("timestamp_iso", "max"),
        n_leituras=("segundo", "count"),
        corrente_a_max=("corrente_a", "max"),
        potencia_w_max=("potencia_w", "max"),
        accel_resultante_g_max=("accel_resultante_g", "max"),
        audio1_peak_dbfs_max=("audio1_peak_dbfs", "max"),
        audio2_peak_dbfs_max=("audio2_peak_dbfs", "max"),
    ).reset_index()

    cond = (df.assign(cond=df["sentido"] + "_" + df["frequencia_hz"].astype(str))
              .groupby("ensaio")["cond"].agg(lambda s: " ".join(sorted(s.unique())))
              .rename("condicoes"))
    base = base.merge(cond, on="ensaio", how="left")
    base["n_condicoes"] = base["condicoes"].str.split().str.len()

    ini = pd.to_datetime(base["inicio"])
    fim = pd.to_datetime(base["fim"])
    base["duracao_total_s"] = (fim - ini).dt.total_seconds()
    return base


def main():
    df = pd.read_csv(RAW_PATH)
    cond_df = build_condicao_features(df)
    ensaio_df = build_ensaio_features(df)
    if MOTORES_PATH.exists():
        ensaio_df = pd.read_csv(MOTORES_PATH).merge(ensaio_df, on="ensaio", how="right")
    cond_df.to_csv(POINT_PATH, index=False)
    ensaio_df.to_csv(ENSAIO_PATH, index=False)
    print(f"[features] {len(cond_df)} condições (ensaio+sentido+frequência) -> {POINT_PATH}")
    print(f"[features] {len(ensaio_df)} ensaios -> {ENSAIO_PATH}")
    incompletos = ensaio_df[ensaio_df["n_condicoes"] < 4]
    if not incompletos.empty:
        print(f"[features] AVISO: ensaios sem as 4 condições: {incompletos['ensaio'].tolist()}")


if __name__ == "__main__":
    main()
