# PMOC — Etapa 3: documento, ART, alertas de vencimento e envio ao cliente

Fecha o módulo PMOC: o plano vira um **documento em PDF**, a **ART** vai junto, o sistema **avisa
antes de o plano expirar** e o documento **vai ao cliente** por WhatsApp ou e-mail, com tudo
registrado no **histórico** do plano.

Etapas anteriores: `docs/pmoc-etapa2-cronograma.md` (cronograma, substituição e fim de semana).

## Banco

`prisma/sql/2026-12-15_pmoc_etapa3_documento_alertas_envio.sql` — aditivo e idempotente, sem enum.

| O que | Para quê |
|---|---|
| `pmocs.token_publico` | O segredo do link público do documento. Nasce vazio; é gravado no 1º envio. |
| `pmoc_historico` | A linha do tempo do plano: envios, avisos, ciência, ART, publicação, cópia. |
| `pmoc_avisos` | O aviso de vencimento já registrado: um por (plano, tipo, data de expiração). |
| `pmoc_configuracoes` | O padrão da empresa: dias de antecedência do aviso e texto técnico dos planos novos. |

## O documento

Botão **Baixar documento** no plano. O PDF é gerado no servidor, na hora, a partir do cadastro —
não fica guardado. Rascunho também gera (para conferir antes de publicar).

| Seção | De onde vem |
|---|---|
| Capa e identificação | Plano, cliente, unidade e endereço, vigência, situação calculada pela data. |
| Responsável técnico | Nome, CREA e número da ART do plano. |
| Apresentação e base normativa | O texto do plano; sem ele, o padrão da empresa; sem ele, o do sistema. |
| Equipamentos cobertos | TAG, descrição, tipo, capacidade e local, do cadastro de equipamentos (só os ativos). |
| Cronograma | A tabela mês a mês, por equipamento. |
| Planejamento das atividades | O checklist de cada tipo de equipamento coberto e os formulários dos serviços do plano. |
| Assinaturas | Responsável técnico e responsável pelo estabelecimento. |
| Anexo | A ART. |

**Cronograma no documento.** É calculado pelas mesmas regras que geram as OS
(`lib/pmoc-cronograma`), para o plano inteiro:

- a **substituição** já está aplicada: no mês em que a química coincide com a leve, só a química
  aparece para aquele equipamento. Nenhum serviço substituído é listado;
- as **datas já estão ajustadas** pelo fim de semana de cada item;
- é o **plano**, não a agenda: não depende de quais OS já foram geradas, mudadas à mão ou
  canceladas. O documento é o mesmo no início e no fim da vigência;
- as colunas vão do primeiro ao último mês com execução.

**Tamanho.** O texto usa as fontes padrão do PDF (não são embutidas): um plano comum fica em
dezenas de KB. A logo da empresa só entra se for PNG ou JPG de até 600 KB. O limite do documento é
4 MB (a resposta de uma função da Vercel vai até 4,5 MB).

**Nada fixo de uma empresa.** Nome, CNPJ, contato e logo são os da empresa do plano. O texto
normativo é editável por plano e tem padrão por empresa (Configurações).

## ART

- O arquivo é anexado na aba Identificação (PDF, JPG ou PNG, até **3 MB**). Anexar exige
  `pmoc.editar`.
- O tipo é decidido pelo **conteúdo** do arquivo, não pelo que o navegador declara.
- Foto de ART é reduzida no navegador antes de enviar (continua legível e fica leve).
- No documento: PDF da ART entra com as páginas como são; imagem vira uma página.
- Se o arquivo não couber no limite do documento ou não puder ser lido, o documento sai sem ele e
  diz que a ART segue em arquivo separado. O download separado da ART continua existindo.
- **Criar cópia não leva a ART** (nem o número, nem o arquivo): cada plano tem a sua.
  O link público e os avisos também não são copiados.

## Avisos de vencimento

O aviso nasce da **data**, não de uma rotina agendada:

| Aviso | Quando |
|---|---|
| Perto de expirar | Plano publicado e ativo, faltando até N dias (N é da empresa; padrão 30). |
| Expirado | A partir do dia seguinte à expiração. |

- Aparece no **sino**, no bloco **PMOC do dashboard** e numa faixa no próprio plano.
- **Idempotente:** o aviso é registrado no histórico uma vez por plano, tipo e data de expiração.
  A chave única de `pmoc_avisos` recusa a segunda tentativa, mesmo com várias consultas ao mesmo
  tempo.
- **Ciente** (exige `pmoc.editar`) tira o aviso do sino e do dashboard de todos e fica no histórico.
- Virar expirado é **outro** aviso, mesmo com ciência do "perto de expirar". Mudar a data de
  expiração também recomeça.
- Rascunho e plano inativo não avisam.
- O registro no histórico acontece quando alguém com acesso ao PMOC está com o sistema aberto (o
  sino consulta a cada 2 minutos). Não há e-mail de aviso.

## Envio ao cliente

Botão **Enviar ao cliente** no plano (só plano publicado e ativo):

| Canal | Como |
|---|---|
| WhatsApp | Abre o `wa.me` com a mensagem pronta para o WhatsApp do contato principal do cliente. |
| E-mail | Pelo e-mail da empresa (Resend), modelo "Documento do PMOC". Sem o Resend configurado, abre o programa de e-mail de quem envia. |
| Copiar link | Só o link. |

- O que vai é o **link público** do documento: `/relatorio/pmoc/<token>`. Abre o PDF sem login.
- O link só funciona enquanto o plano está **publicado e ativo**. Voltou para rascunho ou foi
  inativado, para de abrir; publicado de novo, o mesmo link volta.
- O documento do link é sempre o atual.
- Cada envio fica no **histórico** (canal, para quem, quem enviou). Como não há API de WhatsApp, o
  registro é do momento em que o usuário abre a conversa.

## Permissões

| Ação | Permissão |
|---|---|
| Baixar o documento, enviar ao cliente, ver o histórico | `pmoc.visualizar` |
| Anexar, trocar ou excluir a ART | `pmoc.editar` |
| Dar ciência do aviso | `pmoc.editar` |
| Ver as configurações do PMOC | `pmoc.visualizar` |
| Salvar as configurações do PMOC | `pmoc.editar` |
| Sem o módulo PMOC, e o técnico do app | 403 em tudo |
| Link público | Sem login; só com o token |

## Onde está

- Documento: `lib/pmoc-documento.ts` (o que diz), `lib/pmoc-documento-pdf.ts` (como é desenhado),
  `lib/pmoc-documento-server.ts` (leitura do cadastro, histórico, link, configuração).
- Avisos e envio: `lib/pmoc-avisos.ts` (regras), `lib/pmoc-avisos-server.ts`.
- Rotas: `/api/pmocs/[id]/documento`, `/enviar`, `/aviso`, `/historico`, `/api/pmocs/configuracao`,
  `/relatorio/pmoc/[token]` (pública).
- Telas: `components/pmoc/pmoc-envio.tsx`, `pmoc-historico.tsx`, `pmoc-config-botao.tsx`; o bloco
  do dashboard em `components/dashboard/blocos.tsx`; o sino em `components/layout/header.tsx`.
- Dependência nova: `pdf-lib` (JavaScript puro, sem navegador nem binário nativo).
