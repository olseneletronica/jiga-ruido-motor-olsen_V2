"""
sentido.py — compara horário × anti-horário dentro de cada ensaio.

Para cada ensaio e frequência, mede a diferença entre os dois sentidos em
cada canal (ver ASSIMETRIA_CANAIS em config.py). Um canal é marcado como
assimétrico quando passa do limite configurado. Não precisa de baseline:
cada motor é comparado com ele mesmo.

Uso:
    python scripts/sentido.py
Gera:
    data/assimetria_sentido.csv  (formato longo: ensaio, frequência, canal)
"""
import numpy as np
import pandas as pd

from config import (
    ASSIMETRIA_CANAIS, LIMITE_ASSIMETRIA_DB, LIMITE_ASSIMETRIA_REL_PCT,
    MIN_CANAIS_ASSIMETRIA,
    POINT_PATH, SENTIDO_PATH,
)


def calcula_assimetria(cond_df: pd.DataFrame) -> pd.DataFrame:
    linhas = []
    for (ensaio, freq), grp in cond_df.groupby(["ensaio", "frequencia_hz"]):
        por_sentido = grp.set_index("sentido")
        if not {"H", "AH"} <= set(por_sentido.index):
            continue  # falta um dos sentidos nesta frequência
        for canal, estat, modo in ASSIMETRIA_CANAIS:
            col = f"{canal}_{estat}"
            h = float(por_sentido.loc["H", col])
            ah = float(por_sentido.loc["AH", col])
            if modo == "db":
                delta = ah - h
                limite = LIMITE_ASSIMETRIA_DB
                unidade = "dB"
            else:
                ref = (abs(h) + abs(ah)) / 2
                delta = (ah - h) / ref * 100 if ref > 1e-12 else np.nan
                limite = LIMITE_ASSIMETRIA_REL_PCT[estat]
                unidade = "%"
            linhas.append({
                "ensaio": ensaio,
                "frequencia_hz": freq,
                "canal": canal,
                "estatistica": estat,
                "valor_h": h,
                "valor_ah": ah,
                "delta": delta,
                "unidade": unidade,
                "limite": limite,
                "assimetrico": bool(abs(delta) > limite) if pd.notna(delta) else False,
            })
    return pd.DataFrame(linhas)


def resumo_por_ensaio(assim: pd.DataFrame) -> pd.DataFrame:
    """Por ensaio: maior nº de canais assimétricos numa mesma frequência,
    em qual frequência, e se isso configura assimetria de sentido."""
    por_freq = (assim.groupby(["ensaio", "frequencia_hz"])["assimetrico"].sum()
                     .astype(int).reset_index(name="n"))
    idx = por_freq.groupby("ensaio")["n"].idxmax()
    r = por_freq.loc[idx].rename(columns={"n": "canais_assimetricos",
                                          "frequencia_hz": "freq_assimetria_hz"})
    r["assimetria_sentido"] = (r["canais_assimetricos"] >= MIN_CANAIS_ASSIMETRIA).map({True: "SIM", False: "NAO"})
    return r.reset_index(drop=True)


def main():
    cond_df = pd.read_csv(POINT_PATH)
    out = calcula_assimetria(cond_df)
    out.to_csv(SENTIDO_PATH, index=False)
    if out.empty:
        print("[sentido] Nenhum ensaio com os dois sentidos na mesma frequência.")
        return
    resumo = resumo_por_ensaio(out)
    print(f"[sentido] {len(out)} comparações -> {SENTIDO_PATH}")
    print(resumo.to_string(index=False))


if __name__ == "__main__":
    main()
