# App do técnico — leva app-campo 3

Três PRs: **A** faixa esperada nas medições (este), **B** relatório PDF e WhatsApp, **C** velocidade e uso com uma mão.

## Levantamento (antes de codar)

- **Checklist por tipo já existia:** 8 tipos padrão (Split, Piso-teto, Cassete, VRF, Chiller, Self, Fancoil, Câmara fria),
  editáveis em Configurações › Tipos de equipamento › Checklist, com itens de medição (número + unidade, sem avaliação).
  Faltavam a faixa esperada, o alerta, o superaquecimento e o ΔT.
- **Relatório da atividade já existia** (link público com token). Faltam medições com faixa, materiais, assinatura,
  PDF e o compartilhar no app (PR B).
- **Fluxo do equipamento já guiado** (fotos antes → TUDO OK → medições → fotos depois → concluir). A velocidade é medida
  antes de mexer (PR C).

Decisões do Zé: fora da faixa **só alerta** (não bloqueia, não exige observação; observação opcional em 1 toque, ao lado
do alerta), destacado na OS, no relatório e no painel do gestor; faixas sugeridas por **gás** (R-410A, R-32 e R-22);
corrente sem faixa padrão; **um checklist por tipo** valendo para PMOC e preventiva.

## Medição de base (para o PR C)

Roteiro Playwright "Cheguei → concluir" numa preventiva fictícia de **3 splits** (Split Hi-Wall padrão: TUDO OK, 2 fotos
pedidas, 6 medições, 1 foto antes e 1 depois por equipamento), no master, antes de qualquer mudança:

| Aparelho | Toques | Caracteres | Rolagens | Fotos | Tempo padrão | Espera do app |
|---|---|---|---|---|---|---|
| iPhone 13 | 64 | 54 | 21 | 12 | 142,5 s | 15,5 s |
| Pixel 7 | 64 | 54 | 26 | 12 | 146,5 s | 7,4 s |

- Tempo padrão = 1,2 s por toque + 0,35 s por caractere + 0,8 s por rolagem + 2,5 s por foto (o mesmo antes e depois).
- Foto pela câmera do sistema = 3 toques (abrir, disparar, confirmar "Usar foto"/✓).
- Rolagem = o próximo alvo estava fora da tela (descontando o topo e a barra de baixo).
- Meta do PR C: **≤ 44 toques e ≤ 100 s**. Arquivos: `docs/prints/tecnico-campo-leva3/medicao-antes-*.json`.

## PR A: faixa esperada e alerta nas medições

### No tipo de equipamento (escritório)

- Cada item de **medição** ganha **faixa esperada** (mínimo e/ou máximo, na unidade do item). Sem faixa, nada muda.
- **"Aplicar faixas sugeridas"**: escolhe o gás (R-410A, R-32, R-22), mostra a tabela "Hoje → Fica" e só aplica ao
  confirmar (depois é Salvar):
  - pressões de sucção e descarga por gás; superaquecimento 5–12 K, insuflamento 10–16 °C, ΔT do ar 8–14 °C, saída da
    água 5–9 °C e ΔT da água 4–7 °C para todos; corrente sem faixa (depende da placa);
  - acrescenta o que falta: **Superaquecimento** (onde há sucção e descarga) e **ΔT** (onde há insuflamento e retorno;
    na água, entrada e saída), logo depois das leituras de que dependem;
  - converte para a unidade do item (bar, kPa, kgf/cm², °F). Referências típicas: a empresa confere com o fabricante.
- A **grandeza** (o que a medição mede) dos itens antigos vem do texto ("Pressão de sucção" → sucção) e é gravada ao
  salvar. Nenhum SQL grava faixa: a empresa aplica na tela.

| Gás | Sucção | Descarga |
|---|---|---|
| R-410A | 115–140 psi | 300–420 psi |
| R-32 | 120–150 psi | 330–450 psi |
| R-22 | 58–75 psi | 200–280 psi |

### No app

- Embaixo da medição: "Esperado: 115–140 psi".
- Fora da faixa: alerta âmbar **enquanto digita** ("Abaixo do esperado (115–140 psi)"), com **Observação** ao lado
  (1 toque abre o campo, com ditado e áudio). Não bloqueia nada. O item que já pede observação usa o campo dele.
- **ΔT calculado**: só mostra (retorno − insuflamento), também sem sinal; o técnico não digita. Uma das leituras "Não se
  aplica": o ΔT também. O ΔT não entra no "Faltam N" (as leituras dele já entram).
- Unidade trocada na hora (bar, °F): a faixa acompanha; unidade sem conversão: sem alerta (melhor calar do que errar).

### No servidor

- A resposta guarda a **faixa do momento**, já na unidade da resposta, e se ficou **fora** (o relatório antigo continua
  fiel se a faixa mudar depois). Vale para o app e para a execução pelo escritório.
- O **ΔT é calculado no servidor** quando insuflamento ou retorno mudam (o escritório recebe o novo na hora). Ninguém
  digita o ΔT (400); a observação dele é livre.

### Destaques

- **OS › Relatórios & Anexos**: o cartão da atividade mostra "1 medição fora do esperado".
- **Execução pelo escritório**: o mesmo alerta embaixo da medição; ΔT "calculado".
- **Relatório** (interno e do cliente): a medição fora sai em âmbar com "Fora do esperado: 115–140 psi"; a dentro mostra
  "Esperado"; o equipamento ganha o selo "1 fora do esperado".
- **Painel do gestor** (Dashboard › Equipamentos): card "Fora do esperado" (equipamentos com medição fora nos últimos
  30 dias; só equipamento ativo) e as 3 leituras mais recentes, cada uma com link para a OS.

### 🔵 Banco (PR A) — seis colunas e um índice, aditivos

**SQL gerado e NÃO aplicado:** `prisma/sql/2027-02-05_checklist_faixas.sql`.

- `checklist_tipo_itens`: `grandeza`, `valor_min`, `valor_max` (opcionais);
- `checklist_respostas`: `faixa_min`, `faixa_max` (opcionais) e `fora_da_faixa` (padrão falso), com o índice
  (empresa, fora da faixa, quando) do painel.
- Não grava dados. Rodar ANTES do merge:
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-05_checklist_faixas.sql`

### Mudanças fora do app do técnico

| Arquivo | Por quê |
|---|---|
| `components/cadastros/editores/checklist-tipo.tsx`, `app/api/tipos-equipamento/[id]/checklist`, `lib/checklist/tipo.ts` | Faixa por item e "Aplicar faixas sugeridas" |
| `components/os/execucao-equipamento.tsx`, `components/os/atividade-execucao.tsx` | Alerta e ΔT na execução pelo escritório |
| `components/os/os-relatorios.tsx`, `app/api/ordens/[id]/relatorios` | Contagem no cartão da atividade |
| `lib/relatorio-os/dados.ts`, `components/relatorio/relatorio-os-documento.tsx` | Faixa e destaque no relatório |
| `lib/dashboard/dados.ts`, `components/dashboard/blocos.tsx` | Card do painel |
| `lib/execucao/*`, `prisma/schema.prisma` | Gravação da faixa, ΔT no servidor, colunas |

### Testes (PR A)

- `app-campo-leva3-faixas` (22, regra pura), `app-campo-leva3-faixas-ui` (7, tela: app e escritório),
  `app-campo-leva3-faixas-pg` (11, PostgreSQL real), `sql-checklist-faixas` (4, o SQL rodado 2× e comparado com o Prisma).
- **3 testes antigos atualizados de propósito** (`execucao-os-regras`): o plano de gravação de um item de medição agora
  leva a grandeza e a faixa (vazias). Os campos novos só aparecem onde fazem sentido: o relatório sem faixa e o item
  OK/Atenção continuam iguais.
- **Mutação: 57 mutantes, 57 mortos.** Na 1ª rodada sobraram 5, e cada um virou prova:
  - "Não se aplica" não guarda faixa na resposta;
  - desfazer o "Não se aplica" de uma leitura refaz o ΔT (fica vazio);
  - no aparelho, um ΔT "digitado" sem as leituras não marca o equipamento como atendido;
  - o item que já pede observação nunca ganha um segundo campo;
  - o painel conta equipamentos (duas leituras fora no mesmo equipamento = 1).

### Prints (PR A)

`docs/prints/tecnico-campo-leva3/`: `antes-01…05` (app: equipamento, medições, conclusão; iPhone 13, Pixel 7, desktop),
`antes-10…13` (escritório: checklist do tipo, OS, relatório, painel); `depois-10…16` (escritório: faixas sugeridas
R-22 e R-410A, tipo com faixas, OS, execução, relatório, painel) e `depois-20…23` (app: esperado, fora do esperado,
observação em 1 toque, ΔT calculado; nos 3 aparelhos). Dados e fotos fictícios.
