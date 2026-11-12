# Cliente — seção Informações fiscais (Dados gerais)

Nova seção **Informações fiscais** no cadastro do cliente (aba Dados gerais). **Mexe no schema**
(colunas novas no cliente, todas nulas) — além do `schema.prisma`, há o SQL idempotente para rodar no
Neon antes do merge.

## Schema (colunas novas no cliente, todas nulas)

- `optanteSimples` (Boolean?)
- `indicadorInscricaoEstadual` (String? — CONTRIBUINTE | ISENTO | NAO_CONTRIBUINTE; validado no app)
- `inscricaoMunicipal` (String?)
- `inscricaoSuframa` (String?)

A coluna `inscricaoEstadual` **já existia** e é reaproveitada.

SQL idempotente (`ADD COLUMN IF NOT EXISTS`, nada removido, nada muda): `prisma/sql/2026-11-10_cliente_informacoes_fiscais.sql`.
Rodar ANTES do merge, no banco de produção (Neon):

    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-11-10_cliente_informacoes_fiscais.sql

## Interface

Seção **FormSection** (cabeçalho em maiúsculas com ícone), **recolhível e recolhida por padrão**
(progressive disclosure: é avançado, só abre quem vai emitir nota). A **Inscrição estadual saiu de
Identificação** para cá, concentrando o fiscal num lugar só. Campos (dois por linha no desktop,
empilhando no celular):

- **Optante pelo Simples Nacional?** Sim/Não, com tooltip ("Ao marcar Sim, não há retenção de PIS,
  Cofins e CSLL nas notas de serviço deste cliente."). Padrão: **Não**.
- **Indicador de Inscrição estadual** (Contribuinte / Isento / Não contribuinte).
- **Inscrição estadual**, **Inscrição municipal**, **Inscrição SUFRAMA**.

## Consulta de CNPJ

Além de razão social, nome fantasia e contato, quando a resposta federal trouxer a **opção pelo
Simples**, a consulta preenche o **Optante pelo Simples** e **abre a seção** (para o usuário ver o
valor preenchido). IE, IM e SUFRAMA não vêm na consulta federal — ficam manuais (não inventa valor).
A rota `/api/cnpj/[cnpj]` passou a devolver `optanteSimples` (BrasilAPI `opcao_pelo_simples` /
ReceitaWS `simples.optante`, normalizado para boolean|null).

## Persistência (pontas soltas)

Os campos entram no `clienteSchema`, então são salvos no **create** e no **edit** (PUT não ignora
nem zera — ambos espalham `...resto` do schema). Multiempresa: nada hardcoded (usa a empresa da
sessão). Esses campos alimentam o tomador da NFS-e (inscrição municipal) e, no futuro, o destinatário
da NF de produto (indicador de IE).

## Testes

- `cliente-fiscal-pg`: CREATE salva os 4 campos + IE; EDIT atualiza sem zerar; indicador inválido →
  400; vazio → null.
- `cliente-fiscal-ui`: seção recolhida por padrão; abre e mostra os campos (IE migrou para cá); a
  consulta de CNPJ com opção pelo Simples preenche o Optante e abre a seção.
- Ratchet e glossário verdes; suíte completa (PG real) verde.

## Prints

Em `docs/prints/cliente-informacoes-fiscais/` (desktop e celular): seção recolhida e aberta, e a
consulta de CNPJ preenchendo o Optante pelo Simples.
