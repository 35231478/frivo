# App do técnico — leva app-campo 3

Três PRs: **A** faixa esperada nas medições, **B** relatório PDF e WhatsApp, **C** velocidade e uso com uma mão.

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

## PR B: relatório da atividade em PDF e envio ao cliente pelo WhatsApp

### No app

- Atividade concluída: **"Enviar relatório pelo WhatsApp"** (1 toque). Abre o WhatsApp com a mensagem pronta
  ("Olá! Segue o relatório da visita técnica da Polar Climatização (OS-1301): <link>") para o número do cliente
  (o mesmo do aviso "a caminho"; sem número, o WhatsApp abre para escolher o contato). A mensagem não leva o nome
  do cliente.
- **Um botão principal por vez:** com a confirmação do cliente pendente, ela é a principal e o WhatsApp fica com
  contorno; depois da assinatura (mesmo ainda na fila do aparelho), o WhatsApp vira o principal — e o relatório
  já sai com a assinatura.
- **Espera a sincronização:** com qualquer gravação desta OS ainda no aparelho, o botão vira "Relatório sai quando
  sincronizar" (desligado) e o PDF some; o cliente nunca abre um relatório incompleto. Voltou o sinal, o botão
  aparece sozinho.
- **"Ver relatório (PDF)"** ao lado (secundário). Alvos de toque ≥ 44 px.
- O link vem no retrato da atividade (só da atividade do técnico; fora do escopo, 403 sem link). "Gerar novo link"
  no escritório troca o token: o link e o PDF antigos passam a dar 404 e o app recebe o novo na próxima atualização.

### O relatório (página pública e PDF)

- **PDF no servidor** (`/relatorio/atividade/<id>/pdf?t=<token>`, pdf-lib, a mesma maquinaria do PMOC): capa,
  equipamentos atendidos com o checklist (medições com "esperado" e **"FORA DO ESPERADO"**, ΔT como "delta T"),
  fotos antes/depois e do checklist, serviço extra, fotos do serviço, **materiais usados** (sem valores),
  execução e **assinaturas** (técnico e cliente, com a imagem quando assinou no local).
- Mesmo segredo da página: sem o token certo (ou com o de outra atividade), a mesma 404. Sem cache, sem índice.
- Fotos com teto de 3,5 MB dentro do PDF (a resposta da Vercel vai até 4,5 MB); passou, as seguintes ficam de
  fora e o PDF avisa que estão no link.
- **Página pública:** ganhou os materiais usados, a assinatura do cliente e, no rodapé, **"Baixar PDF"**
  (principal) e "Imprimir" (secundário).

### Mudança compartilhada (fora do app do técnico)

| Arquivo | Por quê |
|---|---|
| `app/(publico)/relatorio/atividade/[id]/page.tsx` | A janela de impressão abria sozinha; agora só com `?imprimir=1` (o cliente que abre pelo WhatsApp não quer a impressão). No lugar, "Baixar PDF" e "Imprimir". O link "Ver relatório" do escritório abre a página sem imprimir. |
| `components/relatorio/atividade-documento.tsx`, `lib/relatorio-server.ts` | Materiais usados e assinatura do cliente na página |
| `components/relatorio/acoes-relatorio-atividade.tsx` (novo) | Os dois botões do rodapé |

### 🟢 Banco (PR B)

Sem SQL. O token do relatório já existe em toda atividade.

### Testes (PR B)

- `app-campo-leva3-relatorio` (20, regra pura e o PDF lido de volta), `app-campo-leva3-relatorio-ui` (12, tela:
  app e página pública), `app-campo-leva3-relatorio-pg` (7, PostgreSQL real: retrato, página, rota do PDF, novo link).
- **Mutação: 40 mutantes, 40 mortos ou removidos.** Na 1ª rodada sobraram 3:
  - o aceite "pelo link" (sem assinatura) virou prova no PostgreSQL;
  - duas checagens eram redundantes (foto que não é data URL; atividade sem token, que o banco não deixa existir)
    e saíram do código.
- Suíte completa: 557 arquivos, 8302 testes, verde. Typecheck e build de produção ok.

### Prints (PR B)

`depois-30…36` (iPhone 13, Pixel 7, desktop): concluída com a confirmação pendente (WhatsApp secundário), cliente
assina, relatório pronto (WhatsApp principal), sem sinal ("Relatório sai quando sincronizar"), de volta ao sinal,
página pública com materiais e com a assinatura. `depois-37…38`: páginas do PDF (medições com o fora do esperado;
fotos, materiais e assinaturas). Dados e fotos fictícios.

## PR C: velocidade e uso com uma mão

### Resultado: "Cheguei → concluir", preventiva de 3 splits

Mesmo roteiro, mesmo custo por ação e **o mesmo checklist da base** (6 medições digitadas; o superaquecimento e o ΔT
do PR A ficam desligados só durante a medição, para comparar igual com igual). Banco local, dados fictícios.

| Aparelho | Toques | Caracteres | Rolagens | Fotos | Tempo padrão | Com a espera do app |
|---|---|---|---|---|---|---|
| iPhone 13 — antes | 64 | 54 | 21 | 12 | 142,5 s | 158,0 s |
| iPhone 13 — depois | **41** (−36%) | 54 | 4 | 12 | **101,3 s** (−29%) | **102,5 s** (−35%) |
| Pixel 7 — antes | 64 | 54 | 26 | 12 | 146,5 s | 153,9 s |
| Pixel 7 — depois | **41** (−36%) | 54 | 4 | 12 | **101,3 s** (−31%) | **102,4 s** (−33%) |

- **Toques: −36% nos dois** (meta: ≤ 44). **Tempo padrão: −29% no iPhone e −31% no Pixel**; somando a espera real do
  app, −35% e −33%. O tempo padrão do iPhone fica 0,6 ponto abaixo da meta de 30%: as 12 fotos (30 s no custo fixo)
  e os 54 caracteres não mudam; o que caiu foi toque e rolagem.
- A espera do app varia com o servidor de desenvolvimento (a 1ª rodada depois de compilar chegou a 26 s); vale a
  rodada com o servidor aquecido, igual à base.
- As 4 rolagens que sobram: 1 até o "Cheguei" no Meu dia (há uma OS esquecida no topo) e 3 do roteiro no "Concluir"
  fixo do rodapé (ele fica 8 px dentro da margem que o roteiro reserva para a barra de baixo; a base contou igual).
- Arquivos: `docs/prints/tecnico-campo-leva3/medicao-depois-*.json` (cada toque e rolagem, na ordem).

### O que mudou no fluxo

| Antes (por equipamento) | Toques | Depois | Toques |
|---|---|---|---|
| Foto antes: câmera do sistema (abrir, disparar, "Usar foto") | 3 | Câmera do app: abrir, disparar | 2 |
| TUDO OK | 1 | TUDO OK | 1 |
| 2 fotos pedidas, câmera do sistema | 6 | A câmera **já abre** nas pedidas e segue: 2 disparos | 2 |
| 6 medições (tocar em cada campo, rolando) | 6 | 1º campo + "Próximo" no teclado (sem rolar) | 6 |
| Foto depois (lá embaixo) | 3 | Vem na mesma sequência das pedidas: 1 disparo | 1 |
| Concluir equipamento | 1 | Concluir e ir ao próximo | 1 |
| | **20** | | **13** |

Na atividade: o "Cheguei" já abre o 1º equipamento (−1 toque); concluir o último abre a confirmação da conclusão
(−1 toque).

- **Câmera do app** (ao vivo): 1 toque abre, 1 toque fotografa, sem a tela "Usar foto". Mostra o que fotografar
  ("Limpeza dos filtros de ar", "2 de 3") e o equipamento. "Pular" passa uma; o X fecha. A foto passa pelo mesmo
  caminho de sempre (redução e marca d'água conforme as permissões).
  - **Galeria** só quando a empresa deixa ("Foto somente pela câmera" desligado).
  - **Câmera bloqueada ou sem câmera:** a câmera do celular assume na hora (a foto entra no mesmo passo) e o app
    lembra nesta sessão (não pede de novo). Navegador sem câmera ao vivo: o botão de sempre, sem passo a mais.
- **TUDO OK com foto pedida faltando:** a câmera abre nas pedidas (são obrigatórias para concluir) e segue até a foto
  depois. Terminou a sequência, a tela desce até a 1ª medição vazia. Sem pedida faltando, o TUDO OK só marca.
- **"Próximo" no teclado:** grava a medição e vai à seguinte (pula o ΔT calculado e o "Não se aplica"); na última, o
  teclado mostra "OK" e fecha.
- **Concluir logo depois de digitar a última medição:** o botão grava o número e espera ele chegar antes de conferir
  (antes acusaria "Falta 1" à toa; com a nova ordem, esse é o caminho comum).
- **"Cheguei":** a OS segue para o 1º equipamento a fazer (a OS fica no histórico: o "voltar" do celular volta a ela).
  Sem equipamento a fazer, fica na OS.
- **Último equipamento:** volta à OS com a confirmação da conclusão aberta, **só com todos atendidos** (com algum não
  atendido, concluir é decisão do técnico, no botão de sempre).
- **Tela do equipamento mais curta** (o TUDO OK sob o dedão, sem rolar): voltar, posição e setas numa linha; "Foto
  antes"/"Foto depois" na linha do título; as duas frases explicativas viraram dica (ⓘ).

### Alvos de toque e contraste para sol

Auditoria automática (Playwright, iPhone 13) nas telas do fluxo: Meu dia, equipamento, câmera, sequência, medições, OS
e conclusão. Conta alvos com menos de 44 px (inclusive a área invisível) e texto abaixo de 7:1 (WCAG AAA).

| | Antes | Depois |
|---|---|---|
| Alvos < 44 px (distintos) | 7 (logo, dicas ⓘ, fechar do aviso e do modal) | **0** |
| Texto abaixo de 4,5:1 (falha WCAG) | 0 | 0 |
| Trechos de texto abaixo de 7:1 | 161 (o texto de apoio era a maioria) | **0** |

- **`campo-sol`** (só no app do técnico, uma classe na raiz): a mesma paleta, um tom mais escura onde se lê na rua.
  Texto de apoio 5,6–6:1 → 8:1; alertas (atenção, atrasado, ok) → ≥ 7,4:1; botões principais com texto branco
  (Cheguei, TUDO OK, Concluir, Atenção) → ≥ 7,6:1; links em acento → 8,5:1.
- **Ícones pequenos** ganharam área de toque invisível de 44 px sem mudar o desenho.

### Mudanças fora do app do técnico (PR C)

| Arquivo | O que muda |
|---|---|
| `app/globals.css` | Regras `.campo-sol …` (só valem dentro do app do técnico) |
| `components/ui/dica.tsx`, `components/ui/avisos.tsx`, `components/ui/modal.tsx` | Área de toque invisível de 44 px no ⓘ, no fechar do aviso e no fechar do modal (vale para o sistema todo; o desenho não muda) |

### Testes (PR C)

- `app-campo-leva3-velocidade-ui` (15, tela com o banco do aparelho e o motor reais), `app-campo-leva3-velocidade`
  (8, contraste calculado das cores e alvos).
- **4 testes antigos atualizados de propósito:** `aviso-cliente-ui` (2: o "Cheguei" pede à OS o 1º equipamento,
  `&primeiro=1`) e `app-tecnico-ui` (2: a legenda do progresso virou dica; o último equipamento volta com `&fim=1`).
