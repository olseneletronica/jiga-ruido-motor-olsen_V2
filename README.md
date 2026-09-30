# Jiga Ruído Motor V2 — Olsen

Análise dos ensaios da jiga de motores (Bosch) — versão 2. Classifica
motores a partir de corrente, tensão, potência, vibração (acelerômetro 3
eixos), giroscópio (3 eixos) e áudio (2 microfones), agora com **dois
sentidos de rotação** por ensaio.

Este repositório cobre **front-end (dashboard) e análise de dados**. Firmware
do ESP32 e Apps Script da planilha ficam fora do escopo por enquanto.

## O que mudou em relação ao V1

| | V1 | V2 |
|---|---|---|
| Frequências | varredura com várias frequências | só **15 kHz** e **20 kHz** |
| Sentido de rotação | só um | **horário (H)** e **anti-horário (AH)** no mesmo ensaio |
| Unidade de análise | ensaio × frequência | ensaio × **sentido** × frequência (4 condições por motor) |
| Exportação da planilha | CSV | **TSV** |
| Dashboard | ensaio individual, comparar | + aba **Horário × Anti-horário**, + **Visão geral**, timestamp do ensaio em todo lugar |

## Fonte de dados

- Planilha: https://docs.google.com/spreadsheets/d/1EoOMY2sz4lsfE4Ih1M0O-X2gurAkqWX6_AQtDyLDPfQ/edit?gid=1681403093
- **Leitura ao vivo da aba `DADOS`** (onde o ESP32 grava), selecionada pelo
  **nome** da aba. Exige o compartilhamento "Qualquer pessoa com o link: Leitor":
  `https://docs.google.com/spreadsheets/d/1EoOMY2sz4lsfE4Ih1M0O-X2gurAkqWX6_AQtDyLDPfQ/gviz/tq?tqx=out:csv&sheet=DADOS&headers=1`

> Não use links com `gid=`: se a aba for recriada, o gid muda e o link
> passa a ler uma aba parada. Foi o que aconteceu com o `gid=1681403093`.

O botão **⟳ Atualizar dados** busca a planilha de novo sem recarregar a
página (mantém aba, ensaio e seleção) e mostra a hora da última leitura.

Cada linha é uma leitura (1 por segundo). Roteiro esperado de cada ensaio:
**15 kHz H → 15 kHz AH → 20 kHz H → 20 kHz AH** (a ordem não é obrigatória;
o que importa é ter as 4 condições).

### Aba MOTORES — qual motor foi testado em cada ensaio

Aba **`MOTORES`** na mesma planilha, com o cabeçalho na linha 1:

| ensaio | motor | observacao | classificacao | atualizado_em |
|---|---|---|---|---|
| 1 | BOSCH-0451 | Lote 2026-09 | Aprovado | 29/09/2026 15:20:00 |

- `classificacao`: `Aprovado`, `Reprovado`, `Em análise` ou vazio. É a
  classificação **manual** (de quem inspecionou o motor), separada da
  análise automática do pipeline Python.
- `atualizado_em`: preenchido sozinho quando o cadastro é feito pelo dashboard.

Pode ser preenchida direto na planilha **ou** pelo formulário
**"✎ Cadastrar / editar motor"** na aba Ensaio individual do dashboard.

### Formulário de cadastro no dashboard (Apps Script)

O dashboard é uma página estática e não consegue gravar sozinho na
planilha. Quem grava é um pequeno Apps Script (`apps-script/cadastro_motores.gs`),
num projeto **separado** do script que recebe os dados do ESP32.

Configuração, uma vez só:

1. Acesse https://script.google.com → **Novo projeto**. Apague o conteúdo e
   cole o de `apps-script/cadastro_motores.gs`. Salve (nome sugerido:
   "Cadastro motores - Jiga V2").
2. **Configurações do projeto** (engrenagem) → **Propriedades do script** →
   **Adicionar propriedade**: nome `TOKEN`, valor = a senha de cadastro que
   você escolher.
3. **Implantar → Nova implantação** → tipo **App da Web**.
   Executar como: **Eu**. Quem pode acessar: **Qualquer pessoa**.
   Autorize o acesso à planilha quando pedido.
4. Copie a URL do app da Web (termina em `/exec`) e cole em
   `CONFIG.MOTORES_WRITE_URL` no `dashboard/app.js`. Faça commit/push.

A senha **não** fica no repositório (que é público): quem cadastra digita
no formulário; há a opção de lembrar a senha só naquele navegador. Sem a
senha certa, o script recusa a gravação.

Ao alterar o `.gs` depois, use **Implantar → Gerenciar implantações →
editar (lápis) → Versão: Nova versão → Implantar**, para manter a mesma URL.

O mesmo script também **lê** a aba MOTORES para o dashboard
(`.../exec?acao=listar`), devolvendo o texto exato das células. A leitura
pelo `gviz` fica só de reserva, porque o gviz apaga valores quando uma
coluna mistura números e textos (ex: motor `5` e motor `BOSCH-0451`).

### Dicionário de colunas

| Coluna | Descrição |
|---|---|
| `timestamp` | Data/hora da leitura, `dd/mm/aaaa hh:mm:ss` |
| `firmware` | Versão do firmware da jiga |
| `ensaio` | Identificador do teste (mesmo motor = mesmo número) |
| `sentido` | Sentido de rotação. Aceita `horario`/`H`/`CW` e `anti-horario`/`AH`/`CCW` (com ou sem acento, maiúsculas ou minúsculas) |
| `frequencia_hz` | Frequência de chaveamento: `15000` ou `20000` |
| `segundo` | Segundo decorrido dentro da condição |
| `tensao_v`, `corrente_a`, `potencia_w` | Grandezas elétricas |
| `accel_x/y/z_g`, `accel_resultante_g` | Acelerômetro (vibração) |
| `gyro_x/y/z_dps` | Giroscópio |
| `audio1_dbfs`, `audio1_peak_dbfs` | Microfone 1 — nível médio e pico (dBFS) |
| `audio2_dbfs`, `audio2_peak_dbfs` | Microfone 2 — nível médio e pico (dBFS) |

Números com vírgula decimal (locale BR) são convertidos automaticamente.

> **Pendente de definição com o firmware:** o texto exato gravado em
> `sentido`. Se o firmware usar outra grafia, basta incluí-la em
> `normaliza_sentido()` (`scripts/config.py`) e `normalizaSentido()`
> (`dashboard/app.js`).

## Estrutura

```
index.html                 redireciona para dashboard/ (GitHub Pages na raiz)
dashboard/
  index.html               página
  app.js                   lógica e gráficos (Chart.js + PapaParse)
  styles.css               tema escuro (padrão) e claro
  assets/olsen-logo.png
apps-script/
  cadastro_motores.gs      grava o cadastro do motor na aba MOTORES (formulário do dashboard)
  receber_dados_esp32.gs   SÓ REGISTRO: cópia do script vinculado à planilha que recebe o ESP32 (aba DADOS)
scripts/
  config.py                colunas, frequências, limites — fonte única de configuração
  fetch_sheet.py           baixa a planilha (TSV) -> data/raw_ensaios.csv
  features.py              resumo por condição e por ensaio
  sentido.py               comparação horário × anti-horário
  baseline.py              referência de motor bom por condição
  classify.py              status por ensaio (OK / ATENCAO / FALHA_PROVAVEL)
  gerar_dados_exemplo.py   dados sintéticos para demonstração
  run_pipeline.py          roda tudo em sequência
data/
  exemplo/raw_exemplo.tsv  dados sintéticos (mesmo formato da planilha)
```

## Dashboard

Publicado pelo GitHub Pages servindo a **raiz** do repositório
(Settings → Pages → Branch `main`, pasta `/ (root)`). O endereço fica
`https://olseneletronica.github.io/jiga-ruido-motor-olsen_V2/`.

Lê a planilha publicada direto do navegador — não depende do pipeline
Python. Abas:

1. **Ensaio individual** — seletor com número **e data/hora** do ensaio;
   cartões com início, fim, duração, firmware, leituras e condições
   completas; tabela-resumo por condição (com o horário de início de cada
   uma); gráficos de todos os pontos coletados (cor = frequência,
   traço contínuo = horário, tracejado = anti-horário).
2. **Horário × Anti-horário** — diferença AH − H por canal nas duas
   frequências, com o limite configurado; tabela de valores; mapa de calor
   com todos os ensaios.
3. **Comparar ensaios** — até 8 ensaios lado a lado numa condição
   (frequência + sentido, ou os dois sentidos). Filtro por **classificação**
   da aba MOTORES: Todos (padrão, inclui os não classificados), Aprovados,
   Reprovados e Em análise, com a contagem de cada um. Ao trocar o filtro,
   os ensaios daquela classificação já vêm marcados (até 8, os mais recentes).
4. **Visão geral** — tabela de todos os ensaios (início, fim, duração,
   classificação, resultado de sentido) e média de cada grandeza por
   ensaio/condição.

**Modo demonstração:** `dashboard/?fonte=exemplo` usa
`data/exemplo/raw_exemplo.tsv` (6 motores sintéticos: 1–4 bons, 5 com
vibração/ruído maiores só no anti-horário a 20 kHz, 6 com falha geral). Se a
planilha ainda estiver vazia, o dashboard oferece esse link.

Para testar localmente (o `fetch` não funciona abrindo o arquivo direto):

```bash
python -m http.server 8000
# abrir http://localhost:8000/dashboard/?fonte=exemplo
```

## Pipeline Python

```bash
pip install -r requirements.txt

# Tudo de uma vez (planilha real). --good = ensaios confirmados como motor bom
python scripts/run_pipeline.py --good 1 2 3

# Com dados de exemplo
python scripts/run_pipeline.py --exemplo --good 1 2 3 4
```

Passo a passo equivalente:

```bash
python scripts/fetch_sheet.py            # data/raw_ensaios.csv
python scripts/features.py               # data/features_por_condicao.csv, features_por_ensaio.csv
python scripts/sentido.py                # data/assimetria_sentido.csv
python scripts/baseline.py --good 1 2 3  # data/baseline.json
python scripts/classify.py               # data/classificacao.csv
```

Depois de gerar `data/classificacao.csv`, faça commit/push — o dashboard
mostra a classificação ao lado de cada ensaio.

## Como funciona a análise

### 1. Comparação horário × anti-horário (não precisa de baseline)

Cada motor é comparado com ele mesmo, em cada frequência:

| Canal | Estatística comparada | Diferença | Limite inicial |
|---|---|---|---|
| Tensão, corrente, potência | média | % relativa | 10 % |
| Vibração X/Y/Z/resultante, giroscópio X/Y/Z | desvio-padrão no bloco | % relativa | 40 % |
| Áudio 1/2 (médio e pico) | média | dB (AH − H) | 3 dB |

Vibração e giroscópio usam o desvio-padrão porque a média do acelerômetro
carrega a gravidade e mascara a vibração real. O limite do desvio-padrão é
mais largo porque essa estatística oscila mais com ~30 leituras.

Um ensaio recebe **assimetria de sentido = SIM** quando pelo menos **3
canais** passam do limite **na mesma frequência** — um canal isolado
costuma ser ruído de medição.

### 2. Classificação contra motores bons

`baseline.py` calcula média e desvio-padrão de corrente, potência, vibração
e áudio de pico de cada **condição** (H/AH × 15/20 kHz) nos ensaios
informados em `--good`. `classify.py` mede o z-score de cada condição de
cada ensaio e resume:

- `OK` — nenhuma condição suspeita (z > 3 em algum canal)
- `ATENCAO` — até 30 % das condições suspeitas
- `FALHA_PROVAVEL` — mais de 30 % das condições suspeitas

`classificacao.csv` também traz `condicao_pior`, `canal_pior` e o
resultado da comparação de sentidos.

### Parâmetros a calibrar com dados reais

| Onde | Parâmetro |
|---|---|
| `scripts/config.py` + `dashboard/app.js` (CONFIG) | `LIMITE_ASSIMETRIA_REL_PCT`, `LIMITE_ASSIMETRIA_DB`, `MIN_CANAIS_ASSIMETRIA` |
| `scripts/classify.py` | `Z_THRESHOLD`, `FALHA_FRACAO` |

Sugestão: depois dos primeiros motores bons confirmados, rodar
`sentido.py` e olhar a distribuição de `delta` em `assimetria_sentido.csv`
para ajustar os limites ao ruído real da jiga.

## Próximos passos

- Definir com o firmware a grafia do campo `sentido`.
- Confirmar os primeiros ensaios de motor bom para o baseline.
- Calibrar limites com dados reais.
- Com motores com falha confirmada, avaliar classificador supervisionado
  sobre `features_por_condicao.csv`.
