# Cliente — seção Cobrança e faturamento (Dados gerais)

Nova seção **Cobrança e faturamento** no cadastro do cliente (aba Dados gerais), logo após COMERCIAL.
**Sem mudança de schema** — reaproveita colunas que já existem no cliente e tinham saído da UI quando a
aba Faturamento foi removida (#146). Referência de layout: o "Contato para cobrança e faturamento" da
Conta Azul.

## Sem schema (colunas reaproveitadas)

- `emailsFaturamento` (String[]) — e-mails de cobrança.
- `whatsappFaturamento` (String?) — WhatsApp de cobrança.
- `boletoUnicoMensal` (Boolean) — preferência.
- `exigePcAntesNf` (Boolean) — preferência (já lida em `lib/faturamento/aprovar-medicao-server.ts`).
- `agrupaAdicionais` (Boolean) — preferência (já lida em `lib/faturamento/medicao-contrato-server.ts`).

Os cinco entram no `clienteSchema`, então são gravados no **create** e no **edit** (o PUT espalha
`...resto`, não ignora nem zera). Multiempresa: nada hardcoded (usa a empresa da sessão).

## Interface

Seção **FormSection** (cabeçalho em maiúsculas com ícone), sempre visível na aba Dados gerais. Campos
(dois por linha no desktop, empilhando no celular):

- **E-mails de cobrança** — entrada de múltiplos e-mails como "tags" (`components/ui/emails-input.tsx`):
  confirma cada e-mail com Enter, Tab, vírgula ou ao sair do campo; aceita colar lista separada por
  vírgula/espaço; ignora duplicados e inválidos; remove pelo "x" do chip. Texto curto de apoio: "As
  faturas e cobranças deste cliente são enviadas para estes e-mails."
- **WhatsApp de cobrança** — campo único (`WhatsAppInput`).
- **Preferências de cobrança** (`ToggleGroup`): **Boleto único mensal**, **Exige pedido de compra antes
  da NF**, **Agrupa adicionais na fatura** — cada um um toggle com rótulo profissional e dica curta.

## Ponta solta — destinatário de cobrança/fatura (fallback)

`lib/cliente/cobranca-destino.ts` concentra a resolução do destinatário:

- `emailCobranca(cliente)`: **e-mails de cobrança → contato principal → e-mail do cadastro**.
- `whatsappCobranca(cliente)`: **WhatsApp de cobrança → WhatsApp do contato principal → celular do cadastro**.

Assim o envio de cobrança/fatura **nunca fica sem destino** havendo qualquer e-mail/telefone cadastrado.
Aplicado onde a cobrança/fatura resolve o destinatário:

- `lib/email.ts` (`getEmailsCobranca`): boleto, lembrete de vencimento e confirmação de pagamento —
  e-mails de cobrança têm prioridade; sem eles, cai no roteamento FINANCEIRO (aba Comunicação) e, por
  fim, no contato principal.
- `app/api/medicoes/[id]/acao/route.ts` — mailto/WhatsApp ao enviar a medição.
- `app/(publico)/medicao/[token]/page.tsx` e `app/(publico)/relatorio/[token]/page.tsx` — botões de envio.
- `lib/nfse/emissao-server.ts` — e-mail do tomador na NFS-e.

## Testes

- `cliente-cobranca-pg`: CREATE grava os 5 campos; EDIT atualiza sem zerar; e-mail inválido → 400; e o
  destino de cobrança resolve e-mails de cobrança → contato principal → cadastro (idem WhatsApp).
- `cliente-cobranca-ui`: a seção mostra os campos e as preferências; o campo de e-mails adiciona por
  Enter/vírgula, rejeita inválido e remove pelo "x"; as preferências são toggles.
- Ratchet e glossário verdes; `tsc` limpo; build exit 0.

## Prints

Em `docs/prints/cliente-cobranca-faturamento/` (desktop e celular): seção recém-aberta e preenchida
(chips de e-mail, WhatsApp e uma preferência ligada).
