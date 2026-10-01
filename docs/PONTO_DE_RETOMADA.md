# Ponto de retomada — 01/10/2026

Estado consolidado do V2 ao fim da campanha de ensaios de 30/09 e 01/10/2026.
Marcado no git com a tag **`v2.0-consolidado`**. Para voltar a este ponto:

```bash
git checkout v2.0-consolidado          # só olhar
git switch -c retomada v2.0-consolidado  # continuar a partir daqui num branch
```

## O que está pronto

| Parte | Estado |
|---|---|
| Dashboard (GitHub Pages) | 4 abas, cadastro do motor, filtro por classificação, indicação automática ao vivo, rodapé com hora/versão. Versão **2026.10.01-2**. |
| Leitura da planilha | DADOS pelo nome da aba (gviz); MOTORES pelo Apps Script `?acao=listar` (gviz de reserva). |
| Cadastro | `apps-script/cadastro_motores.gs`, projeto separado, senha em Propriedades do script (`TOKEN`). |
| Pipeline Python | `run_pipeline.py`; roda da planilha ou de exportações (`--dados/--motores`). |
| Análise bom × ruim | `discriminantes.py`; teste com motores novos (`--corte`). |
| Campanha congelada | `data/campanha_2026-10-01/` (52 ensaios) + `dashboard/?fonte=campanha_2026-10-01`. |
| Relatório final | `docs/relatorio_criterios_2026-10-01.html`. |

Fora do escopo do V2: firmware do ESP32 (V0.04, sem alteração) e o script
vinculado à planilha (cópia de registro em `apps-script/receber_dados_esp32.gs`).

## Resultado da campanha

52 ensaios (11 aprovados, 28 reprovados, 13 em análise), firmware V0.04.

Regra: um motor **tende a reprovado** se qualquer indicador (média das 4
condições) passar do limite = média + 3σ dos aprovados.

| Indicador | Aprovados | Limite |
|---|---|---|
| Nível de áudio (média dos 2 mics) | −26,5 a −25,7 dBFS | > −25,45 dBFS |
| Instabilidade do áudio | 0,18 a 0,53 dB | > 0,59 dB |
| Vibração dinâmica | 0,019 a 0,085 g | > 0,122 g |
| Vibração lateral Y | 0,016 a 0,046 g | > 0,063 g |
| Corrente (só atenção) | 0,86 a 1,19 A | < 0,66 A |

- Motores novos (limites congelados nos ensaios 24 e 33): **17/21**, nenhum
  aprovado reprovado.
- Deixando um de fora: **33/39** (23 dos 28 reprovados).
- Não detectados: **6, 27, 38, 41, 52**. Nenhuma de 260 características os
  separa dos aprovados; ML (regressão logística, random forest, SVM) acerta
  menos que a regra (29–32/39). Limitação dos sensores, não do modelo.

Valores exatos: `data/campanha_2026-10-01/limites_congelados.json`.
Reproduzir:

```bash
python scripts/run_pipeline.py --dados data/campanha_2026-10-01/dados.tsv \
    --motores data/campanha_2026-10-01/motores.tsv
python scripts/discriminantes.py --corte 24 33
```

## Problemas conhecidos

- 190 leituras (4,6%) com o IMU inteiro zerado, em 49 dos 52 ensaios — tratadas
  como ausentes. Causa provável no firmware.
- Ensaio 31 com duas condições incompletas; algumas leituras chegam fora de
  ordem ou se perdem.
- Só 11 aprovados definem a faixa normal: limites ainda podem se mover.
- Nível em dBFS depende do ganho/posição dos microfones e do ambiente: os
  limites valem para a montagem atual da jiga.

## Próximo passo combinado: veredito no dashboard

Decidido em 01/10: o veredito fica **no dashboard** (sem mexer no firmware por
enquanto), dentro deste mesmo repositório.

Por que no V2 e não um V3: firmware, colunas da planilha, Apps Script e
endereço do Pages continuam os mesmos — um V3 duplicaria tudo isso sem ganho.
Esta tag é o ponto de volta. Um V3 faz sentido quando o firmware mudar as
colunas (ex.: áudio por faixas de frequência).

Escopo previsto:

1. Página/aba **"Testar motor"**: escolhe o ensaio (padrão: o mais recente) e
   mostra o veredito grande — APROVADO / REVISAR / REPROVADO — com o indicador
   que pesou.
2. **Limites congelados e versionados** (`limites_congelados.json`), em vez
   de reaprendidos a cada carga, para o veredito não mudar sozinho quando
   alguém classificar um motor. Recalcular é um passo explícito.
3. Faixa **REVISAR** perto do limite (ex.: 90–100%).
4. **Checagem do ensaio** antes do veredito: 4 condições completas, poucas
   leituras de IMU zeradas; senão, "repetir ensaio".
5. **Motor de referência** por turno para detectar deriva da jiga.
6. Período em paralelo com a inspeção antes de confiar no automático.

Depois (fora do escopo atual): firmware com áudio por faixas de frequência
para tentar pegar os defeitos hoje invisíveis; corrigir as leituras zeradas
do IMU.
