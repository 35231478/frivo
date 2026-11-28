/**
 * ADMISSÃO DIGITAL — o lado do SERVIDOR. As regras puras estão em lib/admissao/admissao.
 *
 * O RH (permissão "Admissão digital › gerenciar"):
 *   - `criarAdmissao`: o convite NASCE de um pré-cadastro (nome + CPF + cargo + salário). Nenhum
 *     colaborador é criado por um link solto: quem abre o link já existe no cadastro, e o CPF que
 *     ele digita tem de casar com o do pré-cadastro;
 *   - `reenviarConvite` (prazo novo e e-mail de novo), `invalidarConvite` (o link morre agora),
 *     `cancelarAdmissao` (muda a situação e guarda a razão — NUNCA apaga);
 *   - `marcarEnviadoContador` e `marcarAdmitido`: os dois últimos marcos.
 *
 * O colaborador, pelo LINK (sem login, sem usuário no sistema):
 *   - `abrirAdmissao`: o que a tela pública pode ver — e só isso (nada de outro colaborador);
 *   - `consentir`: LGPD na entrada, com data/hora, IP e navegador. Sem isto o formulário não abre;
 *   - `salvarRascunho`: fecha e volta sem perder nada (o JSON é reconstruído campo a campo);
 *   - `enviarCodigoEmail` / `conferirCodigoEmail`: o e-mail é verificado por código (o banco guarda
 *     o HASH do código, nunca o código);
 *   - `enviarDocumento` / `removerDocumento`: os documentos que a empresa pede, nos anexos do
 *     colaborador, pelo mesmo caminho dos outros anexos (tipo decidido pelos bytes);
 *   - `concluirPreenchimento`: passa o que foi preenchido para o cadastro do colaborador e pede
 *     a assinatura;
 *   - `assinar`: nome digitado + IP + navegador + data/hora + selfie, com troca ATÔMICA de situação
 *     (dois cliques não assinam duas vezes), e o texto do contrato CONGELADO como prova.
 *
 * O contrato sai do MODELO DA EMPRESA: o sistema só preenche campos. Empresa sem modelo não assina
 * nada — nenhuma cláusula é inventada.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { faixasDoColaborador, textoDaJornada } from "@/lib/colaborador/jornada";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cpfValido, digitos, formatarDocumento } from "@/lib/documento";
import { formatarData, formatarMoeda, whatsappLink } from "@/lib/utils";
import { emailConfigAtiva, enviarEmail, enviarEmailInterno } from "@/lib/email";
import { validarDataUrl, validarFoto } from "@/lib/anexos-server";
import { categoriaDoPedido } from "@/lib/colaborador/documentos";
import {
  CODIGO_MAX_TENTATIVAS, CODIGO_TAMANHO, CODIGO_VALIDADE_MIN, DOCUMENTOS_PADRAO, MSG_CANCELADA,
  MSG_CODIGO_ERRADO, MSG_CODIGO_FORMATO, MSG_CODIGO_VENCIDO, MSG_EMAIL_NAO_VERIFICADO,
  MSG_JA_ASSINADO, MSG_LINK_INVALIDO, MSG_MOTIVO, MSG_SEM_CONSENTIMENTO, MSG_VALIDADE,
  ROTULO_SITUACAO, VALIDADE_PADRAO, caminhoPublicoAdmissao, codigoValido, documentosDaEmpresa,
  emailConfere, enderecoEmLinha, etapaPendente, expiraEm, faltaNaEtapa, linkValido, montarContrato,
  motivoValido, normalizarForm, obrigatoriosDa, podeIr, podeReenviar, validadeValida,
  type DadosContrato, type DocumentoPedido, type Etapa, type FormAdmissao, type SituacaoAdmissao,
} from "@/lib/admissao/admissao";

export class ErroAdmissao extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const TEMPLATE_CONVITE = "ADMISSAO_CONVITE";
export const TEMPLATE_CODIGO = "ADMISSAO_CODIGO";

/** Token do link: 32 bytes de verdade (o aceite da OS usa 24; aqui o dado é mais sensível). */
const novoToken = () => randomBytes(32).toString("base64url");
const novoCodigo = () => String(randomInt(0, 10 ** CODIGO_TAMANHO)).padStart(CODIGO_TAMANHO, "0");
const hashCodigo = (c: string) => createHash("sha256").update(c.trim()).digest("hex");
const limpo = (v: string | null | undefined) => (v ?? "").trim();
const navegador = (ua: string | null | undefined) => limpo(ua).slice(0, 300) || null;
const minutos = (m: number, de: Date) => new Date(de.getTime() + m * 60_000);

export interface OrigemPublica { ip?: string | null; userAgent?: string | null }

/**
 * O formulário da admissão: o rascunho reconstruído campo a campo. Rascunho vazio (o colaborador
 * ainda não salvou nada) começa com o nome do pré-cadastro — o resto é ele quem preenche.
 */
function formDaAdmissao(rascunho: unknown, nomeDoCadastro: string): FormAdmissao {
  const f = normalizarForm(rascunho);
  if (!rascunho) f.nome = nomeDoCadastro;
  return f;
}

/* ───────────────────────── configuração por empresa ───────────────────────── */

export interface ConfigAdmissao {
  contratoModelo: string;
  orientacoes: string;
  documentos: DocumentoPedido[];
  validadeDias: number;
  experienciaDias: number;
  experienciaProrrogacaoDias: number;
}

export const CONFIG_PADRAO: ConfigAdmissao = {
  contratoModelo: "", orientacoes: "", documentos: DOCUMENTOS_PADRAO,
  validadeDias: VALIDADE_PADRAO, experienciaDias: 45, experienciaProrrogacaoDias: 45,
};

/** A configuração da empresa, com o padrão onde ela ainda não mexeu. */
export async function configDaEmpresa(empresaId: string): Promise<ConfigAdmissao> {
  const c = await prisma.admissaoConfig.findUnique({ where: { empresaId } });
  if (!c) return { ...CONFIG_PADRAO };
  return {
    contratoModelo: c.contratoModelo ?? "",
    orientacoes: c.orientacoes ?? "",
    documentos: documentosDaEmpresa(c.documentos),
    validadeDias: c.validadeDias,
    experienciaDias: c.experienciaDias,
    experienciaProrrogacaoDias: c.experienciaProrrogacaoDias,
  };
}

export interface ConfigEntrada {
  contratoModelo?: string;
  orientacoes?: string;
  documentos?: DocumentoPedido[];
  validadeDias?: number;
  experienciaDias?: number;
  experienciaProrrogacaoDias?: number;
}

const diasExperiencia = (v: number | undefined, atual: number) =>
  v === undefined ? atual : Math.min(90, Math.max(0, Math.floor(v)));

/** Salva a configuração da empresa (uma linha por empresa; nasce na primeira gravação). */
export async function salvarConfig(empresaId: string, dados: ConfigEntrada): Promise<ConfigAdmissao> {
  if (dados.validadeDias !== undefined && !validadeValida(dados.validadeDias)) throw new ErroAdmissao(MSG_VALIDADE, 400);
  const atual = await configDaEmpresa(empresaId);
  const docs = dados.documentos ? documentosDaEmpresa(dados.documentos) : atual.documentos;
  const valores = {
    contratoModelo: dados.contratoModelo ?? atual.contratoModelo,
    orientacoes: dados.orientacoes ?? atual.orientacoes,
    documentos: docs as unknown as Prisma.InputJsonValue,
    validadeDias: dados.validadeDias ?? atual.validadeDias,
    experienciaDias: diasExperiencia(dados.experienciaDias, atual.experienciaDias),
    experienciaProrrogacaoDias: diasExperiencia(dados.experienciaProrrogacaoDias, atual.experienciaProrrogacaoDias),
  };
  await prisma.admissaoConfig.upsert({
    where: { empresaId }, create: { empresaId, ...valores }, update: valores,
  });
  return configDaEmpresa(empresaId);
}

/* ───────────────────────── o que cada lado lê ───────────────────────── */

const SELECT_RH = {
  id: true, token: true, situacao: true, expiraEm: true, etapa: true, envios: true,
  enviadoEm: true, enviadoCanal: true, enviadoPara: true, abertoEm: true, consentimentoEm: true,
  concluidoEm: true, assinaturaEm: true, assinaturaNome: true, assinaturaIp: true,
  emailVerificado: true, canceladaEm: true, cancelamentoMotivo: true,
  enviadoContadorEm: true, admitidoEm: true, criadoEm: true,
  criadoPor: { select: { nome: true } },
  canceladaPor: { select: { nome: true } },
  colaborador: { select: { id: true, nome: true, cpf: true, email: true, telefone: true, cargo: { select: { nome: true } } } },
} satisfies Prisma.AdmissaoSelect;

type LinhaRh = Prisma.AdmissaoGetPayload<{ select: typeof SELECT_RH }>;

export interface AdmissaoDoRh {
  id: string;
  /** O link inteiro só é montado pela rota (ela conhece a origem da requisição) */
  token: string;
  situacao: SituacaoAdmissao;
  situacaoRotulo: string;
  expiraEm: string;
  expirado: boolean;
  etapa: string | null;
  envios: number;
  enviadoEm: string | null; enviadoCanal: string | null; enviadoPara: string | null;
  abertoEm: string | null; consentimentoEm: string | null; concluidoEm: string | null;
  assinaturaEm: string | null; assinaturaNome: string | null; assinaturaIp: string | null;
  emailVerificado: string | null;
  canceladaEm: string | null; cancelamentoMotivo: string | null; canceladaPor: string | null;
  enviadoContadorEm: string | null; admitidoEm: string | null;
  criadoEm: string; criadoPor: string | null;
  colaborador: { id: string; nome: string; cpf: string; email: string | null; telefone: string; cargo: string | null };
  /** Quantos documentos obrigatórios a empresa pede e quantos já chegaram */
  documentosEnviados: number; documentosObrigatorios: number;
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

function serializarRh(a: LinhaRh, docs: { enviados: number; obrigatorios: number }, agora: Date): AdmissaoDoRh {
  return {
    id: a.id, token: a.token, situacao: a.situacao as SituacaoAdmissao,
    situacaoRotulo: ROTULO_SITUACAO[a.situacao as SituacaoAdmissao] ?? a.situacao,
    expiraEm: a.expiraEm.toISOString(), expirado: a.expiraEm.getTime() <= agora.getTime(),
    etapa: a.etapa, envios: a.envios,
    enviadoEm: iso(a.enviadoEm), enviadoCanal: a.enviadoCanal, enviadoPara: a.enviadoPara,
    abertoEm: iso(a.abertoEm), consentimentoEm: iso(a.consentimentoEm), concluidoEm: iso(a.concluidoEm),
    assinaturaEm: iso(a.assinaturaEm), assinaturaNome: a.assinaturaNome, assinaturaIp: a.assinaturaIp,
    emailVerificado: a.emailVerificado,
    canceladaEm: iso(a.canceladaEm), cancelamentoMotivo: a.cancelamentoMotivo, canceladaPor: a.canceladaPor?.nome ?? null,
    enviadoContadorEm: iso(a.enviadoContadorEm), admitidoEm: iso(a.admitidoEm),
    criadoEm: a.criadoEm.toISOString(), criadoPor: a.criadoPor?.nome ?? null,
    colaborador: {
      id: a.colaborador.id, nome: a.colaborador.nome, cpf: a.colaborador.cpf,
      email: a.colaborador.email, telefone: a.colaborador.telefone, cargo: a.colaborador.cargo?.nome ?? null,
    },
    documentosEnviados: docs.enviados, documentosObrigatorios: docs.obrigatorios,
  };
}

/** Os documentos que já chegaram desta admissão (tipo = id do documento pedido pela empresa). */
async function documentosDa(colaboradorId: string, pedidos: DocumentoPedido[]) {
  const ids = pedidos.map((d) => d.id);
  if (!ids.length) return [];
  return prisma.colaboradorDocumento.findMany({
    // `excluidoEm: null`: documento excluído na ficha não conta mais como entregue na admissão.
    where: { colaboradorId, excluidoEm: null, tipo: { in: ids } },
    select: { id: true, tipo: true, nome: true, criadoEm: true }, orderBy: { criadoEm: "asc" },
  });
}

async function contagemDocs(colaboradorId: string, cfg: ConfigAdmissao) {
  const obrigatorios = obrigatoriosDa(cfg.documentos);
  const linhas = await documentosDa(colaboradorId, cfg.documentos);
  const enviados = new Set(linhas.map((l) => l.tipo));
  return { enviados: obrigatorios.filter((id) => enviados.has(id)).length, obrigatorios: obrigatorios.length };
}

/* ───────────────────────── RH: criar, reenviar, invalidar, cancelar ───────────────────────── */

/** Situações em que a admissão ainda está de pé (não deixa abrir uma segunda para o mesmo colaborador). */
const VIVAS: SituacaoAdmissao[] = ["CONVIDADO", "PREENCHENDO", "AGUARDANDO_ASSINATURA", "ASSINADO", "ENVIADO_CONTADOR"];

export interface NovaAdmissao {
  /** Colaborador já cadastrado (o convite sai da ficha dele) */
  colaboradorId?: string | null;
  /** Ou o pré-cadastro: o RH digita o essencial e o colaborador completa o resto */
  nome?: string; cpf?: string; telefone?: string; email?: string;
  cargoId?: string | null;
  salario?: number | null;
  dataAdmissao?: string | null;
  /** Validade do link em dias (padrão: a da empresa) */
  validadeDias?: number | null;
}

async function admissaoViva(empresaId: string, colaboradorId: string) {
  return prisma.admissao.findFirst({
    where: { empresaId, colaboradorId, situacao: { in: VIVAS } },
    select: { id: true, situacao: true },
  });
}

/**
 * Gera o convite. Com `colaboradorId` usa a ficha que já existe; sem ele, PRÉ-CADASTRA o
 * colaborador (nome + CPF + cargo + salário) — é daí que o link nasce, nunca do link para o
 * cadastro. O colaborador pré-cadastrado entra INATIVO e só passa a ATIVO ao ser admitido.
 */
export async function criarAdmissao(
  ator: { empresaId: string; usuarioId: string }, dados: NovaAdmissao, agora: Date = new Date(),
): Promise<AdmissaoDoRh> {
  const cfg = await configDaEmpresa(ator.empresaId);
  const dias = dados.validadeDias ?? cfg.validadeDias;
  if (!validadeValida(dias)) throw new ErroAdmissao(MSG_VALIDADE, 400);

  const cargoId = dados.cargoId ?? null;
  if (cargoId) {
    const cargo = await prisma.cargo.findFirst({ where: { id: cargoId, empresaId: ator.empresaId }, select: { id: true } });
    if (!cargo) throw new ErroAdmissao("Cargo não encontrado", 404);
  }
  const salario = dados.salario === null || dados.salario === undefined ? null : Number(dados.salario);
  if (salario !== null && (!Number.isFinite(salario) || salario < 0)) throw new ErroAdmissao("Salário inválido", 400);
  const dataAdmissao = dados.dataAdmissao ? new Date(dados.dataAdmissao) : null;
  if (dataAdmissao && Number.isNaN(dataAdmissao.getTime())) throw new ErroAdmissao("Data de admissão inválida", 400);

  let colaboradorId = limpo(dados.colaboradorId);
  if (colaboradorId) {
    const t = await prisma.tecnico.findFirst({ where: { id: colaboradorId, empresaId: ator.empresaId }, select: { id: true } });
    if (!t) throw new ErroAdmissao("Colaborador não encontrado", 404);
    const viva = await admissaoViva(ator.empresaId, colaboradorId);
    if (viva) {
      throw new ErroAdmissao(
        `Este colaborador já tem uma admissão em andamento (${ROTULO_SITUACAO[viva.situacao as SituacaoAdmissao]}). Cancele a atual para abrir outra.`, 409,
      );
    }
    await prisma.tecnico.update({
      where: { id: colaboradorId },
      data: {
        ...(cargoId && { cargoId }),
        ...(salario !== null && { salario }),
        ...(dataAdmissao && { dataAdmissao }),
      },
    });
  } else {
    const nome = limpo(dados.nome);
    const cpf = digitos(limpo(dados.cpf));
    if (nome.length < 3) throw new ErroAdmissao("Informe o nome completo do colaborador", 400);
    if (!cpfValido(cpf)) throw new ErroAdmissao("CPF inválido", 400);
    const jaExiste = await prisma.tecnico.findFirst({
      where: { cpf, empresaId: ator.empresaId }, select: { id: true, nome: true },
    });
    if (jaExiste) {
      throw new ErroAdmissao(
        `Já existe colaborador com este CPF (${jaExiste.nome}). Gere o convite pela ficha dele.`, 409,
      );
    }
    const criado = await prisma.tecnico.create({
      data: {
        empresaId: ator.empresaId, nome, cpf,
        // O cadastro exige telefone; o colaborador informa o dele na primeira etapa do link
        telefone: limpo(dados.telefone),
        email: limpo(dados.email) || null,
        cargoId, salario, dataAdmissao,
        // Pré-cadastrado não é quadro ativo: entra fora da operação e só é ativado ao ser admitido
        ativo: false, statusColaborador: "INATIVO",
      },
      select: { id: true },
    });
    colaboradorId = criado.id;
  }

  const criada = await prisma.admissao.create({
    data: {
      empresaId: ator.empresaId, colaboradorId, token: novoToken(),
      situacao: "CONVIDADO", expiraEm: expiraEm(dias, agora), criadoPorId: ator.usuarioId,
    },
    select: SELECT_RH,
  });
  return serializarRh(criada, await contagemDocs(colaboradorId, cfg), agora);
}

async function daEmpresa(empresaId: string, admissaoId: string) {
  const a = await prisma.admissao.findFirst({ where: { id: admissaoId, empresaId }, select: SELECT_RH });
  if (!a) throw new ErroAdmissao("Admissão não encontrada", 404);
  return a;
}

export interface EnvioDoConvite {
  admissao: AdmissaoDoRh;
  /** O link do colaborador (a rota monta com a origem da requisição) */
  url: string;
  mensagem: string;
  whatsappUrl: string | null;
  emailEnviado: boolean; emailPara: string | null; erroEmail: string | null;
}

const mensagemConvite = (p: { nome: string; empresa: string; url: string }) =>
  `Olá, ${p.nome}. Para concluir a admissão na ${p.empresa}, preencha os seus dados e assine o contrato por este link: ${p.url}`;

/**
 * Manda (ou remanda) o link: e-mail pelo envio da empresa e o WhatsApp com a mensagem pronta.
 * Cada envio renova o prazo — um link que venceu volta a valer com `reenviarConvite`, sem trocar
 * o token (quem já tinha o link não fica com dois links na mão).
 */
export async function reenviarConvite(
  ator: { empresaId: string; usuarioId: string }, admissaoId: string, origem: string,
  op: { validadeDias?: number | null } = {}, agora: Date = new Date(),
): Promise<EnvioDoConvite> {
  const a = await daEmpresa(ator.empresaId, admissaoId);
  const situacao = a.situacao as SituacaoAdmissao;
  if (situacao === "CANCELADA") throw new ErroAdmissao(MSG_CANCELADA, 409);
  if (!podeReenviar(situacao)) {
    throw new ErroAdmissao(`Esta admissão já está em "${ROTULO_SITUACAO[situacao]}": não há link para reenviar.`, 409);
  }
  const cfg = await configDaEmpresa(ator.empresaId);
  const dias = op.validadeDias ?? cfg.validadeDias;
  if (!validadeValida(dias)) throw new ErroAdmissao(MSG_VALIDADE, 400);

  const empresa = await prisma.empresa.findUnique({
    where: { id: ator.empresaId }, select: { nome: true, nomeFantasia: true },
  });
  const nomeEmpresa = limpo(empresa?.nomeFantasia) || empresa?.nome || "";
  const url = `${origem}${caminhoPublicoAdmissao(a.token)}`;
  const mensagem = mensagemConvite({ nome: a.colaborador.nome.split(" ")[0], empresa: nomeEmpresa, url });
  const whatsappUrl = a.colaborador.telefone ? whatsappLink(a.colaborador.telefone, mensagem) : null;

  let emailEnviado = false, emailPara: string | null = null, erroEmail: string | null = null;
  const para = limpo(a.colaborador.email);
  if (!para) erroEmail = "colaborador sem e-mail no cadastro";
  else if (!(await emailConfigAtiva(ator.empresaId))) erroEmail = "e-mail da empresa não configurado";
  else {
    let envio: { ok: boolean; erro?: string };
    try {
      envio = await enviarEmail(ator.empresaId, {
        tipo: TEMPLATE_CONVITE, para, referenciaId: a.id, referenciaTipo: "Admissao",
        variaveis: {
          colaborador_nome: a.colaborador.nome, cargo_nome: a.colaborador.cargo?.nome ?? "",
          link_admissao: url, validade_link: `${dias} dia(s)`,
        },
      });
    } catch (e) {
      console.error("[admissão] falha ao enviar o convite", e);
      envio = { ok: false, erro: "erro inesperado" };
    }
    if (envio.ok) { emailEnviado = true; emailPara = para; }
    else erroEmail = `falha no envio: ${envio.erro ?? "sem detalhe"}`;
  }

  // O e-mail SAIU do servidor; o WhatsApp é um link que o RH ainda vai abrir — quem manda no canal
  // registrado é o envio que de fato aconteceu
  const canal = emailEnviado ? "EMAIL" : whatsappUrl ? "WHATSAPP" : "LINK";
  const destino = [emailPara, whatsappUrl ? `WhatsApp ${a.colaborador.telefone}` : null].filter(Boolean).join(" · ") || null;
  const atualizada = await prisma.admissao.update({
    where: { id: a.id },
    data: {
      // Expirada volta a valer; as outras só renovam o prazo
      ...(situacao === "EXPIRADA" && { situacao: "CONVIDADO" }),
      expiraEm: expiraEm(dias, agora),
      enviadoEm: agora, enviadoCanal: canal, enviadoPara: destino?.slice(0, 200) ?? null,
      envios: { increment: 1 },
    },
    select: SELECT_RH,
  });
  return {
    admissao: serializarRh(atualizada, await contagemDocs(a.colaborador.id, cfg), agora),
    url, mensagem, whatsappUrl, emailEnviado, emailPara, erroEmail,
  };
}

/** O link morre agora (vazou, foi para a pessoa errada). O RH reenvia depois, com prazo novo. */
export async function invalidarConvite(
  ator: { empresaId: string }, admissaoId: string, agora: Date = new Date(),
): Promise<AdmissaoDoRh> {
  const a = await daEmpresa(ator.empresaId, admissaoId);
  const situacao = a.situacao as SituacaoAdmissao;
  if (!podeIr(situacao, "EXPIRADA")) {
    throw new ErroAdmissao(`Esta admissão está em "${ROTULO_SITUACAO[situacao]}": não há link para invalidar.`, 409);
  }
  const atualizada = await prisma.admissao.update({
    where: { id: a.id }, data: { situacao: "EXPIRADA", expiraEm: agora }, select: SELECT_RH,
  });
  return serializarRh(atualizada, await contagemDocs(a.colaborador.id, await configDaEmpresa(ator.empresaId)), agora);
}

/** Cancelar NÃO apaga: muda a situação e guarda a razão, quem cancelou e quando. */
export async function cancelarAdmissao(
  ator: { empresaId: string; usuarioId: string }, admissaoId: string, motivo: string, agora: Date = new Date(),
): Promise<AdmissaoDoRh> {
  if (!motivoValido(motivo)) throw new ErroAdmissao(MSG_MOTIVO, 400);
  const a = await daEmpresa(ator.empresaId, admissaoId);
  const situacao = a.situacao as SituacaoAdmissao;
  if (!podeIr(situacao, "CANCELADA")) {
    throw new ErroAdmissao(`Esta admissão está em "${ROTULO_SITUACAO[situacao]}" e não pode ser cancelada.`, 409);
  }
  const atualizada = await prisma.admissao.update({
    where: { id: a.id },
    data: { situacao: "CANCELADA", canceladaEm: agora, canceladaPorId: ator.usuarioId, cancelamentoMotivo: limpo(motivo).slice(0, 500) },
    select: SELECT_RH,
  });
  return serializarRh(atualizada, await contagemDocs(a.colaborador.id, await configDaEmpresa(ator.empresaId)), agora);
}

/** A ficha e os documentos foram baixados para o contador. */
export async function marcarEnviadoContador(
  ator: { empresaId: string; usuarioId: string }, admissaoId: string, agora: Date = new Date(),
): Promise<AdmissaoDoRh> {
  const a = await daEmpresa(ator.empresaId, admissaoId);
  const situacao = a.situacao as SituacaoAdmissao;
  if (!podeIr(situacao, "ENVIADO_CONTADOR")) {
    throw new ErroAdmissao(`Só depois de assinado. Esta admissão está em "${ROTULO_SITUACAO[situacao]}".`, 409);
  }
  const atualizada = await prisma.admissao.update({
    where: { id: a.id },
    data: { situacao: "ENVIADO_CONTADOR", enviadoContadorEm: agora, enviadoContadorPorId: ator.usuarioId },
    select: SELECT_RH,
  });
  return serializarRh(atualizada, await contagemDocs(a.colaborador.id, await configDaEmpresa(ator.empresaId)), agora);
}

/**
 * Admitido: a admissão fecha e o colaborador entra no quadro (ATIVO). A data de admissão que o RH
 * já tinha posto é respeitada; sem ela, é hoje.
 */
export async function marcarAdmitido(
  ator: { empresaId: string; usuarioId: string }, admissaoId: string, agora: Date = new Date(),
): Promise<AdmissaoDoRh> {
  const a = await daEmpresa(ator.empresaId, admissaoId);
  const situacao = a.situacao as SituacaoAdmissao;
  if (!podeIr(situacao, "ADMITIDO")) {
    throw new ErroAdmissao(`Só depois de assinado. Esta admissão está em "${ROTULO_SITUACAO[situacao]}".`, 409);
  }
  const atual = await prisma.tecnico.findUnique({ where: { id: a.colaborador.id }, select: { dataAdmissao: true } });
  const [, atualizada] = await prisma.$transaction([
    prisma.tecnico.update({
      where: { id: a.colaborador.id },
      data: { ativo: true, statusColaborador: "ATIVO", dataAdmissao: atual?.dataAdmissao ?? agora },
    }),
    prisma.admissao.update({ where: { id: a.id }, data: { situacao: "ADMITIDO", admitidoEm: agora }, select: SELECT_RH }),
  ]);
  return serializarRh(atualizada, await contagemDocs(a.colaborador.id, await configDaEmpresa(ator.empresaId)), agora);
}

/* ───────────────────────── RH: listar e acompanhar ───────────────────────── */

export interface FiltroAdmissoes { situacao?: string | null; busca?: string | null; take?: number }

/** A lista do RH, da mais recente para a mais antiga. */
export async function admissoesDaEmpresa(empresaId: string, f: FiltroAdmissoes = {}, agora: Date = new Date()): Promise<AdmissaoDoRh[]> {
  const busca = limpo(f.busca);
  const where: Prisma.AdmissaoWhereInput = {
    empresaId,
    ...(f.situacao && { situacao: f.situacao }),
    ...(busca && {
      colaborador: {
        OR: [
          { nome: { contains: busca, mode: "insensitive" } },
          { cpf: { contains: digitos(busca) || busca } },
        ],
      },
    }),
  };
  const linhas = await prisma.admissao.findMany({
    where, orderBy: { criadoEm: "desc" }, take: Math.min(200, Math.max(1, f.take ?? 100)), select: SELECT_RH,
  });
  const cfg = await configDaEmpresa(empresaId);
  const obrigatorios = obrigatoriosDa(cfg.documentos);
  const docs = await prisma.colaboradorDocumento.findMany({
    where: { colaboradorId: { in: linhas.map((l) => l.colaborador.id) }, excluidoEm: null, tipo: { in: obrigatorios.length ? obrigatorios : ["__nenhum__"] } },
    select: { colaboradorId: true, tipo: true },
  });
  return linhas.map((l) => {
    const meus = new Set(docs.filter((d) => d.colaboradorId === l.colaborador.id).map((d) => d.tipo));
    return serializarRh(l, { enviados: obrigatorios.filter((id) => meus.has(id)).length, obrigatorios: obrigatorios.length }, agora);
  });
}

/** A admissão (viva ou a última) de um colaborador — é o que a ficha dele mostra. */
export async function admissaoDoColaborador(empresaId: string, colaboradorId: string, agora: Date = new Date()): Promise<AdmissaoDoRh | null> {
  const a = await prisma.admissao.findFirst({
    where: { empresaId, colaboradorId }, orderBy: { criadoEm: "desc" }, select: SELECT_RH,
  });
  if (!a) return null;
  return serializarRh(a, await contagemDocs(colaboradorId, await configDaEmpresa(empresaId)), agora);
}

/** O que o RH vê do progresso: onde parou, o que falta e os documentos que chegaram. */
export interface ProgressoAdmissao {
  admissao: AdmissaoDoRh;
  etapaPendente: Etapa | null;
  faltando: string[];
  documentos: { id: string; docId: string; rotulo: string; nome: string; obrigatorio: boolean; criadoEm: string }[];
  documentosFaltando: { id: string; rotulo: string }[];
}

export async function progressoDaAdmissao(empresaId: string, admissaoId: string, agora: Date = new Date()): Promise<ProgressoAdmissao> {
  const a = await prisma.admissao.findFirst({ where: { id: admissaoId, empresaId }, select: { ...SELECT_RH, rascunho: true } });
  if (!a) throw new ErroAdmissao("Admissão não encontrada", 404);
  const cfg = await configDaEmpresa(empresaId);
  const form = formDaAdmissao(a.rascunho, a.colaborador.nome);
  const linhas = await documentosDa(a.colaborador.id, cfg.documentos);
  const enviados = linhas.map((l) => l.tipo);
  const porId = new Map(cfg.documentos.map((d) => [d.id, d]));
  const pendente = etapaPendente(form, { enviados, obrigatorios: obrigatoriosDa(cfg.documentos) });
  return {
    admissao: serializarRh(a, await contagemDocs(a.colaborador.id, cfg), agora),
    etapaPendente: pendente,
    faltando: pendente ? faltaNaEtapa(pendente, form, { enviados, obrigatorios: obrigatoriosDa(cfg.documentos) }) : [],
    documentos: linhas.map((l) => ({
      id: l.id, docId: l.tipo, rotulo: porId.get(l.tipo)?.rotulo ?? l.tipo, nome: l.nome,
      obrigatorio: porId.get(l.tipo)?.obrigatorio ?? false, criadoEm: l.criadoEm.toISOString(),
    })),
    documentosFaltando: cfg.documentos.filter((d) => d.obrigatorio && !enviados.includes(d.id)).map((d) => ({ id: d.id, rotulo: d.rotulo })),
  };
}

/** O sino do RH: admissões assinadas esperando ir para o contador. */
export async function contarAdmissoesAssinadas(empresaId: string): Promise<{ admissoesAssinadas: number; admissaoAssinadaId: string | null }> {
  const [total, ultima] = await Promise.all([
    prisma.admissao.count({ where: { empresaId, situacao: "ASSINADO" } }),
    prisma.admissao.findFirst({ where: { empresaId, situacao: "ASSINADO" }, orderBy: { assinaturaEm: "desc" }, select: { id: true } }),
  ]);
  return { admissoesAssinadas: total, admissaoAssinadaId: ultima?.id ?? null };
}

/* ───────────────────────── o lado do colaborador (link público) ───────────────────────── */

const SELECT_PUBLICO = {
  id: true, token: true, empresaId: true, situacao: true, expiraEm: true, etapa: true, rascunho: true,
  abertoEm: true, consentimentoEm: true, concluidoEm: true, assinaturaEm: true, assinaturaNome: true,
  emailVerificado: true, emailCodigoHash: true, emailCodigoExpiraEm: true, emailCodigoTentativas: true,
  contratoTexto: true,
  colaborador: {
    select: {
      id: true, nome: true, cpf: true, salario: true, dataAdmissao: true,
      jornadaEntrada: true, jornadaSaida: true, jornadaDias: true, jornadaFaixas: true,
      cargo: { select: { nome: true } },
    },
  },
  empresa: { select: { nome: true, nomeFantasia: true, cnpj: true, cidade: true, estado: true, logo: true } },
} satisfies Prisma.AdmissaoSelect;

type LinhaPublica = Prisma.AdmissaoGetPayload<{ select: typeof SELECT_PUBLICO }>;

/** A admissão pelo token (null = token que não existe). */
export async function admissaoPorToken(token: string): Promise<LinhaPublica | null> {
  const t = limpo(token);
  if (!t || t.length > 200) return null;
  return prisma.admissao.findUnique({ where: { token: t }, select: SELECT_PUBLICO });
}

/** O CPF que a tela mostra: só o miolo, para a pessoa reconhecer o convite sem o link entregar o CPF. */
export const cpfMascarado = (cpf: string) => {
  const d = digitos(cpf);
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : "";
};

export interface AdmissaoPublica {
  situacao: SituacaoAdmissao;
  etapa: string | null;
  expiraEm: string;
  empresa: string;
  empresaLogo: string | null;
  colaborador: { nome: string; cpfMascarado: string; cargo: string | null };
  consentidoEm: string | null;
  /** Só depois do consentimento: o formulário, os documentos e o contrato */
  form: FormAdmissao | null;
  documentos: DocumentoPedido[];
  enviados: { id: string; docId: string; nome: string }[];
  emailVerificado: string | null;
  faltando: string[];
  etapaPendente: Etapa | null;
  /** O contrato montado (antes de assinar) ou o texto congelado (depois) */
  contrato: string | null;
  assinaturaEm: string | null;
  assinaturaNome: string | null;
  /** Orientações finais: só depois de assinar */
  orientacoes: string | null;
}

/** Monta os dados que o contrato preenche. Nada aqui inventa texto: só valores do cadastro. */
function dadosDoContrato(a: LinhaPublica, form: FormAdmissao, cfg: ConfigAdmissao, agora: Date): DadosContrato {
  const emp = a.empresa;
  const col = a.colaborador;
  return {
    empresa: limpo(emp.nomeFantasia) || emp.nome,
    empresaCnpj: emp.cnpj ?? "",
    nome: form.nome || col.nome,
    cpf: formatarDocumento(form.cpf || col.cpf),
    rg: form.rg,
    endereco: enderecoEmLinha(form),
    cargo: col.cargo?.nome ?? "",
    salario: col.salario === null || col.salario === undefined ? "" : formatarMoeda(Number(col.salario)),
    jornada: textoDaJornada(faixasDoColaborador(col)),
    admissao: col.dataAdmissao ? formatarData(col.dataAdmissao) : "",
    experienciaDias: cfg.experienciaDias,
    experienciaProrrogacaoDias: cfg.experienciaProrrogacaoDias,
    cidade: [emp.cidade, emp.estado].filter(Boolean).join("/"),
    data: formatarData(agora),
  };
}

async function serializarPublica(a: LinhaPublica, agora: Date): Promise<AdmissaoPublica> {
  const cfg = await configDaEmpresa(a.empresaId);
  const situacao = a.situacao as SituacaoAdmissao;
  const consentido = !!a.consentimentoEm;
  const base = {
    situacao, etapa: a.etapa, expiraEm: a.expiraEm.toISOString(),
    empresa: limpo(a.empresa.nomeFantasia) || a.empresa.nome,
    empresaLogo: a.empresa.logo ?? null,
    colaborador: { nome: a.colaborador.nome, cpfMascarado: cpfMascarado(a.colaborador.cpf), cargo: a.colaborador.cargo?.nome ?? null },
    consentidoEm: iso(a.consentimentoEm),
    assinaturaEm: iso(a.assinaturaEm), assinaturaNome: a.assinaturaNome,
  };
  if (!consentido) {
    return {
      ...base, form: null, documentos: [], enviados: [], emailVerificado: null,
      faltando: [], etapaPendente: null, contrato: null, orientacoes: null,
    };
  }
  const form = formDaAdmissao(a.rascunho, a.colaborador.nome);
  const linhas = await documentosDa(a.colaborador.id, cfg.documentos);
  const enviados = linhas.map((l) => l.tipo);
  const obrigatorios = obrigatoriosDa(cfg.documentos);
  const pendente = etapaPendente(form, { enviados, obrigatorios });
  const assinado = !!a.assinaturaEm;
  return {
    ...base,
    form,
    documentos: cfg.documentos,
    enviados: linhas.map((l) => ({ id: l.id, docId: l.tipo, nome: l.nome })),
    emailVerificado: a.emailVerificado,
    faltando: pendente ? faltaNaEtapa(pendente, form, { enviados, obrigatorios }) : [],
    etapaPendente: pendente,
    contrato: assinado
      ? a.contratoTexto
      : cfg.contratoModelo
        ? montarContrato(cfg.contratoModelo, dadosDoContrato(a, form, cfg, agora))
        : null,
    orientacoes: assinado ? cfg.orientacoes || null : null,
  };
}

/**
 * O token tem de existir e o link tem de aceitar mudança. Devolve a linha ou estoura com o motivo
 * CERTO: cancelada e já assinada têm mensagem própria — "o link venceu" seria mentira para quem
 * acabou de assinar.
 */
async function linhaViva(token: string, agora: Date): Promise<LinhaPublica> {
  const a = await admissaoPorToken(token);
  if (!a) throw new ErroAdmissao(MSG_LINK_INVALIDO, 404);
  const situacao = a.situacao as SituacaoAdmissao;
  if (situacao === "CANCELADA") throw new ErroAdmissao(MSG_CANCELADA, 409);
  if (a.assinaturaEm) throw new ErroAdmissao(MSG_JA_ASSINADO, 409);
  if (!linkValido({ situacao, expiraEm: a.expiraEm }, agora)) throw new ErroAdmissao(MSG_LINK_INVALIDO, 410);
  return a;
}

/**
 * O colaborador abriu o link. Marca a primeira abertura e devolve só o que a tela pública pode ver.
 * Já assinado (ou admitido) continua abrindo: é a tela de orientações finais.
 */
export async function abrirAdmissao(token: string, agora: Date = new Date()): Promise<AdmissaoPublica> {
  const a = await admissaoPorToken(token);
  if (!a) throw new ErroAdmissao(MSG_LINK_INVALIDO, 404);
  const situacao = a.situacao as SituacaoAdmissao;
  if (situacao === "CANCELADA") throw new ErroAdmissao(MSG_CANCELADA, 409);
  const terminou = ["ASSINADO", "ENVIADO_CONTADOR", "ADMITIDO"].includes(situacao);
  if (!terminou && !linkValido({ situacao, expiraEm: a.expiraEm }, agora)) throw new ErroAdmissao(MSG_LINK_INVALIDO, 410);
  if (!a.abertoEm) await prisma.admissao.update({ where: { id: a.id }, data: { abertoEm: agora } });
  return serializarPublica(a, agora);
}

/** O consentimento LGPD: data/hora, IP e navegador. Sem ele o formulário não abre. */
export async function consentir(token: string, origem: OrigemPublica = {}, agora: Date = new Date()): Promise<AdmissaoPublica> {
  const a = await linhaViva(token, agora);
  if (a.consentimentoEm) return serializarPublica(a, agora);
  const atualizada = await prisma.admissao.update({
    where: { id: a.id },
    data: {
      consentimentoEm: agora, consentimentoIp: origem.ip ?? null, consentimentoUserAgent: navegador(origem.userAgent),
      ...(a.situacao === "CONVIDADO" && { situacao: "PREENCHENDO" }),
      ...(!a.abertoEm && { abertoEm: agora }),
    },
    select: SELECT_PUBLICO,
  });
  return serializarPublica(atualizada, agora);
}

function exigirConsentimento(a: LinhaPublica) {
  if (!a.consentimentoEm) throw new ErroAdmissao(MSG_SEM_CONSENTIMENTO, 403);
}

/** Salva o rascunho (campo a campo, nunca o JSON como chegou) e onde o colaborador parou. */
export async function salvarRascunho(
  token: string, bruto: unknown, etapa: string | null = null, agora: Date = new Date(),
): Promise<AdmissaoPublica> {
  const a = await linhaViva(token, agora);
  exigirConsentimento(a);
  const form = normalizarForm(bruto);
  // Trocar o e-mail derruba a verificação: o código valeu para o endereço anterior
  const perdeVerificacao = !!a.emailVerificado && !emailConfere(form.email, a.emailVerificado);
  const atualizada = await prisma.admissao.update({
    where: { id: a.id },
    data: {
      rascunho: form as unknown as Prisma.InputJsonValue,
      etapa: limpo(etapa).slice(0, 40) || a.etapa,
      ...(a.situacao === "CONVIDADO" && { situacao: "PREENCHENDO" }),
      ...(perdeVerificacao && { emailVerificado: null, emailVerificadoEm: null }),
    },
    select: SELECT_PUBLICO,
  });
  return serializarPublica(atualizada, agora);
}

/* ───────── verificação do e-mail por código ───────── */

/**
 * Manda o código para o e-mail digitado. O banco guarda só o HASH do código; o código em si existe
 * no e-mail e no navegador de quem o recebeu. Empresa sem e-mail configurado não trava a admissão:
 * devolve o motivo e a tela segue sem verificar.
 */
export async function enviarCodigoEmail(
  token: string, email: string, agora: Date = new Date(),
): Promise<{ enviado: boolean; para: string; expiraEm: string; erro: string | null }> {
  const a = await linhaViva(token, agora);
  exigirConsentimento(a);
  const para = limpo(email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para) || para.length > 160) throw new ErroAdmissao("E-mail inválido", 400);
  if (!(await emailConfigAtiva(a.empresaId))) {
    return { enviado: false, para, expiraEm: "", erro: "A empresa ainda não configurou o envio de e-mail." };
  }
  const codigo = novoCodigo();
  const expira = minutos(CODIGO_VALIDADE_MIN, agora);
  let envio: { ok: boolean; erro?: string };
  try {
    envio = await enviarEmail(a.empresaId, {
      tipo: TEMPLATE_CODIGO, para, referenciaId: a.id, referenciaTipo: "Admissao",
      variaveis: {
        colaborador_nome: a.colaborador.nome, codigo,
        validade_link: `${CODIGO_VALIDADE_MIN} minutos`,
      },
    });
  } catch (e) {
    console.error("[admissão] falha ao enviar o código", e);
    envio = { ok: false, erro: "erro inesperado" };
  }
  if (!envio.ok) return { enviado: false, para, expiraEm: "", erro: envio.erro ?? "Não foi possível enviar o código." };
  await prisma.admissao.update({
    where: { id: a.id },
    data: { emailCodigoHash: hashCodigo(codigo), emailCodigoExpiraEm: expira, emailCodigoTentativas: 0 },
  });
  return { enviado: true, para, expiraEm: expira.toISOString(), erro: null };
}

/** Confere o código. Errou demais, o código morre: é preciso pedir outro. */
export async function conferirCodigoEmail(
  token: string, email: string, codigo: string, agora: Date = new Date(),
): Promise<{ verificado: true; email: string }> {
  const a = await linhaViva(token, agora);
  exigirConsentimento(a);
  if (!codigoValido(codigo)) throw new ErroAdmissao(MSG_CODIGO_FORMATO, 400);
  const para = limpo(email).toLowerCase();
  if (!a.emailCodigoHash || !a.emailCodigoExpiraEm) throw new ErroAdmissao("Peça o código antes de confirmar.", 409);
  if (a.emailCodigoExpiraEm.getTime() <= agora.getTime()) throw new ErroAdmissao(MSG_CODIGO_VENCIDO, 410);
  if (a.emailCodigoTentativas >= CODIGO_MAX_TENTATIVAS) {
    await prisma.admissao.update({ where: { id: a.id }, data: { emailCodigoHash: null, emailCodigoExpiraEm: null } });
    throw new ErroAdmissao("Código bloqueado por tentativas. Peça outro.", 429);
  }
  if (hashCodigo(codigo) !== a.emailCodigoHash) {
    await prisma.admissao.update({ where: { id: a.id }, data: { emailCodigoTentativas: { increment: 1 } } });
    throw new ErroAdmissao(MSG_CODIGO_ERRADO, 400);
  }
  const form = formDaAdmissao(a.rascunho, a.colaborador.nome);
  await prisma.admissao.update({
    where: { id: a.id },
    data: {
      emailVerificado: para, emailVerificadoEm: agora,
      emailCodigoHash: null, emailCodigoExpiraEm: null, emailCodigoTentativas: 0,
      // O e-mail verificado é o que vale: entra no rascunho para a etapa não voltar atrás
      rascunho: { ...form, email: para } as unknown as Prisma.InputJsonValue,
    },
  });
  return { verificado: true, email: para };
}

/* ───────── documentos ───────── */

/** Teto de arquivos por admissão: frente e verso de tudo caberia em muito menos. */
export const DOCUMENTOS_MAX = 40;

/**
 * Um documento que a empresa pede, gravado nos anexos do colaborador. O tipo do arquivo é decidido
 * pelos BYTES (um HTML com nome de PDF não passa), como em todo anexo do sistema.
 */
export async function enviarDocumento(
  token: string, dados: { docId: string; nome?: string; arquivoUrl: string }, agora: Date = new Date(),
): Promise<{ id: string; docId: string; nome: string }> {
  const a = await linhaViva(token, agora);
  exigirConsentimento(a);
  const cfg = await configDaEmpresa(a.empresaId);
  const pedido = cfg.documentos.find((d) => d.id === limpo(dados.docId));
  if (!pedido) throw new ErroAdmissao("Este documento não está na lista da empresa.", 400);
  const quantos = await prisma.colaboradorDocumento.count({
    where: { colaboradorId: a.colaborador.id, excluidoEm: null, tipo: { in: cfg.documentos.map((d) => d.id) } },
  });
  if (quantos >= DOCUMENTOS_MAX) throw new ErroAdmissao("Muitos arquivos enviados. Apague algum antes de enviar outro.", 409);
  const nome = limpo(dados.nome) || `${pedido.rotulo}`;
  const r = validarDataUrl(dados.arquivoUrl, nome);
  if (!r.ok) throw new ErroAdmissao(r.erro, 400);
  const criado = await prisma.colaboradorDocumento.create({
    // Vai para a MESMA seção Documentos da ficha (não existe lista paralela): a origem diz que
    // quem mandou foi o colaborador, e a categoria põe o arquivo na gaveta certa.
    data: {
      colaboradorId: a.colaborador.id, tipo: pedido.id, nome: r.arquivo.nome,
      arquivoUrl: r.arquivo.conteudo, origem: "ADMISSAO", categoria: categoriaDoPedido(pedido.id),
      arquivoTipo: r.arquivo.tipo, tamanho: r.arquivo.tamanho,
    },
    select: { id: true, tipo: true, nome: true },
  });
  return { id: criado.id, docId: criado.tipo, nome: criado.nome };
}

/** O colaborador apaga um arquivo que ele mesmo mandou (enquanto não assinou). */
export async function removerDocumento(token: string, documentoId: string, agora: Date = new Date()): Promise<void> {
  const a = await linhaViva(token, agora);
  exigirConsentimento(a);
  const cfg = await configDaEmpresa(a.empresaId);
  // Apagar é marcar, não remover a linha: o arquivo sai da lista do link e da ficha, e fica o
  // rastro de quando saiu. Sem `excluidoPorId` — quem apagou foi o próprio colaborador, pelo link,
  // e ele não é um usuário do sistema.
  const { count } = await prisma.colaboradorDocumento.updateMany({
    where: { id: documentoId, colaboradorId: a.colaborador.id, excluidoEm: null, tipo: { in: cfg.documentos.map((d) => d.id) } },
    data: { excluidoEm: agora },
  });
  if (count !== 1) throw new ErroAdmissao("Documento não encontrado", 404);
}

/* ───────── concluir o preenchimento ───────── */

/**
 * Terminou de preencher: o que foi digitado passa para o cadastro do colaborador e a admissão fica
 * AGUARDANDO_ASSINATURA. O CPF digitado tem de casar com o do pré-cadastro — é a conferência de
 * identidade do link.
 */
export async function concluirPreenchimento(token: string, agora: Date = new Date()): Promise<AdmissaoPublica> {
  const a = await linhaViva(token, agora);
  exigirConsentimento(a);
  const cfg = await configDaEmpresa(a.empresaId);
  const form = formDaAdmissao(a.rascunho, a.colaborador.nome);
  const linhas = await documentosDa(a.colaborador.id, cfg.documentos);
  const docs = { enviados: linhas.map((l) => l.tipo), obrigatorios: obrigatoriosDa(cfg.documentos) };
  const pendente = etapaPendente(form, docs);
  if (pendente) {
    throw new ErroAdmissao(`Ainda falta: ${faltaNaEtapa(pendente, form, docs).join(", ")}`, 400);
  }
  if (digitos(form.cpf) !== digitos(a.colaborador.cpf)) {
    throw new ErroAdmissao("O CPF não confere com o do convite. Confira o número.", 409);
  }
  // O e-mail agora é obrigatório (Leva J); a confirmação por código só é exigida quando a empresa envia e-mail —
  // sem o envio configurado o código nunca chegaria e a admissão ficaria presa
  if (form.email && !emailConfere(form.email, a.emailVerificado) && (await emailConfigAtiva(a.empresaId))) throw new ErroAdmissao(MSG_EMAIL_NAO_VERIFICADO, 409);

  const data = new Date(form.dataNascimento);
  const nascimento = Number.isNaN(data.getTime()) ? null : data;
  const atualizada = await prisma.$transaction(async (tx) => {
    await tx.tecnico.update({
      where: { id: a.colaborador.id },
      data: {
        nome: form.nome, rg: form.rg || null, dataNascimento: nascimento,
        telefone: form.telefone, email: form.email || null,
        nomeMae: form.nomeMae || null, nomePai: form.nomePai || null,
        estadoCivil: form.estadoCivil || null, escolaridade: form.escolaridade || null,
        nacionalidade: form.nacionalidade || null, naturalidade: form.naturalidade || null,
        sexo: form.sexo || null, pis: form.pis || null,
        ctpsNumero: form.ctpsNumero || null, ctpsSerie: form.ctpsSerie || null, ctpsUf: form.ctpsUf || null,
        tituloEleitor: form.tituloEleitor || null, reservista: form.reservista || null,
        cep: form.cep || null, endereco: form.endereco || null, numero: form.numero || null,
        complemento: form.complemento || null, bairro: form.bairro || null,
        cidade: form.cidade || null, estado: form.estado || null,
        banco: form.banco || null, agencia: form.agencia || null, conta: form.conta || null,
        contaTipo: form.contaTipo || null, pixChave: form.pixChave || null,
      },
    });
    // Os dependentes são a lista que o colaborador entregou: a anterior (de um envio antes) sai
    await tx.colaboradorDependente.deleteMany({ where: { colaboradorId: a.colaborador.id } });
    if (form.dependentes.length) {
      await tx.colaboradorDependente.createMany({
        data: form.dependentes.map((d) => {
          const nasc = new Date(d.nascimento);
          return {
            colaboradorId: a.colaborador.id, nome: d.nome,
            nascimento: Number.isNaN(nasc.getTime()) ? null : nasc,
            cpf: digitos(d.cpf) || null, parentesco: d.parentesco,
            irrf: d.irrf, salarioFamilia: d.salarioFamilia,
          };
        }),
      });
    }
    return tx.admissao.update({
      where: { id: a.id },
      data: { situacao: "AGUARDANDO_ASSINATURA", etapa: "CONTRATO", concluidoEm: a.concluidoEm ?? agora },
      select: SELECT_PUBLICO,
    });
  });
  return serializarPublica(atualizada, agora);
}

/* ───────── assinatura ───────── */

export interface AssinaturaAdmissao {
  /** O nome digitado por quem assina (a mesma prova do aceite da OS) */
  nome: string;
  /** Selfie do momento da assinatura (data URL de imagem) */
  selfie: string;
}

export const MSG_SEM_MODELO = "A empresa ainda não cadastrou o modelo de contrato. Fale com o RH.";
export const MSG_SEM_SELFIE = "Tire a foto para concluir a assinatura.";

/**
 * Assina o contrato: nome digitado, IP, navegador, data/hora e selfie, com o TEXTO DO CONTRATO
 * congelado — é a prova do que foi assinado. A troca de situação é atômica (dois cliques não
 * assinam duas vezes). Quem avisa o RH é `avisarRh`, depois de gravar.
 */
export async function assinar(
  token: string, dados: AssinaturaAdmissao, origem: OrigemPublica = {}, agora: Date = new Date(),
): Promise<AdmissaoPublica> {
  const a = await linhaViva(token, agora);
  exigirConsentimento(a);
  if (a.situacao !== "AGUARDANDO_ASSINATURA") {
    throw new ErroAdmissao("Conclua o preenchimento antes de assinar.", 409);
  }
  const nome = limpo(dados.nome);
  if (nome.length < 3) throw new ErroAdmissao("Digite o seu nome completo para assinar.", 400);
  const selfie = limpo(dados.selfie);
  if (!selfie) throw new ErroAdmissao(MSG_SEM_SELFIE, 400);
  const foto = validarFoto(selfie);
  if (!foto.ok) throw new ErroAdmissao(foto.erro, 400);

  const cfg = await configDaEmpresa(a.empresaId);
  if (!cfg.contratoModelo.trim()) throw new ErroAdmissao(MSG_SEM_MODELO, 409);
  const form = formDaAdmissao(a.rascunho, a.colaborador.nome);
  const contrato = montarContrato(cfg.contratoModelo, dadosDoContrato(a, form, cfg, agora));

  const { count } = await prisma.admissao.updateMany({
    where: { id: a.id, situacao: "AGUARDANDO_ASSINATURA", assinaturaEm: null },
    data: {
      situacao: "ASSINADO", assinaturaNome: nome, assinaturaEm: agora,
      assinaturaIp: origem.ip ?? null, assinaturaUserAgent: navegador(origem.userAgent),
      selfie: foto.arquivo.conteudo, contratoTexto: contrato,
    },
  });
  if (count !== 1) throw new ErroAdmissao(MSG_JA_ASSINADO, 409);

  // O contrato assinado vira anexo do colaborador: fica na seção Documentos da ficha, junto com o
  // resto dos papéis da pessoa. Se o PDF não puder ser gerado, a assinatura NÃO cai — ela já está
  // gravada, e a rota do contrato continua gerando o arquivo na hora.
  try {
    const { guardarContratoNosAnexos } = await import("@/lib/admissao/admissao-entrega-server");
    await guardarContratoNosAnexos(a.id, a.empresaId, agora);
  } catch { /* o contrato continua disponível pela rota */ }

  const depois = (await admissaoPorToken(token))!;
  return serializarPublica(depois, agora);
}

/**
 * Avisa quem gerou o convite que a admissão foi assinada. Falha de e-mail não derruba a
 * assinatura — a assinatura já está gravada quando isto roda.
 */
export async function avisarRh(admissaoId: string, origem: string): Promise<{ ok: boolean; erro?: string }> {
  const a = await prisma.admissao.findUnique({
    where: { id: admissaoId },
    select: {
      id: true, empresaId: true, assinaturaNome: true, assinaturaEm: true,
      colaborador: { select: { nome: true } },
      criadoPor: { select: { nome: true, email: true } },
    },
  });
  if (!a) return { ok: false, erro: "Admissão não encontrada" };
  const para = limpo(a.criadoPor?.email);
  if (!para) return { ok: false, erro: "Quem gerou o convite não tem e-mail no cadastro" };
  const quando = a.assinaturaEm ? formatarData(a.assinaturaEm, "dd/MM/yyyy HH:mm") : "";
  const html = `<p>A admissão de <strong>${a.colaborador.nome}</strong> foi concluída e o contrato foi assinado${quando ? ` em ${quando}` : ""}.</p>`
    + `<p>A ficha e os documentos estão prontos em <a href="${origem}/admissoes">Admissões</a>.</p>`;
  return enviarEmailInterno(a.empresaId, para, `Admissão assinada: ${a.colaborador.nome}`, html);
}

/** As orientações finais da empresa (a última tela do colaborador). */
export async function orientacoesDaEmpresa(empresaId: string): Promise<string> {
  return (await configDaEmpresa(empresaId)).orientacoes;
}
