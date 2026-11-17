/**
 * DOCUMENTAÇÃO DA EQUIPE PARA O CLIENTE — o servidor.
 *
 * Nada aqui é novo por dentro: os arquivos são os da ficha do colaborador
 * (`colaborador_documentos`), o zip é o da casa (`lib/zip.ts`), o e-mail é o da casa
 * (`lib/email.ts`, com o modelo "Documentação da equipe" editável por empresa), e o link público
 * segue o padrão da admissão digital: token aleatório guardado na linha, com validade.
 *
 * O que este arquivo garante, e os testes cobram:
 *
 *  - **empresa**: cliente, contrato, colaborador e envio de outra empresa são 404 — nunca dados;
 *  - **lista fechada (LGPD)**: o link entrega só os itens gravados no envio. O servidor nunca lê
 *    "os documentos do colaborador" para servir o link — lê os ITENS daquele envio;
 *  - **vencido não sai**: nem na criação, nem ao gerar um link novo para um pacote antigo, nem no
 *    reenvio do e-mail. O que venceu depois do envio continua visível no link, marcado;
 *  - **um cliente por envio**: o lote é uma lista de envios individuais. Não existe caminho neste
 *    arquivo em que dois clientes dividam um token ou um e-mail;
 *  - **nada some**: revogar e expirar não apagam, e cada passo (da empresa e do cliente) vira
 *    evento na linha do tempo.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { formatarData } from "@/lib/utils";
import { decodificarDataUrl } from "@/lib/anexos-server";
import { identificarTipo } from "@/lib/anexos";
import { montarZip, semRepetir, type ArquivoZip } from "@/lib/zip";
import { enviarEmail, getEmailsComunicacao } from "@/lib/email";
import { rotuloCategoria, situacaoValidade } from "@/lib/colaborador/documentos";
import type { ArquivoGerado } from "@/lib/pdf/resposta";
import {
  CATEGORIAS_PROIBIDAS, CLIENTES_NO_LOTE_MAX, COLABORADORES_MAX, ITENS_MAX, ORGANIZACAO_PADRAO,
  caminhoNoPacote, caminhoPublicoDocumentacao, categoriaEnviavel, conferirDestinatarios, diagnosticar,
  expiraEm, limparEmails, mensagemDeVencidos, organizacaoValida, situacaoDoLink, validadeDoLink, viaValida,
  type Diagnostico, type DocumentoCandidato, type Organizacao, type SituacaoLink, type TipoEvento, type Via,
} from "@/lib/documentacao/pacote";

export class ErroDocumentacao extends Error {
  constructor(message: string, readonly status = 400, readonly detalhe?: unknown) {
    super(message);
    this.name = "ErroDocumentacao";
  }
}

export const MSG_NAO_ENCONTRADO = "Envio não encontrado.";
/** Link que não existe: frase genérica — nada aqui confirma a quem chuta um endereço que ele quase acertou. */
export const MSG_LINK_INDISPONIVEL = "Este link não está mais disponível. Peça um novo a quem enviou.";
/**
 * Link que EXISTIU e não vale mais: aí o motivo é dito. Quem chega aqui tem o token de verdade (32
 * bytes — não se adivinha), ou seja, é o cliente; e para ele "expirou em tal dia" ou "foi
 * desativado" é o que diz o que fazer, em vez de um erro mudo.
 */
export type MotivoDoLink = "EXPIRADO" | "REVOGADO";
export const mensagemDoLink = (motivo: MotivoDoLink, empresa: string, expiraEm: Date | null): string =>
  motivo === "REVOGADO"
    ? `Este link foi desativado por ${empresa}. Peça um novo a quem enviou.`
    : `Este link expirou${expiraEm ? ` em ${formatarData(expiraEm)}` : ""}. Peça um novo a ${empresa}.`;

/** Token do link: 32 bytes de verdade — o mesmo tamanho do link da admissão (dado de pessoa). */
const novoToken = () => randomBytes(32).toString("base64url");
const limpo = (v: unknown) => String(v ?? "").trim();

export interface Ator { empresaId: string; usuarioId: string }
export interface Origem { ip?: string | null; userAgent?: string | null }

/* ───────────────────────── a seleção ───────────────────────── */

export interface Selecao {
  clienteId: string;
  contratoId?: string | null;
  colaboradorIds: string[];
  categorias: string[];
  organizacao?: string;
}

const listaDeIds = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : []).map(limpo).filter(Boolean))];

/** Lê a seleção do corpo da requisição, sem confiar em nada do que veio. */
export function lerSelecao(bruto: Record<string, unknown>): Selecao {
  return {
    clienteId: limpo(bruto.clienteId),
    contratoId: limpo(bruto.contratoId) || null,
    colaboradorIds: listaDeIds(bruto.colaboradorIds),
    categorias: listaDeIds(bruto.categorias),
    organizacao: limpo(bruto.organizacao) || undefined,
  };
}

interface SelecaoConferida {
  cliente: { id: string; nome: string; nomeFantasia: string | null };
  contratoId: string | null;
  colaboradores: { id: string; nome: string }[];
  categorias: string[];
  organizacao: Organizacao;
}

/** Confere a seleção contra a empresa: o que não é dela, não existe. */
async function conferirSelecao(empresaId: string, s: Selecao): Promise<SelecaoConferida> {
  if (!s.clienteId) throw new ErroDocumentacao("Escolha o cliente.", 400);
  const cliente = await prisma.cliente.findFirst({
    where: { id: s.clienteId, empresaId }, select: { id: true, nome: true, nomeFantasia: true },
  });
  if (!cliente) throw new ErroDocumentacao("Cliente não encontrado.", 404);

  let contratoId: string | null = null;
  if (s.contratoId) {
    const contrato = await prisma.contrato.findFirst({
      where: { id: s.contratoId, empresaId, clienteId: cliente.id }, select: { id: true },
    });
    if (!contrato) throw new ErroDocumentacao("Contrato não encontrado para este cliente.", 404);
    contratoId = contrato.id;
  }

  if (!s.colaboradorIds.length) throw new ErroDocumentacao("Marque pelo menos um colaborador.", 400);
  if (s.colaboradorIds.length > COLABORADORES_MAX) {
    throw new ErroDocumentacao(`No máximo ${COLABORADORES_MAX} colaboradores por pacote.`, 400);
  }
  const colaboradores = await prisma.tecnico.findMany({
    where: { id: { in: s.colaboradorIds }, empresaId }, select: { id: true, nome: true }, orderBy: { nome: "asc" },
  });
  // Um id que não é da empresa derruba o pedido inteiro: pacote não se monta "com o que deu".
  if (colaboradores.length !== s.colaboradorIds.length) throw new ErroDocumentacao("Colaborador não encontrado.", 404);

  if (!s.categorias.length) throw new ErroDocumentacao("Marque pelo menos um tipo de documento.", 400);
  const proibida = s.categorias.find((c) => CATEGORIAS_PROIBIDAS.includes(c));
  if (proibida) {
    throw new ErroDocumentacao(`${rotuloCategoria({ categoria: proibida })} não pode ser enviado a cliente.`, 400);
  }
  const desconhecida = s.categorias.find((c) => !categoriaEnviavel(c));
  if (desconhecida) throw new ErroDocumentacao("Tipo de documento inválido.", 400);

  const organizacao = s.organizacao === undefined ? ORGANIZACAO_PADRAO : s.organizacao;
  if (!organizacaoValida(organizacao)) throw new ErroDocumentacao("Organização de pastas inválida.", 400);

  return { cliente, contratoId, colaboradores, categorias: s.categorias, organizacao };
}

/** Os documentos vivos das pessoas marcadas, nas gavetas marcadas — o universo do diagnóstico. */
async function candidatos(colaboradorIds: string[], categorias: string[]): Promise<DocumentoCandidato[]> {
  const linhas = await prisma.colaboradorDocumento.findMany({
    where: { colaboradorId: { in: colaboradorIds }, categoria: { in: categorias }, excluidoEm: null },
    orderBy: [{ criadoEm: "asc" }],
    select: { id: true, colaboradorId: true, categoria: true, nome: true, dataVencimento: true, tamanho: true, arquivoUrl: true },
  });
  return linhas.map((l) => ({
    id: l.id, colaboradorId: l.colaboradorId, categoria: l.categoria, nome: l.nome,
    dataVencimento: l.dataVencimento, tamanho: l.tamanho, temArquivo: !!l.arquivoUrl,
  }));
}

/* ───────────────────────── quem atende o cliente ───────────────────────── */

export interface ColaboradorSugerido { id: string; nome: string; ativo: boolean; motivo: "CONTRATO" | "ATENDEU" | "EQUIPE" }

const MESES_DE_ATENDIMENTO = 12;

/**
 * Quem atende este cliente — a sugestão que a tela já traz marcada, para ninguém montar a lista de
 * memória. Três fontes, todas do que já existe:
 *  - os técnicos fixos dos contratos ativos (responsável técnico e o da recorrência);
 *  - quem executou ordem de serviço do cliente nos últimos 12 meses (responsável e equipe);
 *  - os membros de uma equipe, quando a pessoa escolhe puxar por equipe.
 * É sugestão: o pacote leva quem a pessoa marcar.
 */
export async function sugerirColaboradores(
  empresaId: string, filtro: { clienteId?: string | null; contratoId?: string | null; equipeId?: string | null },
  agora: Date = new Date(),
): Promise<ColaboradorSugerido[]> {
  const motivos = new Map<string, ColaboradorSugerido["motivo"]>();
  const marcar = (id: string | null | undefined, motivo: ColaboradorSugerido["motivo"]) => {
    if (id && !motivos.has(id)) motivos.set(id, motivo);
  };

  if (filtro.clienteId) {
    const cliente = await prisma.cliente.findFirst({ where: { id: filtro.clienteId, empresaId }, select: { id: true } });
    if (!cliente) throw new ErroDocumentacao("Cliente não encontrado.", 404);

    const contratos = await prisma.contrato.findMany({
      where: { empresaId, clienteId: cliente.id, status: "ATIVO", ...(filtro.contratoId ? { id: filtro.contratoId } : {}) },
      select: { responsavelTecnicoId: true, tecnicoRecorrenciaId: true },
    });
    for (const c of contratos) { marcar(c.responsavelTecnicoId, "CONTRATO"); marcar(c.tecnicoRecorrenciaId, "CONTRATO"); }

    const desde = new Date(agora); desde.setMonth(desde.getMonth() - MESES_DE_ATENDIMENTO);
    const atividades = await prisma.atividadeOs.findMany({
      where: {
        ordemServico: { empresaId, clienteId: cliente.id, criadoEm: { gte: desde }, ...(filtro.contratoId ? { contratoId: filtro.contratoId } : {}) },
      },
      select: { tecnicoId: true, tecnicosEquipe: { select: { tecnicoId: true } } },
      take: 2000,
    });
    for (const a of atividades) {
      marcar(a.tecnicoId, "ATENDEU");
      for (const t of a.tecnicosEquipe) marcar(t.tecnicoId, "ATENDEU");
    }
  }

  if (filtro.equipeId) {
    const equipe = await prisma.equipe.findFirst({
      where: { id: filtro.equipeId, empresaId }, select: { liderId: true, membros: { select: { id: true } } },
    });
    if (!equipe) throw new ErroDocumentacao("Equipe não encontrada.", 404);
    marcar(equipe.liderId, "EQUIPE");
    for (const m of equipe.membros) marcar(m.id, "EQUIPE");
  }

  if (!motivos.size) return [];
  const pessoas = await prisma.tecnico.findMany({
    where: { id: { in: [...motivos.keys()] }, empresaId }, select: { id: true, nome: true, ativo: true }, orderBy: { nome: "asc" },
  });
  // Quem saiu da empresa não é sugerido: documentação de ex-colaborador não vai a cliente por padrão.
  return pessoas.filter((p) => p.ativo).map((p) => ({ ...p, motivo: motivos.get(p.id)! }));
}

/** Os contratos ativos do cliente, para a tela oferecer "só quem atende este contrato". */
export async function contratosDoCliente(empresaId: string, clienteId: string): Promise<{ id: string; numero: string }[]> {
  return prisma.contrato.findMany({
    where: { empresaId, clienteId, status: "ATIVO" }, orderBy: { numero: "asc" }, select: { id: true, numero: true },
  });
}

/** Os e-mails que a tela já traz preenchidos: os contatos operacionais do cadastro do cliente. */
export async function emailsSugeridos(clienteId: string): Promise<{ para: string[]; cc: string[] }> {
  const [primeiro, ...resto] = await getEmailsComunicacao(clienteId, "ORDENS");
  return { para: primeiro ? [primeiro] : [], cc: resto };
}

/* ───────────────────────── a prévia ───────────────────────── */

export interface Previa extends Diagnostico {
  cliente: { id: string; nome: string };
  organizacao: Organizacao;
  email: { para: string[]; cc: string[] };
  mensagemVencidos: string;
}

/** O que entra, o que falta e o que segura — sem gravar nada. A tela mostra antes de gerar. */
export async function previaDoPacote(empresaId: string, selecao: Selecao, agora: Date = new Date()): Promise<Previa> {
  const s = await conferirSelecao(empresaId, selecao);
  const d = diagnosticar(s.colaboradores, s.categorias, await candidatos(s.colaboradores.map((c) => c.id), s.categorias), agora);
  return {
    ...d,
    cliente: { id: s.cliente.id, nome: s.cliente.nomeFantasia || s.cliente.nome },
    organizacao: s.organizacao,
    email: await emailsSugeridos(s.cliente.id),
    mensagemVencidos: mensagemDeVencidos(d.vencidos),
  };
}

/* ───────────────────────── o envio ───────────────────────── */

const SELECT_ENVIO = {
  id: true, empresaId: true, clienteId: true, clienteNome: true, contratoId: true, categorias: true, organizacao: true,
  token: true, expiraEm: true, revogadoEm: true, loteId: true, criadoEm: true,
  criadoPor: { select: { nome: true } },
  itens: {
    orderBy: { caminho: "asc" as const },
    select: {
      id: true, documentoId: true, colaboradorId: true, colaboradorNome: true, categoria: true, nome: true,
      caminho: true, dataVencimento: true, tamanho: true,
    },
  },
} as const;

type LinhaEnvio = NonNullable<Awaited<ReturnType<typeof carregarEnvio>>>;

async function carregarEnvio(id: string, empresaId: string) {
  return prisma.documentacaoEnvio.findFirst({ where: { id, empresaId }, select: SELECT_ENVIO });
}

export interface EnvioResumo {
  id: string;
  clienteId: string | null;
  clienteNome: string;
  contratoId: string | null;
  categorias: string[];
  organizacao: string;
  colaboradores: number;
  arquivos: number;
  link: SituacaoLink;
  /** O caminho público, só enquanto o link está ATIVO */
  caminho: string | null;
  expiraEm: string | null;
  revogadoEm: string | null;
  loteId: string | null;
  criadoEm: string;
  criadoPor: string | null;
}

type EnvioParaResumo = Omit<LinhaEnvio, "itens"> & { itens: { colaboradorId: string | null; colaboradorNome: string }[] };

function resumo(e: EnvioParaResumo, agora: Date = new Date()): EnvioResumo {
  const link = situacaoDoLink(e, agora);
  return {
    id: e.id, clienteId: e.clienteId, clienteNome: e.clienteNome, contratoId: e.contratoId,
    categorias: e.categorias, organizacao: e.organizacao,
    colaboradores: new Set(e.itens.map((i) => i.colaboradorId ?? i.colaboradorNome)).size,
    arquivos: e.itens.length,
    link,
    caminho: link === "ATIVO" && e.token ? caminhoPublicoDocumentacao(e.token) : null,
    expiraEm: e.expiraEm?.toISOString() ?? null,
    revogadoEm: e.revogadoEm?.toISOString() ?? null,
    loteId: e.loteId,
    criadoEm: e.criadoEm.toISOString(),
    criadoPor: e.criadoPor?.nome ?? null,
  };
}

/**
 * Grava um passo na linha do tempo. A hora é a de quem chama (`agora`), não o relógio do banco: a
 * linha do tempo, o prazo do link e a janela de "abriu de novo" precisam olhar o mesmo relógio.
 * Dois passos no mesmo instante (o pacote e o link nascem juntos) saem na ordem em que foram
 * gravados: quem lê desempata pelo id, que cresce a cada registro.
 */
async function registrar(
  envioId: string, tipo: TipoEvento, agora: Date, quem: { usuarioId?: string | null } & Origem = {}, detalhe?: unknown,
): Promise<void> {
  await prisma.documentacaoEnvioEvento.create({
    data: {
      envioId, tipo, criadoEm: agora,
      usuarioId: quem.usuarioId ?? null,
      ip: quem.ip ? String(quem.ip).slice(0, 80) : null,
      userAgent: quem.userAgent ? String(quem.userAgent).slice(0, 300) : null,
      detalhe: detalhe === undefined ? undefined : (detalhe as object),
    },
  });
}

export interface DadosEmail { para?: unknown; cc?: unknown; copiaParaMim?: boolean }

export interface DadosEnvio extends Selecao {
  via: string;
  validadeDias?: unknown;
  /** A pessoa viu a lista do que falta e quer gerar assim mesmo. Vencido não tem este atalho. */
  cienteDasFaltas?: boolean;
  email?: DadosEmail;
  loteId?: string | null;
}

export interface EnvioCriado { envio: EnvioResumo; email?: { ok: boolean; erro?: string; para: string[]; cc: string[] } }

/**
 * Monta o pacote e grava. A via decide o que acontece depois:
 *  - LINK: nasce o token, com a validade pedida;
 *  - EMAIL: nasce o token e o e-mail sai com o link (nunca com anexo);
 *  - ZIP: só grava — o arquivo é baixado na rota do zip, que registra o download.
 */
export async function criarEnvio(
  dados: DadosEnvio, ator: Ator, origem: Origem = {}, agora: Date = new Date(), base = "",
): Promise<EnvioCriado> {
  if (!viaValida(dados.via)) throw new ErroDocumentacao("Escolha como entregar: link, zip ou e-mail.", 400);
  const via: Via = dados.via;
  const s = await conferirSelecao(ator.empresaId, dados);

  // O e-mail é conferido ANTES de gravar: destinatário torto não deixa pacote órfão para trás.
  let destinatarios: { para: string[]; cc: string[] } | null = null;
  if (via === "EMAIL") destinatarios = await destinatariosDoEnvio(s.cliente.id, dados.email, ator);

  const d = diagnosticar(s.colaboradores, s.categorias, await candidatos(s.colaboradores.map((c) => c.id), s.categorias), agora);
  if (d.vencidos.length) throw new ErroDocumentacao(mensagemDeVencidos(d.vencidos), 409, { vencidos: d.vencidos });
  if (!d.itens.length) throw new ErroDocumentacao("Nenhum documento dos tipos marcados foi encontrado para estes colaboradores.", 409, { faltando: d.faltando });
  if (d.faltando.length && !dados.cienteDasFaltas) {
    throw new ErroDocumentacao(
      "Há colaborador sem documento de um dos tipos marcados. Confira a lista e confirme para gerar assim mesmo.",
      409, { faltando: d.faltando },
    );
  }
  if (d.itens.length > ITENS_MAX) throw new ErroDocumentacao(`O pacote passou de ${ITENS_MAX} arquivos. Divida em mais de um envio.`, 400);

  const caminhos = semRepetir(d.itens.map((i) => caminhoNoPacote(i, s.organizacao)));
  const comLink = via !== "ZIP";
  const dias = validadeDoLink(dados.validadeDias);

  const criado = await prisma.documentacaoEnvio.create({
    data: {
      empresaId: ator.empresaId,
      clienteId: s.cliente.id,
      clienteNome: s.cliente.nomeFantasia || s.cliente.nome,
      contratoId: s.contratoId,
      categorias: s.categorias,
      organizacao: s.organizacao,
      token: comLink ? novoToken() : null,
      expiraEm: comLink ? expiraEm(dias, agora) : null,
      loteId: limpo(dados.loteId) || null,
      criadoPorId: ator.usuarioId,
      criadoEm: agora,
      itens: {
        create: d.itens.map((i, n) => ({
          documentoId: i.documentoId, colaboradorId: i.colaboradorId, colaboradorNome: i.colaboradorNome,
          categoria: i.categoria, nome: i.nome, caminho: caminhos[n],
          dataVencimento: i.dataVencimento ? new Date(i.dataVencimento) : null, tamanho: i.tamanho,
        })),
      },
      eventos: {
        create: [
          { tipo: "CRIADO", usuarioId: ator.usuarioId, criadoEm: agora, detalhe: { via, arquivos: d.itens.length, faltando: d.faltando.length } },
          ...(comLink ? [{ tipo: "LINK_GERADO", usuarioId: ator.usuarioId, criadoEm: agora, detalhe: { dias } }] : []),
        ],
      },
    },
    select: { id: true },
  });

  let email: EnvioCriado["email"];
  if (via === "EMAIL" && destinatarios) {
    email = await despacharEmail((await carregarEnvio(criado.id, ator.empresaId))!, destinatarios, ator, base, agora);
  }
  return { envio: resumo((await carregarEnvio(criado.id, ator.empresaId))!, agora), email };
}

/* ───────────────────────── o e-mail ───────────────────────── */

/**
 * Os destinatários de UM envio: o que a tela mandou ou, sem nada, os contatos do cadastro do
 * cliente DESTE envio. "Cópia para mim" acrescenta o e-mail de quem está enviando.
 */
async function destinatariosDoEnvio(
  clienteId: string, email: DadosEmail | undefined, ator: Ator,
): Promise<{ para: string[]; cc: string[] }> {
  const informouPara = email?.para !== undefined && limpo(Array.isArray(email.para) ? email.para.join(",") : email.para) !== "";
  const sugeridos = informouPara ? null : await emailsSugeridos(clienteId);
  // A cópia que a pessoa digitou vale sempre (lista ou texto); sem "Para" informado, soma-se à do cadastro
  const cc: string[] = [...(informouPara ? [] : sugeridos?.cc ?? []), ...limparEmails(email?.cc)];

  if (email?.copiaParaMim) {
    const eu = await prisma.usuario.findFirst({ where: { id: ator.usuarioId, empresaId: ator.empresaId }, select: { email: true } });
    if (eu?.email) cc.push(eu.email);
  }

  const conferido = conferirDestinatarios(informouPara ? email?.para : sugeridos?.para, cc);
  if (!conferido.ok) {
    throw new ErroDocumentacao(
      informouPara ? conferido.erro : "O cliente não tem e-mail no cadastro. Informe o e-mail de destino.", 400,
    );
  }
  return conferido.valor;
}

/** Manda o e-mail com o LINK (nunca anexo) e grava o resultado na linha do tempo. */
async function despacharEmail(
  e: LinhaEnvio, dest: { para: string[]; cc: string[] }, ator: Ator, base: string, agora: Date,
): Promise<NonNullable<EnvioCriado["email"]>> {
  const empresa = await prisma.empresa.findUnique({ where: { id: e.empresaId }, select: { email: true } });
  const colaboradores = new Set(e.itens.map((i) => i.colaboradorId ?? i.colaboradorNome)).size;
  const r = await enviarEmail(e.empresaId, {
    tipo: "DOCUMENTACAO_EQUIPE",
    para: dest.para,
    cc: dest.cc,
    // A resposta do cliente tem de chegar na empresa, não no remetente do sistema
    responderPara: empresa?.email ?? null,
    variaveis: {
      cliente_nome: e.clienteNome,
      quantidade_colaboradores: String(colaboradores),
      link_documento: `${base.replace(/\/$/, "")}${caminhoPublicoDocumentacao(e.token!)}`,
      validade_link: e.expiraEm ? formatarData(e.expiraEm) : "",
    },
    referenciaId: e.id,
    referenciaTipo: "DOCUMENTACAO_ENVIO",
  });
  await registrar(e.id, r.ok ? "EMAIL_ENVIADO" : "EMAIL_FALHOU", agora, { usuarioId: ator.usuarioId }, { para: dest.para, cc: dest.cc, erro: r.erro ?? null });
  return { ok: r.ok, erro: r.erro, para: dest.para, cc: dest.cc };
}

/* ───────────────────────── o que ainda vale ───────────────────────── */

/** Os itens do envio cujo arquivo continua na ficha (não excluído), com os bytes. */
async function arquivosVivos(e: LinhaEnvio) {
  const ids = e.itens.map((i) => i.documentoId).filter((x): x is string => !!x);
  if (!ids.length) return new Map<string, { arquivoUrl: string | null; nome: string; criadoEm: Date }>();
  const docs = await prisma.colaboradorDocumento.findMany({
    where: { id: { in: ids }, excluidoEm: null },
    select: { id: true, arquivoUrl: true, nome: true, criadoEm: true },
  });
  return new Map(docs.map((d) => [d.id, d]));
}

/**
 * Antes de dar vida nova a um pacote antigo (link novo, e-mail de novo), confere se algo venceu
 * desde o envio. "Vencido não sai" vale para o reenvio também.
 */
function exigirSemVencido(e: LinhaEnvio, agora: Date) {
  const vencidos = e.itens.filter((i) => situacaoValidade(i.dataVencimento, agora).situacao === "VENCIDO");
  if (!vencidos.length) return;
  throw new ErroDocumentacao(
    "Este pacote tem documento que venceu depois do envio. Monte um pacote novo com a documentação atualizada.",
    409, { vencidos: vencidos.map((i) => ({ colaboradorNome: i.colaboradorNome, categoria: i.categoria, nome: i.nome })) },
  );
}

const EXTENSAO: Record<string, string> = {
  "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png",
  "image/webp": ".webp", "image/heic": ".heic", "image/gif": ".gif",
};

/** O nome com a extensão que os BYTES dizem — nunca a que o nome prometia. */
function comExtensao(caminho: string, tipo: string | null): string {
  const ext = tipo ? EXTENSAO[tipo] : undefined;
  if (!ext) return caminho;
  return caminho.toLowerCase().endsWith(ext) ? caminho : `${caminho.replace(/\.(pdf|jpe?g|png|webp|heic|gif)$/i, "")}${ext}`;
}

async function montarZipDoEnvio(e: LinhaEnvio, agora: Date): Promise<ArquivoGerado & { arquivos: number }> {
  const vivos = await arquivosVivos(e);
  const arquivos: ArquivoZip[] = [];
  for (const item of e.itens) {
    const doc = item.documentoId ? vivos.get(item.documentoId) : undefined;
    const bytes = doc?.arquivoUrl ? decodificarDataUrl(doc.arquivoUrl) : null;
    if (!bytes) continue; // arquivo excluído da ficha depois do envio não é entregue
    arquivos.push({ nome: comExtensao(item.caminho, identificarTipo(bytes, item.nome)), bytes, data: doc!.criadoEm });
  }
  if (!arquivos.length) throw new ErroDocumentacao("Os arquivos deste pacote não estão mais disponíveis.", 409);
  return {
    bytes: montarZip(arquivos, agora),
    arquivos: arquivos.length,
    nomeArquivo: `Documentacao - ${e.clienteNome}.zip`.replace(/\s+/g, " "),
  };
}

/* ───────────────────────── ações da empresa ───────────────────────── */

async function exigirEnvio(id: string, empresaId: string): Promise<LinhaEnvio> {
  const e = await carregarEnvio(id, empresaId);
  if (!e) throw new ErroDocumentacao(MSG_NAO_ENCONTRADO, 404);
  return e;
}

/** O zip do pacote, para quem é da empresa. Registra o download. */
export async function zipDoEnvio(id: string, ator: Ator, agora: Date = new Date()): Promise<ArquivoGerado> {
  const e = await exigirEnvio(id, ator.empresaId);
  exigirSemVencido(e, agora);
  const zip = await montarZipDoEnvio(e, agora);
  await registrar(e.id, "ZIP_BAIXADO", agora, { usuarioId: ator.usuarioId }, { arquivos: zip.arquivos });
  return zip;
}

/**
 * Gera o link — para um pacote que nasceu em zip, ou no lugar de um que expirou ou foi revogado.
 * Link ATIVO não é trocado: quem já recebeu não fica com o endereço morto na mão. Link novo é
 * sempre TOKEN novo: o que expirou ou foi revogado não volta a valer.
 */
export async function gerarLink(id: string, validadeDias: unknown, ator: Ator, agora: Date = new Date()): Promise<EnvioResumo> {
  const e = await exigirEnvio(id, ator.empresaId);
  if (situacaoDoLink(e, agora) === "ATIVO") return resumo(e, agora);
  exigirSemVencido(e, agora);
  const dias = validadeDoLink(validadeDias);
  await prisma.documentacaoEnvio.update({
    where: { id: e.id },
    data: { token: novoToken(), expiraEm: expiraEm(dias, agora), revogadoEm: null, revogadoPorId: null },
  });
  await registrar(e.id, "LINK_GERADO", agora, { usuarioId: ator.usuarioId }, { dias });
  return resumo(await exigirEnvio(id, ator.empresaId), agora);
}

/** Revogar: o link morre na hora, o histórico fica. Revogar duas vezes não muda nada. */
export async function revogarLink(id: string, ator: Ator, agora: Date = new Date()): Promise<EnvioResumo> {
  const e = await exigirEnvio(id, ator.empresaId);
  if (!e.token) throw new ErroDocumentacao("Este pacote não tem link para revogar.", 409);
  if (!e.revogadoEm) {
    const r = await prisma.documentacaoEnvio.updateMany({
      where: { id: e.id, empresaId: ator.empresaId, revogadoEm: null },
      data: { revogadoEm: agora, revogadoPorId: ator.usuarioId },
    });
    if (r.count) await registrar(e.id, "REVOGADO", agora, { usuarioId: ator.usuarioId });
  }
  return resumo(await exigirEnvio(id, ator.empresaId), agora);
}

/**
 * Manda (ou manda de novo) o e-mail de um pacote. Se o link não está mais ativo, nasce um novo
 * junto — e a conferência de vencido vale aqui como em qualquer outro caminho.
 */
export async function enviarEmailDoEnvio(
  id: string, dados: DadosEmail & { validadeDias?: unknown }, ator: Ator, agora: Date = new Date(), base = "",
): Promise<EnvioCriado> {
  let e = await exigirEnvio(id, ator.empresaId);
  if (!e.clienteId) throw new ErroDocumentacao("O cliente deste pacote não existe mais.", 409);
  exigirSemVencido(e, agora);
  const dest = await destinatariosDoEnvio(e.clienteId, dados, ator);
  if (situacaoDoLink(e, agora) !== "ATIVO") {
    await gerarLink(id, dados.validadeDias, ator, agora);
    e = await exigirEnvio(id, ator.empresaId);
  }
  const email = await despacharEmail(e, dest, ator, base, agora);
  return { envio: resumo(await exigirEnvio(id, ator.empresaId), agora), email };
}

/* ───────────────────────── histórico ───────────────────────── */

/** Para a LISTA: do item só o que conta (quantos arquivos, de quantas pessoas). */
const SELECT_DA_LISTA = {
  ...SELECT_ENVIO,
  itens: { select: { colaboradorId: true, colaboradorNome: true } },
} as const;

/** O filtro da lista pela situação do link — a mesma conta de `situacaoDoLink`, em SQL. */
function wherePorSituacao(situacao: string | null | undefined, agora: Date) {
  switch (situacao) {
    case "SEM_LINK": return { token: null };
    case "REVOGADO": return { token: { not: null }, revogadoEm: { not: null } };
    case "EXPIRADO": return { token: { not: null }, revogadoEm: null, OR: [{ expiraEm: null }, { expiraEm: { lte: agora } }] };
    case "ATIVO": return { token: { not: null }, revogadoEm: null, expiraEm: { gt: agora } };
    default: return {};
  }
}

/** O envio na LISTA: o resumo, as vias usadas e a prova de recebimento (quando o cliente abriu e baixou). */
export interface EnvioDaLista extends EnvioResumo {
  vias: Via[];
  clienteAbriuEm: string | null;
  clienteBaixouEm: string | null;
}

const VIA_DO_EVENTO: Partial<Record<string, Via>> = { LINK_GERADO: "LINK", ZIP_BAIXADO: "ZIP", EMAIL_ENVIADO: "EMAIL" };

export async function listarEnvios(
  empresaId: string,
  filtro: { clienteId?: string | null; busca?: string | null; situacao?: string | null; pagina?: number; porPagina?: number } = {},
  agora: Date = new Date(),
): Promise<{ envios: EnvioDaLista[]; total: number }> {
  const porPagina = Math.min(Math.max(Math.trunc(filtro.porPagina ?? 50), 1), 100);
  const pagina = Math.max(Math.trunc(filtro.pagina ?? 1), 1);
  const busca = limpo(filtro.busca);
  const where = {
    empresaId,
    ...(filtro.clienteId ? { clienteId: filtro.clienteId } : {}),
    ...(busca ? { clienteNome: { contains: busca, mode: "insensitive" as const } } : {}),
    ...wherePorSituacao(filtro.situacao, agora),
  };
  const [linhas, total] = await Promise.all([
    prisma.documentacaoEnvio.findMany({ where, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], skip: (pagina - 1) * porPagina, take: porPagina, select: SELECT_DA_LISTA }),
    prisma.documentacaoEnvio.count({ where }),
  ]);

  // Uma consulta só para a página inteira: o que aconteceu com cada envio, e quando foi a última vez
  const resumoDosEventos = linhas.length
    ? await prisma.documentacaoEnvioEvento.groupBy({
        by: ["envioId", "tipo"], where: { envioId: { in: linhas.map((l) => l.id) } }, _max: { criadoEm: true },
      })
    : [];
  const porEnvio = new Map<string, Map<string, Date | null>>();
  for (const g of resumoDosEventos) {
    if (!porEnvio.has(g.envioId)) porEnvio.set(g.envioId, new Map());
    porEnvio.get(g.envioId)!.set(g.tipo, g._max.criadoEm);
  }

  return {
    total,
    envios: linhas.map((l) => {
      const ev = porEnvio.get(l.id) ?? new Map<string, Date | null>();
      const baixou = [ev.get("DOWNLOAD"), ev.get("DOWNLOAD_ZIP")].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        ...resumo(l, agora),
        vias: (["LINK", "ZIP", "EMAIL"] as Via[]).filter((v) => [...ev.keys()].some((tipo) => VIA_DO_EVENTO[tipo] === v)),
        clienteAbriuEm: ev.get("ACESSO")?.toISOString() ?? null,
        clienteBaixouEm: baixou?.toISOString() ?? null,
      };
    }),
  };
}

export interface EventoDaLinha {
  id: string; tipo: string; em: string; por: string | null; ip: string | null; navegador: string | null; detalhe: unknown;
}

export interface EnvioDetalhe extends EnvioResumo {
  itens: { id: string; colaboradorNome: string; categoria: string; categoriaRotulo: string; nome: string; caminho: string; dataVencimento: string | null; tamanho: number | null; vencido: boolean; disponivel: boolean }[];
  eventos: EventoDaLinha[];
}

/** O envio inteiro: o que foi, para quem, e a linha do tempo (os 200 eventos mais recentes). */
export async function detalheDoEnvio(id: string, empresaId: string, agora: Date = new Date()): Promise<EnvioDetalhe> {
  const e = await exigirEnvio(id, empresaId);
  const vivos = await arquivosVivos(e);
  const eventos = await prisma.documentacaoEnvioEvento.findMany({
    where: { envioId: e.id }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 200,
    select: { id: true, tipo: true, criadoEm: true, ip: true, userAgent: true, detalhe: true, usuario: { select: { nome: true } } },
  });
  return {
    ...resumo(e, agora),
    itens: e.itens.map((i) => ({
      id: i.id, colaboradorNome: i.colaboradorNome, categoria: i.categoria, categoriaRotulo: rotuloCategoria({ categoria: i.categoria }),
      nome: i.nome, caminho: i.caminho, dataVencimento: i.dataVencimento?.toISOString() ?? null, tamanho: i.tamanho,
      vencido: situacaoValidade(i.dataVencimento, agora).situacao === "VENCIDO",
      disponivel: !!(i.documentoId && vivos.get(i.documentoId)?.arquivoUrl),
    })),
    eventos: eventos.map((v) => ({
      id: v.id, tipo: v.tipo, em: v.criadoEm.toISOString(), por: v.usuario?.nome ?? null,
      ip: v.ip, navegador: v.userAgent, detalhe: v.detalhe,
    })),
  };
}

/* ───────────────────────── o lote ───────────────────────── */

export interface ResultadoDoLote {
  loteId: string;
  resultados: ({ clienteId: string; ok: true; envio: EnvioResumo; email?: EnvioCriado["email"] } | { clienteId: string; ok: false; erro: string; detalhe?: unknown })[];
}

/**
 * Vários clientes de uma vez (a renovação anual). Por dentro é UM ENVIO POR CLIENTE: cada um com
 * o seu token, os seus documentos e os seus destinatários. Um cliente que não pode ser enviado
 * (documento vencido, sem e-mail) não segura os outros — volta com o motivo.
 *
 * Zip não entra em lote: é download de quem está na tela, um por vez.
 */
export async function criarLote(
  bruto: { envios?: unknown; via?: unknown; validadeDias?: unknown; copiaParaMim?: unknown },
  ator: Ator, origem: Origem = {}, agora: Date = new Date(), base = "",
): Promise<ResultadoDoLote> {
  const via = String(bruto.via ?? "");
  if (via !== "LINK" && via !== "EMAIL") throw new ErroDocumentacao("O envio em lote é por link ou por e-mail.", 400);
  const envios = Array.isArray(bruto.envios) ? bruto.envios : [];
  if (!envios.length) throw new ErroDocumentacao("Escolha pelo menos um cliente.", 400);
  if (envios.length > CLIENTES_NO_LOTE_MAX) throw new ErroDocumentacao(`No máximo ${CLIENTES_NO_LOTE_MAX} clientes por lote.`, 400);

  const pedidos = envios.map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : {}));
  const clientes = pedidos.map((p) => limpo(p.clienteId));
  // O mesmo cliente duas vezes no lote é erro de quem montou: dois links para o mesmo destino
  if (new Set(clientes).size !== clientes.length) throw new ErroDocumentacao("O mesmo cliente aparece mais de uma vez no lote.", 400);

  const loteId = randomBytes(12).toString("base64url");
  const resultados: ResultadoDoLote["resultados"] = [];
  for (const pedido of pedidos) {
    const clienteId = limpo(pedido.clienteId);
    const emailDoPedido = pedido.email && typeof pedido.email === "object" ? (pedido.email as Record<string, unknown>) : {};
    try {
      const r = await criarEnvio({
        ...lerSelecao(pedido),
        via, loteId,
        validadeDias: bruto.validadeDias,
        cienteDasFaltas: pedido.cienteDasFaltas === true,
        // Os destinatários são os DESTE cliente: os do pedido dele ou os do cadastro dele
        email: { para: emailDoPedido.para, cc: emailDoPedido.cc, copiaParaMim: bruto.copiaParaMim === true },
      }, ator, origem, agora, base);
      resultados.push({ clienteId, ok: true, envio: r.envio, email: r.email });
    } catch (e) {
      if (!(e instanceof ErroDocumentacao)) throw e;
      resultados.push({ clienteId, ok: false, erro: e.message, detalhe: e.detalhe });
    }
  }
  return { loteId, resultados };
}

/* ───────────────────────── o link público ───────────────────────── */

const SELECT_PUBLICO = {
  ...SELECT_ENVIO,
  empresa: { select: { nome: true, nomeFantasia: true, logo: true } },
} as const;

type LinhaPublica = NonNullable<Awaited<ReturnType<typeof porToken>>>;

async function porToken(token: string) {
  const t = limpo(token);
  if (!t) return null;
  return prisma.documentacaoEnvio.findUnique({ where: { token: t }, select: SELECT_PUBLICO });
}

/** O envio de um link que ainda vale. Não existe → 404; expirou ou foi revogado → 410. */
async function linkVivo(token: string, agora: Date): Promise<LinhaPublica> {
  const e = await porToken(token);
  if (!e) throw new ErroDocumentacao(MSG_LINK_INDISPONIVEL, 404);
  const situacao = situacaoDoLink(e, agora);
  if (situacao !== "ATIVO") {
    const motivo: MotivoDoLink = situacao === "REVOGADO" ? "REVOGADO" : "EXPIRADO";
    const empresa = e.empresa.nomeFantasia || e.empresa.nome;
    throw new ErroDocumentacao(mensagemDoLink(motivo, empresa, e.expiraEm), 410, { motivo, empresa });
  }
  return e;
}

export interface DocumentacaoPublica {
  empresa: { nome: string; logo: string | null };
  cliente: string;
  expiraEm: string;
  organizacao: string;
  itens: { id: string; colaboradorNome: string; categoriaRotulo: string; nome: string; caminho: string; tamanho: number | null; dataVencimento: string | null; vencido: boolean }[];
}

/** De quanto em quanto tempo a mesma origem volta a contar como "abriu o link". */
const JANELA_DE_ACESSO_MS = 5 * 60 * 1000;

/**
 * O cliente abriu o link: devolve SÓ o que este envio tem — os itens gravados nele, e nada mais.
 * O que foi excluído da ficha depois do envio some da lista. Registra o acesso.
 */
export async function abrirDocumentacao(token: string, origem: Origem = {}, agora: Date = new Date()): Promise<DocumentacaoPublica> {
  const e = await linkVivo(token, agora);
  const vivos = await arquivosVivos(e);

  // O mesmo aparelho recarregando a página não enche a linha do tempo
  const recente = await prisma.documentacaoEnvioEvento.findFirst({
    where: { envioId: e.id, tipo: "ACESSO", ip: origem.ip ?? null, criadoEm: { gte: new Date(agora.getTime() - JANELA_DE_ACESSO_MS) } },
    select: { id: true },
  });
  if (!recente) await registrar(e.id, "ACESSO", agora, origem);

  return {
    empresa: { nome: e.empresa.nomeFantasia || e.empresa.nome, logo: e.empresa.logo },
    cliente: e.clienteNome,
    expiraEm: e.expiraEm!.toISOString(),
    organizacao: e.organizacao,
    itens: e.itens
      .filter((i) => i.documentoId && vivos.get(i.documentoId)?.arquivoUrl)
      .map((i) => ({
        id: i.id, colaboradorNome: i.colaboradorNome, categoriaRotulo: rotuloCategoria({ categoria: i.categoria }),
        nome: i.nome, caminho: i.caminho, tamanho: i.tamanho,
        dataVencimento: i.dataVencimento?.toISOString() ?? null,
        vencido: situacaoValidade(i.dataVencimento, agora).situacao === "VENCIDO",
      })),
  };
}

export interface ArquivoPublico { bytes: Uint8Array; tipo: string; nomeArquivo: string }

/**
 * UM arquivo do pacote, pelo link. O id é o do ITEM do envio — não o do documento: quem tem o
 * link de um pacote não consegue pedir arquivo de outro pacote, de outro colaborador ou de outra
 * gaveta trocando um id na URL.
 */
export async function arquivoDaDocumentacao(
  token: string, itemId: string, origem: Origem = {}, agora: Date = new Date(),
): Promise<ArquivoPublico> {
  const e = await linkVivo(token, agora);
  const item = e.itens.find((i) => i.id === limpo(itemId));
  if (!item?.documentoId) throw new ErroDocumentacao("Arquivo não encontrado.", 404);
  const doc = (await arquivosVivos(e)).get(item.documentoId);
  const bytes = doc?.arquivoUrl ? decodificarDataUrl(doc.arquivoUrl) : null;
  if (!bytes) throw new ErroDocumentacao("Arquivo não encontrado.", 404);

  const tipo = identificarTipo(bytes, item.nome) ?? "application/octet-stream";
  await registrar(e.id, "DOWNLOAD", agora, origem, { itemId: item.id, caminho: item.caminho });
  return { bytes, tipo, nomeArquivo: comExtensao(item.caminho.split("/").pop() || item.nome, tipo) };
}

/** O pacote inteiro em zip, pelo link — com as mesmas pastas que a empresa escolheu. */
export async function zipDaDocumentacao(token: string, origem: Origem = {}, agora: Date = new Date()): Promise<ArquivoGerado> {
  const e = await linkVivo(token, agora);
  const zip = await montarZipDoEnvio(e, agora);
  await registrar(e.id, "DOWNLOAD_ZIP", agora, origem, { arquivos: zip.arquivos });
  return zip;
}
