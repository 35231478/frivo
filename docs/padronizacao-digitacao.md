# Padronização de digitação (casing)

Os dados entravam em CAPS, minúsculo ou misturado e ficavam inconsistentes. Agora há **uma
normalização padrão, compartilhada**, aplicada no cliente (ao sair do campo) e no servidor (ao
gravar, de onde quer que o dado venha), mais uma **limpeza única** dos dados antigos com prévia.
Código 🟢 — sem mudança de schema.

## A função (uma só) — `lib/texto/normalizar.ts`

- **Nome** (cliente, colaborador, fornecedor, contato, equipe…) → "Nome Próprio": inicial de cada
  palavra em maiúscula; conectores (`de, da, do, das, dos, e`) em minúsculo, menos na 1ª palavra;
  siglas preservadas por uma **lista curada** (`ME, EPP, EIRELI, S/A, VRF, CNPJ, CPF…`) e `LTDA`
  com forma canônica `Ltda`. Ex.: `TERMOFRIO ENGENHARIA E CLIMA LTDA` → `Termofrio Engenharia e
  Clima Ltda`.
  - Decisão: **não** existe "todo token curto em CAPS é sigla". Isso transformaria nomes curtos
    (Ana, Ivo) em sigla; quem precisa de uma sigla nova a acrescenta em `SIGLAS`. Assim `ANA SOUZA`
    e `ANA souza` viram `Ana Souza`, e `VRF`/`ME`/`S/A` seguem preservados.
- **E-mail** → minúsculo + trim.
- **Cidade / endereço** (logradouro, bairro, complemento) → "Nome Próprio".
- **Texto livre** (observações, descrições) → só apara espaços; **não muda o casing** e **preserva
  as quebras de linha**.
- Todo campo apara espaços (pontas e duplicados no meio). **Não** mexe em senha, token, documentos
  mascarados (CNPJ/CPF/placa) nem campos fiscais — a origem escolhe quais campos passam por aqui.
- **Idempotente**: rodar de novo não muda nada.

## Onde é aplicada

- **Cliente (onBlur)** — o `Input` compartilhado (`components/ui/input.tsx`) ganhou a prop opcional
  `caixa` ("nome" | "email" | "cidade" | "endereco" | "livre"): ao sair do campo o valor já se
  ajeita, pela MESMA função. Ligado nos formulários de cliente, colaborador, técnico, contato e
  unidade, e no renderer genérico dos cadastros (`caixa` no `CampoCadastro` → fornecedor, usuário).
- **Servidor (fonte da verdade)** — transformadores de Zod (`lib/texto/zod.ts`) nos schemas de
  criar/editar: cliente, colaborador/técnico, contato, equipe, unidade (`lib/validations.ts`),
  fornecedor e usuário (registro dos cadastros), os schemas embutidos do cliente
  (`app/api/clientes/route.ts`), a **importação em massa** (`lib/importacao/entidades.ts`, o cliente
  não passa pelo schema do registro) e o **lead do site** (`lib/leads/criar-lead-site.ts`). Pega
  tudo, venha de onde vier.

## Limpeza dos dados antigos (uma vez) — `lib/texto/limpeza.ts`

Percorre os registros que já existem (clientes + endereços/unidades, colaboradores, fornecedores,
contatos, equipes e o nome dos usuários) e aplica a MESMA função. Dois modos:

- **Prévia** (`GET /api/configuracoes/padronizacao`): só LISTA o que mudaria (de → para), sem gravar.
- **Aplicar** (`POST`): grava só os campos que mudam, um update por registro; loga o resumo.

Multiempresa (sempre filtra por `empresaId`, nunca cruza), idempotente e com confirmação na tela.
Fica em **Configurações › Conta › Manutenção de dados › Padronização de digitação** (quem gerencia
as Configurações). O e-mail do usuário (identidade de login) não é mexido na limpeza.

## Fora (de propósito)

Mudança de schema; senha, token, documentos mascarados e campos fiscais.

## Testes

- `texto-normalizar` — a função: tudo CAPS, tudo minúsculo, misto, conectores, siglas (lista e
  LTDA→Ltda), e-mail, trim, texto livre intacto, hífen, idempotência.
- `texto-aplicacao` — o servidor: os schemas de cliente/colaborador/contato/equipe/unidade, o lead
  do site e os cadastros do registro (fornecedor, usuário) já saem padronizados do `parse`.
- `texto-input-onblur` — o `Input` ajeita ao sair (onBlur), por tipo; sem `caixa`, não mexe.
- `padronizacao-limpeza-pg` (PostgreSQL real) — prévia lista e não grava; aplicar grava em todas as
  entidades (observação com casing intacto); idempotente; multiempresa não cruza.
- Rodada de mutação (7/7 mortas) sobre a função e a limpeza.

## Prints

Em `docs/prints/padronizacao/`: o `onBlur` no formulário de cliente (antes em CAPS, depois `Termofrio
Engenharia e Clima Ltda`), a prévia de → para e a tela aplicada; desktop e celular.
