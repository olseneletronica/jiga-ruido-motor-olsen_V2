"""
classify.py — compara cada condição (sentido + frequência) de cada ensaio
contra a referência (baseline.json) e resume em um status por ensaio.
Também traz o resultado da comparação horário × anti-horário (sentido.py).

Uso:
    python scripts/classify.py
Gera:
    data/classificacao.csv
"""
import json

import numpy as np
import pandas as pd

from baseline import REF_COLUMNS, chave
from sentido import resumo_por_ensaio
from config import BASELINE_PATH, CLASSIF_PATH, MOTORES_PATH, POINT_PATH, SENTIDO_PATH

# Acima de quantos desvios-padrão da referência um canal conta como suspeito.
Z_THRESHOLD = 3.0
# Fração de condições suspeitas acima da qual vira FALHA_PROVAVEL.
FALHA_FRACAO = 0.3
# Evita z-score infinito quando a referência tem desvio ~0 (poucos ensaios).
STD_MIN_REL = 0.02  # 2% da média de referência


def zscores(row, ref):
    r = ref.get(chave(row.sentido, row.frequencia_hz))
    if r is None:
        return None
    out = {}
    for col in REF_COLUMNS:
        mean = r[f"{col}_ref_mean"]
        std = max(r[f"{col}_ref_std"], abs(mean) * STD_MIN_REL, 1e-9)
        out[col] = abs(row[col] - mean) / std
    return out


def main():
    cond_df = pd.read_csv(POINT_PATH)
    with open(BASELINE_PATH, encoding="utf-8") as f:
        ref = json.load(f)

    rows = []
    for _, row in cond_df.iterrows():
        z = zscores(row, ref)
        if z is None:
            continue
        pior = max(z, key=z.get)
        rows.append({
            "ensaio": int(row.ensaio),
            "condicao": chave(row.sentido, row.frequencia_hz),
            "z_max": z[pior],
            "canal_pior": pior,
            "suspeita": any(v > Z_THRESHOLD for v in z.values()),
        })
    if not rows:
        raise SystemExit("[classify] Nenhuma condição do dataset tem referência no baseline.")

    det = pd.DataFrame(rows)
    resumo = det.groupby("ensaio").agg(
        z_max_geral=("z_max", "max"),
        condicoes_suspeitas=("suspeita", "sum"),
        condicoes_avaliadas=("suspeita", "count"),
    ).reset_index()
    piores = det.loc[det.groupby("ensaio")["z_max"].idxmax(), ["ensaio", "condicao", "canal_pior"]]
    resumo = resumo.merge(piores.rename(columns={"condicao": "condicao_pior"}), on="ensaio")

    fracao = resumo.condicoes_suspeitas / resumo.condicoes_avaliadas
    resumo["status"] = np.select(
        [resumo.condicoes_suspeitas == 0, fracao > FALHA_FRACAO],
        ["OK", "FALHA_PROVAVEL"], default="ATENCAO",
    )

    if SENTIDO_PATH.exists():
        sent = pd.read_csv(SENTIDO_PATH)
        if not sent.empty:
            resumo = resumo.merge(resumo_por_ensaio(sent), on="ensaio", how="left")

    if MOTORES_PATH.exists():
        resumo = pd.read_csv(MOTORES_PATH)[["ensaio", "motor", "classificacao"]].merge(resumo, on="ensaio", how="right")

    resumo.to_csv(CLASSIF_PATH, index=False)
    print(f"[classify] {len(resumo)} ensaios classificados -> {CLASSIF_PATH}")
    print(resumo.status.value_counts().to_string())


if __name__ == "__main__":
    main()
