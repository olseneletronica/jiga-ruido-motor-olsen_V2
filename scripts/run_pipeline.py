"""
run_pipeline.py — roda o pipeline completo em sequência.

Uso:
    python scripts/run_pipeline.py --good 1 2 3            # planilha real
    python scripts/run_pipeline.py --good 1 2 3 --exemplo  # dados sintéticos

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
    a = p.parse_args()

    if a.exemplo:
        run("gerar_dados_exemplo.py")
    run("fetch_sheet.py", *(["--exemplo"] if a.exemplo else []))
    run("features.py")
    run("sentido.py")
    if a.good:
        run("baseline.py", "--good", *a.good)
        run("classify.py")
    else:
        print("\n(sem --good: baseline/classify não foram executados)")


if __name__ == "__main__":
    main()
