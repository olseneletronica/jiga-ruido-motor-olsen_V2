# Contexto do projeto — Jiga Ruído Motor V2 (Olsen)

Sucessor de `olseneletronica/jiga-ruido-motor-olsen` (V1). Mesmo padrão:
dashboard estático (GitHub Pages, Chart.js + PapaParse, sem build step) lendo
Google Sheets publicado, e pipeline Python para classificação.

- Escopo deste repo: front-end e análise de dados. Firmware ESP32 e Apps
  Script estão fora por enquanto.
- Ensaio V2 = 4 condições: {15 kHz, 20 kHz} × {horário "H", anti-horário "AH"}.
  A chave de condição é `"{sentido}_{frequencia_hz}"` (ex: `AH_20000`).
- Fonte de dados: leitura ao vivo da aba DADOS via `gviz/tq?tqx=out:csv&sheet=DADOS`
  (pelo NOME, nunca por gid — o gid 1681403093 é uma aba parada). Sem fallback
  para "Publicar na Web": ele apontava para a aba errada. Vírgula decimal.
- MOTORES é lida pelo Apps Script (`?acao=listar`, getDisplayValues); gviz só
  de reserva (gviz apaga valores de tipos misturados na mesma coluna).
- "Atualizar dados" recarrega os dados sem recarregar a página (`atualizarDados()`).
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
- Aba `MOTORES` da planilha (ensaio | motor | observacao) liga o nº do ensaio ao
  motor. Lida via gviz `sheet=MOTORES`; só é aceita se tiver a coluna `motor`
  (sem a aba, o Google devolve a primeira aba).
- Colunas da aba MOTORES: ensaio | motor | observacao | classificacao
  (manual: Aprovado / Reprovado / Em análise) | atualizado_em.
- O formulário do dashboard grava via Apps Script separado
  (`apps-script/cadastro_motores.gs`, app da Web). URL em
  `CONFIG.MOTORES_WRITE_URL`; senha em Propriedades do script (`TOKEN`),
  nunca no repositório. POST com `text/plain` para evitar preflight de CORS.
- `apps-script/receber_dados_esp32.gs` é só uma cópia de registro do script
  vinculado à planilha (recebe o ESP32, grava na aba DADOS, `sentido` =
  HORARIO/ANTIHORARIO, 20 s por etapa). O original vive na planilha.
- Cache: GitHub Pages manda cache de ~10 min. `index.html` carrega
  `app.js?v=…`/`styles.css?v=…`; a constante `VERSAO` no app.js aparece no rodapé
  (`#dataStamp`), junto com a hora da leitura. Ao publicar, incrementar os três juntos.
- Aba Comparar: filtro `cmpClasse` (TODOS/APROVADO/REPROVADO/EM_ANALISE) usa
  `classeKey(motores[id].classe)`; seleção guardada em `cmpSel` (Set), gráficos
  usam marcados ∩ visíveis (`cmpAtivos()`).
- Carregamento (`carregar()`): a página aparece assim que a aba DADOS chega;
  MOTORES (Apps Script, pode demorar "acordando") entra depois via
  `aplicarMotores()`. Tempos-limite: DADOS 30 s, Apps Script 12 s (cai no
  gviz), gviz MOTORES 15 s. Cliques durante uma carga são ignorados.
