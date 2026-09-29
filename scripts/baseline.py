"""
baseline.py — constrói a referência de "motor bom" a partir de ensaios
confirmados, separada por condição (sentido + frequência).

Uso:
    python scripts/baseline.py --good 1 2 3
Gera:
    data/baseline.json  (chaves "H_15000", "AH_15000", "H_20000", "AH_20000")
"""
import argparse
import json

import pandas as pd

from config import BASELINE_PATH, POINT_PATH

REF_COLUMNS = [
    "corrente_a_mean", "potencia_w_mean",
    "accel_resultante_g_std", "accel_resultante_g_max",
    "audio1_peak_dbfs_mean", "audio2_peak_dbfs_mean",
]


def chave(sentido: str, freq) -> str:
    return f"{sentido}_{int(round(float(freq)))}"


def build_baseline(cond_df: pd.DataFrame, good: list[int]) -> dict:
    subset = cond_df[cond_df.ensaio.isin(good)]
    if subset.empty:
        raise SystemExit(
            "[baseline] Nenhum dos ensaios informados está em features_por_condicao.csv "
            "(rode scripts/features.py antes)."
        )
    ref = {}
    for (sentido, freq), grp in subset.groupby(["sentido", "frequencia_hz"]):
        entry = {
            "sentido": sentido,
            "frequencia_hz": int(freq),
            "n_ensaios": int(grp.ensaio.nunique()),
            "ensaios": sorted(int(e) for e in grp.ensaio.unique()),
        }
        for col in REF_COLUMNS:
            entry[f"{col}_ref_mean"] = float(grp[col].mean())
            entry[f"{col}_ref_std"] = float(grp[col].std(ddof=0)) if len(grp) > 1 else 0.0
        ref[chave(sentido, freq)] = entry
    return ref


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--good", nargs="+", type=int, required=True,
                        help="Números dos ensaios confirmados como motor bom")
    args = parser.parse_args()

    cond_df = pd.read_csv(POINT_PATH)
    ref = build_baseline(cond_df, args.good)
    with open(BASELINE_PATH, "w", encoding="utf-8") as f:
        json.dump(ref, f, indent=2, ensure_ascii=False)
    print(f"[baseline] {len(args.good)} ensaio(s) de referência -> {BASELINE_PATH} "
          f"({len(ref)} condições: {', '.join(sorted(ref))})")


if __name__ == "__main__":
    main()
