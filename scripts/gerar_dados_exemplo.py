"""
gerar_dados_exemplo.py — gera um TSV sintético no MESMO formato da planilha
V2 (tabulação, vírgula decimal, dd/mm/aaaa hh:mm:ss) para testar o pipeline
e o dashboard antes de existirem ensaios reais.

Roteiro simulado por ensaio: 15 kHz H -> 15 kHz AH -> 20 kHz H -> 20 kHz AH,
30 leituras (1/s) em cada bloco.

Motores simulados:
    1–4  saudáveis
    5    saudável em horário, mas vibração/ruído maiores em anti-horário a 20 kHz
    6    com falha: corrente e vibração acima do normal nas 4 condições

Uso:
    python scripts/gerar_dados_exemplo.py
"""
from datetime import datetime, timedelta

import numpy as np

from config import EXEMPLO_DIR, EXEMPLO_TSV, EXPECTED_COLUMNS

BLOCOS = [("horario", 15000), ("anti-horario", 15000), ("horario", 20000), ("anti-horario", 20000)]
N_LEITURAS = 30


def br(x: float, casas: int) -> str:
    return f"{x:.{casas}f}".replace(".", ",")


def gerar():
    rng = np.random.default_rng(42)
    linhas = []
    inicio_base = datetime(2026, 9, 29, 8, 30, 0)
    for ensaio in range(1, 7):
        t = inicio_base + timedelta(days=(ensaio - 1) // 3, hours=(ensaio - 1) % 3 * 2,
                                    minutes=int(rng.integers(0, 40)))
        ganho_motor = rng.normal(1.0, 0.03) if ensaio != 5 else 1.0
        for sentido, freq in BLOCOS:
            corr_base = (0.95 if freq == 15000 else 0.88) * ganho_motor
            vib = 0.025 if freq == 15000 else 0.030
            audio = -24.0 if freq == 15000 else -22.5
            if sentido == "anti-horario":
                corr_base *= 1.02  # pequena diferença natural entre sentidos
            if ensaio == 5 and sentido == "anti-horario" and freq == 20000:
                vib *= 2.2
                audio += 5.0
            if ensaio == 6:
                corr_base *= 1.25
                vib *= 2.6
                audio += 4.0
            for s in range(1, N_LEITURAS + 1):
                partida = 1 - np.exp(-s / 3)  # rampa de partida do motor
                v = 32.0 - 0.6 * partida + rng.normal(0, 0.05)
                i = corr_base * (0.6 + 0.4 * partida) + rng.normal(0, 0.015)
                ax = rng.normal(0.97, vib); ay = rng.normal(0.25, vib); az = rng.normal(0.27, vib)
                res = float(np.sqrt(ax**2 + ay**2 + az**2))
                gx, gy, gz = (rng.normal(m, vib * 40) for m in (2.9, 0.6, 0.25))
                a1 = audio + rng.normal(0, 0.6)
                a2 = audio - 0.8 + rng.normal(0, 0.6)
                linhas.append([
                    t.strftime("%d/%m/%Y %H:%M:%S"), "V2.00", str(ensaio), sentido, str(freq), str(s),
                    br(v, 3), br(i, 3), br(v * i, 3),
                    br(ax, 4), br(ay, 4), br(az, 4), br(res, 4),
                    br(gx, 3), br(gy, 3), br(gz, 3),
                    br(a1, 2), br(a1 + 11 + rng.normal(0, 0.8), 2),
                    br(a2, 2), br(a2 + 11 + rng.normal(0, 0.8), 2),
                ])
                t += timedelta(seconds=1)
            t += timedelta(seconds=5)  # pausa para trocar de condição
    return linhas


def main():
    EXEMPLO_DIR.mkdir(parents=True, exist_ok=True)
    linhas = gerar()
    with open(EXEMPLO_TSV, "w", encoding="utf-8", newline="\n") as f:
        f.write("\t".join(EXPECTED_COLUMNS) + "\n")
        for l in linhas:
            f.write("\t".join(l) + "\n")
    print(f"[exemplo] {len(linhas)} linhas -> {EXEMPLO_TSV}")


if __name__ == "__main__":
    main()
