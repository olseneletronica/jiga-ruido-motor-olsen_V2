# Contexto do projeto — Jiga Ruído Motor V2 (Olsen)

Sucessor de `olseneletronica/jiga-ruido-motor-olsen` (V1). Mesmo padrão:
dashboard estático (GitHub Pages, Chart.js + PapaParse, sem build step) lendo
Google Sheets publicado, e pipeline Python para classificação.

- Escopo deste repo: front-end e análise de dados. Firmware ESP32 e Apps
  Script estão fora por enquanto.
- Ensaio V2 = 4 condições: {15 kHz, 20 kHz} × {horário "H", anti-horário "AH"}.
  A chave de condição é `"{sentido}_{frequencia_hz}"` (ex: `AH_20000`).
- Fonte de dados: leitura ao vivo via `gviz/tq?tqx=out:csv` (CSV com aspas), com a
  cópia "Publicar na Web" em TSV como fallback. Vírgula decimal (locale BR).
- `scripts/config.py` é a fonte única de colunas, frequências e limites.
  O bloco `CONFIG` e `METRICS` em `dashboard/app.js` espelham esses valores —
  ao mudar um, mudar o outro.
- `normaliza_sentido()` (Python) e `normalizaSentido()` (JS) devem aceitar as
  mesmas grafias.
- Vibração e giroscópio são comparados pelo desvio-padrão (a média do
  acelerômetro contém a gravidade).
- Classificação é estatística (z-score contra motores bons), sem rótulos de
  falha confirmados ainda.
- `dashboard/?fonte=exemplo` usa `data/exemplo/raw_exemplo.tsv`
  (gerado por `scripts/gerar_dados_exemplo.py`).
- GitHub Pages serve a raiz do repo; `index.html` da raiz redireciona para
  `dashboard/`. O dashboard lê `../data/classificacao.csv` (opcional).
- Repo público (plano Free do GitHub — privado quebraria o Pages).
