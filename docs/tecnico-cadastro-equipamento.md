# App do técnico — cadastrar equipamento em campo

O técnico encontra na unidade um equipamento que **não está cadastrado** (não tem QR, não está na
lista). Antes só dava para vincular o que já existia; agora ele cadastra ali mesmo, dentro da OS.

- **Onde:** na OS, junto de "Ler QR Code" e "Da lista": **Cadastrar novo equipamento**. Também no fim
  da lista da unidade ("Não está na lista? Cadastrar novo").
- **O que acontece:** o equipamento nasce **na unidade do cliente da OS**, já **vinculado à atividade**,
  e o app abre a tela dele para o técnico seguir a execução (checklist do tipo, fotos).
- **Ficha e histórico:** é um equipamento normal do cadastro — aparece na lista de equipamentos, na
  ficha, com a OS no histórico dele. O histórico da OS registra "Equipamento cadastrado em campo".

## 🔵 Banco — um item, aditivo

Uma coluna nova em `configuracoes` para o toggle da permissão. **O SQL foi gerado e NÃO foi aplicado.**

```sql
-- prisma/sql/2026-12-04_app_cadastrar_equipamento.sql
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_cadastrar_equipamento" BOOLEAN NOT NULL DEFAULT true;
```

- Aditivo e idempotente (pode rodar mais de uma vez); nada é removido nem alterado.
- `DEFAULT true`: as empresas já cadastradas começam com a permissão **ligada**.
- **Rodar ANTES do merge** (o app passa a ler a coluna):
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-04_app_cadastrar_equipamento.sql`

Todo o resto é 🟢: o equipamento usa a tabela e as colunas que já existem.

## Levantamento: o que foi reaproveitado × o que foi criado

| Peça | Situação | Como entrou |
|---|---|---|
| **Fila de sincronização offline** (`lib/tecnico/sync.ts`, motor e banco do aparelho) | Reaproveitada | O cadastro é **mais uma operação** da mesma fila (`cadastrarEquipamento`): mesma ordem por atividade, mesma idempotência, mesmo reenvio. Nenhuma fila nova. |
| **Vincular equipamento na OS** (`vincular`, `scan`, contexto da execução) | Reaproveitado | O mesmo contexto confere permissão, empresa, atividade aberta e escopo do técnico. "Vincular este à OS" (série ou QR de equipamento que já existe) usa a operação `vincular` de sempre. |
| **Tipo de equipamento** (`resolverTipoEquipamento`, `opcoesTipoEquipamento`) | Reaproveitado | A mesma lista e a mesma regra do painel: só tipos que **já existem e estão ativos**. Em campo **não se cria tipo**. |
| **Numeração do QR** (`gerarQrCodeEquipamento`, contador da empresa) | Reaproveitada | O número novo sai do mesmo contador — a numeração corrigida, que passa do 9999 (teste: depois de `QR-2026-9999` vem `QR-10000`). |
| **Leitura da etiqueta** (`lerEtiqueta`, o OCR do "Cadastro pela foto") | Reaproveitada | Mesma leitura, por uma rota do app (a do painel exige permissão de painel). Só com sinal. |
| **Validação das fotos** (`validarFotos`, tipo decidido pelos bytes) | Reaproveitada | A mesma do cadastro do painel. |
| **Câmera do app** (`BotaoFoto`: só câmera, marca d'água, redução) | Reaproveitada | As fotos do cadastro passam pelo mesmo botão — as permissões do app valem sem código novo. |
| **Leitor de QR** (`ScannerQR`) e **apresentação do equipamento** (título, local) | Reaproveitados | Mesmo leitor da OS; mesmas regras de título/local do servidor, para a tela não mudar ao sincronizar. |
| **Setor / ambiente** (colunas `setor` e `localizacao` do equipamento) | Reaproveitados | Dois campos de texto, com sugestão dos que já existem na unidade. |
| Operação `cadastrarEquipamento` e a ação do servidor (`lib/execucao/cadastro-campo.ts`) | **Criado** | Cria na unidade da OS com o id gerado no aparelho, vincula, define o QR, confere a série e registra no histórico. |
| Regras puras do cadastro (`lib/tecnico/cadastro-equipamento.ts`) | **Criado** | Formato da gravação, como o equipamento aparece antes de sincronizar, conferência de série no aparelho. |
| Formulário do app (`components/tecnico/cadastro-equipamento.tsx`) | **Criado** | Enxuto, de dedão. |
| Rotas do app: `…/atividades/<id>/etiqueta` e `…/atividades/<id>/serie` | **Criadas** | Leitura da etiqueta e conferência de série para quem executa a atividade, com privacidade. |
| Toggle "Permitir cadastrar equipamento em campo" | **Criado** | Equipes › App do colaborador (🔵 a coluna acima). |
| O que vai no retrato da atividade para o app | **Ampliado** | Unidade do cadastro, tipos disponíveis (com o checklist de cada um) e sugestões de local. |

## O formulário

Cliente e unidade vêm da OS — **não são pedidos**.

| Campo | Regra |
|---|---|
| Tipo de equipamento | **Obrigatório.** Só os que já existem e estão ativos. |
| Etiqueta do equipamento | Foto opcional. Com sinal, é lida e preenche **só o que estiver vazio** (o que o técnico digitou vale). |
| Nº de série | Recomendado, não obrigatório. |
| Marca / modelo | Opcionais. |
| Capacidade | Opcional (número + BTU/h ou TR). |
| Setor / ambiente | Opcionais, com sugestão dos que já existem na unidade. |
| Foto do equipamento | Opcional (vira a capa na ficha). |
| QR Code | Opcional: ler a etiqueta QR já colada; sem etiqueta, o número é gerado ao salvar. |

Botões com alvo de toque de 44 px; textos curtos.

## Comportamento OFFLINE

- **Salvar sem sinal funciona.** O cadastro vai para a fila do aparelho e o equipamento **já aparece na
  OS**, com o checklist do tipo escolhido. O técnico segue a execução nele normalmente — as respostas e
  fotos também ficam na fila, na ordem.
- **O id do equipamento é gerado no aparelho.** Por isso as gravações seguintes já apontam para ele, e
  quando o sinal volta o servidor cria o equipamento com esse mesmo id. **Reenviar não duplica.**
- **Fechar e reabrir o app sem sinal não perde nada**: a fila fica guardada no aparelho.
- **Quando o sinal volta, sobe sozinho**, na mesma sincronização de sempre.
- **Nada trava por falta de sinal.** A tela do equipamento mostra "No aparelho: sobe sozinho quando
  houver sinal." enquanto não subiu.
- **Leitura da etiqueta:** só com sinal. Sem sinal, a foto fica guardada e a tela pede para digitar.
- **QR:** sem sinal o número ainda não existe — é gerado quando o cadastro sobe e passa a aparecer na
  tela do equipamento.

## Aviso de nº de série repetido — só aviso, nunca bloqueia

| Situação | O que é conferido | O que o técnico vê |
|---|---|---|
| **Com sinal** | A empresa inteira. | Qual equipamento do **mesmo cliente** tem a série e onde está; de outros clientes, só a contagem. |
| **Sem sinal** | O que o aparelho tem: os equipamentos da unidade e os cadastros que estão na fila. | O aviso (se achar) e "Sem sinal: a conferência completa da série acontece ao sincronizar." |
| **Ao sincronizar** | A empresa inteira, de novo, no servidor. | Se a série já existia: um aviso no app; o cadastro é **mantido** e fica anotado no histórico da OS para o escritório. |

- Se o equipamento com a mesma série já está na unidade, o aviso oferece **"Vincular este à OS"** em vez
  de cadastrar de novo.
- O mesmo vale para o QR: se a etiqueta lida já é de um equipamento da unidade, o app oferece vincular.

## QR Code

- **Etiqueta avulsa lida no equipamento** (impressa antes, ainda sem dono): é ela que fica — não gasta
  número novo.
- **Sem etiqueta:** o servidor gera o próximo número do contador da empresa.
- **Etiqueta que já é de outro equipamento, ou que não é da empresa:** não trava — gera um número novo,
  avisa o técnico e deixa anotado no histórico da OS.

## Permissões

- **"Permitir cadastrar equipamento em campo"** (Equipes › App do colaborador, por empresa, ligado por
  padrão). Desligado: o botão **nem aparece** no app e o **servidor recusa** (403) — inclusive a
  leitura da etiqueta e a conferência de série.
- **Foto somente pela câmera:** as fotos do cadastro só abrem a câmera e recusam arquivo antigo.
- **Marca d'água:** as fotos do cadastro são carimbadas como as demais.
- **Dados do cliente desligados:** o formulário não mostra cliente, unidade nem endereço; a conferência
  de série não devolve o nome da unidade.
- **Outros clientes:** o nome de outro cliente nunca sai na conferência de série — só a contagem.
- **Escopo:** só o técnico da atividade cadastra nela; atividade concluída não aceita.
- Nenhuma permissão do painel foi alterada.

## Decisões que tomei — confira

1. **OS sem endereço definido:** se o cliente tem **uma** unidade, o equipamento nasce nela; se tem
   **mais de uma**, o app não oferece o cadastro e explica ("peça ao escritório para definir o
   endereço"). Escolher a unidade no app mostraria nomes de unidades do cliente — preferi não abrir isso.
2. **Marca e modelo em branco:** como são opcionais em campo, ficam vazios no cadastro. O painel exige
   os dois ao **editar** a ficha — o escritório completa quando abrir. Não mudei a regra do painel.
3. **Equipamento novo entra como "vinculado", não "atendido":** vira atendido quando o técnico responde
   algo dele, como qualquer outro.
4. **A foto da etiqueta é enviada à Anthropic** para leitura (igual ao painel). O formulário avisa.

## Testes

- `cadastro-campo` (15): formato, apresentação antes de sincronizar, conferência de série no aparelho,
  entrada na OS pela fila, a permissão.
- `cadastro-campo-pg` (21, Postgres real): criar + vincular, gravações seguintes no mesmo envio,
  reenvio, tipo, unidade, QR (etiqueta avulsa × número novo depois do 9999), série repetida, permissão
  desligada, escopo, o retrato, conferência de série com privacidade, leitura da etiqueta.
- `cadastro-campo-ui` (31): onde o botão aparece, o formulário, sem sinal, com sinal, QR, permissões do app.
- `sql-app-cadastrar-equipamento` (5): o SQL de produção rodado num Postgres de verdade.
- `config-app`: a lista de permissões do app passou de 11 para 12 (expectativa atualizada de propósito).

## Prints

`docs/prints/tecnico-cadastro-equipamento/` — desktop e celular.
