"""
discriminantes.py — quais grandezas separam motores aprovados de reprovados.

Usa a classificação manual da aba MOTORES (Aprovado / Reprovado / Em análise)
e as leituras da aba DADOS. Para cada motor calcula indicadores resumidos
(média das 4 condições), compara os grupos e propõe limites a partir dos
APROVADOS (média + 3 desvios-padrão), sem ajustar os limites em cima dos
reprovados. Também testa a regra deixando um motor de fora por vez.

Uso (depois de scripts/fetch_sheet.py):
    python scripts/discriminantes.py
    python scripts/discriminantes.py --corte 24 33   # + teste com motores novos:
        limites só com os aprovados até o ensaio de corte, aplicados aos
        ensaios seguintes (até o próximo corte)
Gera:
    data/indicadores_por_motor.csv   indicadores + classificação + bandeiras
    data/limites_propostos.json      limites calculados com os aprovados
"""
import argparse
import json

import numpy as np
import pandas as pd

from config import DATA_DIR, MOTORES_PATH, RAW_PATH

OUT_CSV = DATA_DIR / "indicadores_por_motor.csv"
OUT_LIM = DATA_DIR / "limites_propostos.json"

# Indicadores da regra: acima do limite = bandeira de reprovação.
REGRA = {
    "audio_nivel_db": "Nível de áudio (média dos 2 mics, dBFS)",
    "audio_instab_db": "Instabilidade do áudio (desvio no bloco, dB)",
    "vib_dinamica_g": "Vibração dinâmica (desvio da resultante, g)",
    "vib_lateral_y_g": "Vibração lateral Y (média, g)",
}
# Sinal de atenção (não entra na regra): abaixo do limite.
ATENCAO_BAIXO = {"corrente_a": "Corrente média (A)"}
N_SIGMA = 3.0


def indicadores(raw: pd.DataFrame) -> pd.DataFrame:
    g = raw.groupby(["ensaio", "sentido", "frequencia_hz"])
    cond = pd.DataFrame({
        "a1": g["audio1_dbfs"].mean(), "a2": g["audio2_dbfs"].mean(),
        "s1": g["audio1_dbfs"].std(), "s2": g["audio2_dbfs"].std(),
        "vib_dinamica_g": g["accel_resultante_g"].std(),
        "vib_lateral_y_g": g["accel_y_g"].mean(),
        "corrente_a": g["corrente_a"].mean(),
    })
    cond["audio_nivel_db"] = cond[["a1", "a2"]].mean(axis=1)
    cond["audio_instab_db"] = cond[["s1", "s2"]].mean(axis=1)
    cols = list(REGRA) + list(ATENCAO_BAIXO)
    return cond[cols].groupby("ensaio").mean()   # média das 4 condições


def limites(ind: pd.DataFrame) -> dict:
    a = ind[ind.classe == "APROVADO"]
    lim = {k: float(a[k].mean() + N_SIGMA * a[k].std(ddof=1)) for k in REGRA}
    lim.update({k: float(a[k].mean() - N_SIGMA * a[k].std(ddof=1)) for k in ATENCAO_BAIXO})
    return lim


def bandeiras(row, lim) -> list[str]:
    return [k for k in REGRA if row[k] > lim[k]]


def prospectivo(ind: pd.DataFrame, cortes: list[int]) -> None:
    """Simula o uso real: limites congelados no corte, aplicados a motores novos."""
    base = ind[ind.classe.isin(["APROVADO", "REPROVADO"])]
    fins = cortes[1:] + [int(ind.index.max())]
    total = certos = 0
    print("\nTeste com motores novos (limites congelados em cada corte):")
    for corte, fim in zip(cortes, fins):
        treino = base[base.index <= corte]
        if (treino.classe == "APROVADO").sum() < 3:
            print(f"  corte {corte}: menos de 3 aprovados, pulado"); continue
        l = limites(treino)
        novos = base[(base.index > corte) & (base.index <= fim)]
        erros = [e for e, r in novos.iterrows()
                 if ("REPROVADO" if bandeiras(r, l) else "APROVADO") != r.classe]
        n = len(novos); total += n; certos += n - len(erros)
        print(f"  limites até {corte} ({(treino.classe == 'APROVADO').sum()} aprovados) -> ensaios "
              f"{corte + 1}–{fim}: {n - len(erros)}/{n}" + (f"  erros: {erros}" if erros else ""))
    print(f"  acumulado: {certos}/{total}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corte", nargs="+", type=int, default=[],
                    help="Ensaios de corte para o teste com motores novos (ex: 24 33)")
    args = ap.parse_args()
    raw = pd.read_csv(RAW_PATH)
    mot = pd.read_csv(MOTORES_PATH, dtype=str).fillna("") if MOTORES_PATH.exists() else pd.DataFrame(columns=["ensaio", "classificacao"])
    mot["ensaio"] = pd.to_numeric(mot["ensaio"], errors="coerce")

    ind = indicadores(raw)
    cls = mot.dropna(subset=["ensaio"]).set_index(mot["ensaio"].dropna().astype(int))["classificacao"]
    ind["classificacao"] = cls.reindex(ind.index).fillna("")
    ind["classe"] = (ind.classificacao.str.upper()
                     .str.normalize("NFD").str.encode("ascii", "ignore").str.decode("ascii")
                     .str.replace(" ", "_"))

    n_ap = (ind.classe == "APROVADO").sum(); n_rp = (ind.classe == "REPROVADO").sum()
    print(f"[discriminantes] {len(ind)} ensaios · {n_ap} aprovados · {n_rp} reprovados")
    if n_ap < 3:
        raise SystemExit("[discriminantes] São necessários pelo menos 3 motores aprovados na aba MOTORES.")

    lim = limites(ind)
    print("\nComparação (média das 4 condições):")
    for k, nome in {**REGRA, **ATENCAO_BAIXO}.items():
        a = ind.loc[ind.classe == "APROVADO", k]; r = ind.loc[ind.classe == "REPROVADO", k]
        sinal = "<" if k in ATENCAO_BAIXO else ">"
        print(f"  {nome:48s} aprov {a.min():8.3f} a {a.max():8.3f} | reprov mediana {r.median():8.3f}"
              f" | limite {sinal} {lim[k]:.3f}")

    # validação deixando um de fora
    base = ind[ind.classe.isin(["APROVADO", "REPROVADO"])]
    if n_rp:
        acertos = 0
        for e in base.index:
            l = limites(base.drop(index=e))
            pred = "REPROVADO" if bandeiras(base.loc[e], l) else "APROVADO"
            acertos += pred == base.loc[e, "classe"]
        print(f"\nRegra (qualquer bandeira = reprovado), deixando um de fora: {acertos}/{len(base)} acertos")

    if args.corte:
        prospectivo(ind, sorted(args.corte))

    ind["bandeiras"] = [",".join(bandeiras(r, lim)) for _, r in ind.iterrows()]
    ind["corrente_baixa"] = ind["corrente_a"] < lim["corrente_a"]
    ind["indicacao"] = np.where(ind.bandeiras != "", "tende a reprovado", "perfil de aprovado")
    ind.drop(columns="classe").round(4).to_csv(OUT_CSV)
    OUT_LIM.write_text(json.dumps({"n_sigma": N_SIGMA, "limites": lim}, indent=2, ensure_ascii=False), encoding="utf-8")

    pend = ind[~ind.classe.isin(["APROVADO", "REPROVADO"])]
    if len(pend):
        print("\nSem decisão (em análise / sem classificação):")
        for e, r in pend.iterrows():
            extra = " + corrente baixa" if r.corrente_baixa else ""
            print(f"  ensaio {e:3d}: {r.indicacao}{extra}  [{r.bandeiras or '-'}]")
    print(f"\n-> {OUT_CSV}\n-> {OUT_LIM}")


if __name__ == "__main__":
    main()
