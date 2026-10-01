"""
run_pipeline.py — roda o pipeline completo em sequência.

Uso:
    python scripts/run_pipeline.py --good 1 2 3            # planilha real
    python scripts/run_pipeline.py --good 1 2 3 --exemplo  # dados sintéticos
    python scripts/run_pipeline.py --dados data/campanha_2026-10-01/dados.tsv \
        --motores data/campanha_2026-10-01/motores.tsv    # exportação congelada

Sem --good, roda só fetch + features + sentido (não precisa de baseline).
"""
import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(script: str, *args: str):
    print(f"\n=== {script} {' '.join(args)}")
    subprocess.run([sys.executable, str(HERE / script), *args], check=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--good", nargs="+", type=str, help="Ensaios confirmados como motor bom")
    p.add_argument("--exemplo", action="store_true", help="Usa os dados sintéticos de exemplo")
    p.add_argument("--dados", help="Exportação da aba DADOS (.tsv/.csv) em vez da planilha")
    p.add_argument("--motores", help="Exportação da aba MOTORES (.tsv/.csv), junto com --dados")
    a = p.parse_args()

    if a.exemplo:
        run("gerar_dados_exemplo.py")
        run("fetch_sheet.py", "--exemplo")
    elif a.dados:
        run("fetch_sheet.py", "--dados", a.dados, *(["--motores", a.motores] if a.motores else []))
    else:
        run("fetch_sheet.py")
    run("features.py")
    run("sentido.py")
    run("discriminantes.py")
    if a.good:
        run("baseline.py", "--good", *a.good)
        run("classify.py")
    else:
        print("\n(sem --good: baseline/classify não foram executados)")


if __name__ == "__main__":
    main()
