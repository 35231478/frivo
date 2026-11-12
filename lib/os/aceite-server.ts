/**
 * ACEITE DO CLIENTE na conclusão da OS — o lado do SERVIDOR. As regras estão em lib/os/aceite.
 *
 *  - `garantirAceite`: a OS concluiu → nasce o aceite PENDENTE (uma linha por OS, com o token do link);
 *  - `registrarAceiteLocal`: o responsável assinou na tela do técnico (ou do escritório);
 *  - `pedirAceite`: UM clique manda o link — e-mail pelo envio da empresa (Resend) e o WhatsApp
 *    aberto com a mensagem pronta, para os mesmos contatos dos avisos de OS;
 *  - `confirmarAceitePublico`: o cliente confirmou pelo link — nome, IP, navegador e data/hora,
 *    com troca ATÔMICA de situação (dois cliques não confirmam duas vezes), como no orçamento;
 *  - `pendenciasDoCliente`: o que o portal mostra a quem vai abrir um chamado.
 *
 * Tudo por empresa. Cada passo deixa uma linha no histórico da OS.
 */
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { whatsappLink } from "@/lib/utils";
import { emailConfigAtiva, enviarEmail } from "@/lib/email";
import { destinatariosDaOs, whatsappParaAviso } from "@/lib/execucao/aviso-cliente";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import type { ContextoExecucao } from "@/lib/execucao/contexto";
import type { ResultadoAcao } from "@/lib/execucao/acoes";
import {
  ACAO_ACEITE, ACAO_PEDIDO, MSG_JA_CONFIRMADO, MSG_OS_CANCELADA, MSG_OS_NAO_CONCLUIDA, canalDoPedido, caminhoPublicoAceite, mensagemPedido, motivoSemAceite,
  servicoDaOs, textoDoCanal, type AceiteLocal, type AceitePublico, type AceiteRetrato, type CanalPedido, type PendenciaAceite,
} from "@/lib/os/aceite";

export class ErroAceite extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const TEMPLATE_ACEITE = "OS_CONFIRMACAO";
const novoToken = () => randomBytes(24).toString("base64url");
const limpo = (v: string | null | undefined) => (v ?? "").trim();

/** O que as telas leem do aceite — a assinatura (imagem) só vem quando pedida */
const SELECT_ACEITE = {
  id: true, token: true, situacao: true, metodo: true, nome: true, observacao: true, ip: true, confirmadoEm: true,
  enviadoEm: true, enviadoCanal: true, enviadoPara: true, envios: true, colhidoPor: { select: { nome: true } },
} satisfies Prisma.OsAceiteSelect;
type Linha = Prisma.OsAceiteGetPayload<{ select: typeof SELECT_ACEITE }> & { assinatura?: string | null };

export interface AceiteDaOs {
  token: string; situacao: string; metodo: string | null; nome: string | null; observacao: string | null; ip: string | null;
  confirmadoEm: string | null; colhidoPor: string | null; assinatura: string | null;
  enviadoEm: string | null; enviadoCanal: string | null; enviadoPara: string | null; envios: number;
}
const serializar = (a: Linha): AceiteDaOs => ({
  token: a.token, situacao: a.situacao, metodo: a.metodo, nome: a.nome, observacao: a.observacao, ip: a.ip,
  confirmadoEm: a.confirmadoEm?.toISOString() ?? null, colhidoPor: a.colhidoPor?.nome ?? null, assinatura: a.assinatura ?? null,
  enviadoEm: a.enviadoEm?.toISOString() ?? null, enviadoCanal: a.enviadoCanal, enviadoPara: a.enviadoPara, envios: a.envios,
});

/**
 * A OS concluiu: garante o aceite PENDENTE dela. Idempotente (a chave única da OS decide): chamar de
 * novo — OS reaberta e concluída outra vez, duas ações ao mesmo tempo — não cria outro nem mexe no que há.
 */
export async function garantirAceite(osId: string, empresaId: string): Promise<void> {
  await prisma.osAceite.createMany({ data: [{ empresaId, ordemServicoId: osId, token: novoToken() }], skipDuplicates: true });
}

/** O aceite da OS desta empresa (null = OS sem aceite, ou OS de outra empresa) */
export async function aceiteDaOs(osId: string, empresaId: string, op: { comAssinatura?: boolean } = {}): Promise<AceiteDaOs | null> {
  const a = await prisma.osAceite.findFirst({ where: { ordemServicoId: osId, empresaId }, select: { ...SELECT_ACEITE, assinatura: !!op.comAssinatura } });
  return a ? serializar(a) : null;
}

export interface OrigemDoAceite { ip?: string | null; userAgent?: string | null }
const navegador = (ua: string | null | undefined) => limpo(ua).slice(0, 300) || null;

/* ───────── no local ───────── */

/**
 * O responsável do cliente assinou na tela de quem está no local. `exigirOsConcluida`: no escritório
 * a OS tem de estar concluída; pela fila do app do técnico basta a atividade dele estar (o app só
 * oferece o aceite na última atividade da OS — e uma assinatura colhida nunca é jogada fora).
 * Já confirmado: não regrava (devolve o que está, com `jaEstava`).
 */
export async function registrarAceiteLocal(
  quem: { empresaId: string; usuarioId: string; osId: string; atividadeId?: string | null; exigirOsConcluida: boolean },
  dados: AceiteLocal, origem: OrigemDoAceite = {}, agora: Date = new Date(),
): Promise<{ aceite: AceiteDaOs; jaEstava: boolean }> {
  const os = await prisma.ordemServico.findFirst({ where: { id: quem.osId, empresaId: quem.empresaId }, select: { id: true, status: true } });
  if (!os) throw new ErroAceite("OS não encontrada", 404);
  if (os.status === "CANCELADA") throw new ErroAceite(MSG_OS_CANCELADA, 409);
  if (quem.exigirOsConcluida && os.status !== "CONCLUIDA") throw new ErroAceite(MSG_OS_NAO_CONCLUIDA, 409);
  await garantirAceite(os.id, quem.empresaId);
  const { count } = await prisma.osAceite.updateMany({
    where: { ordemServicoId: os.id, empresaId: quem.empresaId, situacao: "PENDENTE" },
    data: {
      situacao: "CONFIRMADO", metodo: "LOCAL", nome: dados.nome, assinatura: dados.assinatura, confirmadoEm: agora,
      ip: origem.ip ?? null, userAgent: navegador(origem.userAgent), atividadeId: quem.atividadeId ?? null, colhidoPorId: quem.usuarioId,
    },
  });
  if (count) await prisma.osHistorico.create({ data: { ordemServicoId: os.id, usuarioId: quem.usuarioId, acao: ACAO_ACEITE, detalhes: `No local, por ${dados.nome} (assinatura colhida na tela)`.slice(0, 500) } });
  return { aceite: (await aceiteDaOs(os.id, quem.empresaId))!, jaEstava: !count };
}

/* ───────── remoto: o pedido ───────── */

const SELECT_OS_PEDIDO = {
  id: true, numero: true, status: true, clienteId: true,
  cliente: { select: { id: true, nome: true, nomeFantasia: true, celular: true, emailReceberOs: true, emailsCopia: true } },
  contatoOrigem: { select: { nome: true, email: true, whatsapp: true, ativo: true } },
  empresa: { select: { nome: true, nomeFantasia: true } },
} satisfies Prisma.OrdemServicoSelect;

export interface PedidoDeAceite {
  publicUrl: string; mensagem: string; canal: CanalPedido;
  /** Abre o WhatsApp de quem clicou, com a mensagem pronta (null = sem número, ou número não liberado para o app) */
  whatsappUrl: string | null;
  emailEnviado: boolean; emailPara: string | null; erroEmail: string | null;
}

/**
 * "Enviar ao cliente": gera (ou reaproveita) o link de confirmação, manda o e-mail pelo envio da
 * empresa e devolve o link do WhatsApp com a mensagem pronta. `restrito` = técnico do app: o número
 * do cliente só vai para o aparelho com "Exibir contatos do cliente" ligado (o e-mail sai do servidor).
 */
export async function pedirAceite(ator: { empresaId: string; usuarioId: string; restrito: boolean }, osId: string, origem: string, agora: Date = new Date()): Promise<PedidoDeAceite> {
  const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId: ator.empresaId }, select: SELECT_OS_PEDIDO });
  if (!os) throw new ErroAceite("OS não encontrada", 404);
  const atual = await aceiteDaOs(os.id, ator.empresaId);
  const motivo = motivoSemAceite(os.status, atual);
  if (motivo) throw new ErroAceite(motivo, 409);
  await garantirAceite(os.id, ator.empresaId);
  const { token } = (await aceiteDaOs(os.id, ator.empresaId))!;

  const publicUrl = `${origem}${caminhoPublicoAceite(token)}`;
  const empresa = limpo(os.empresa.nomeFantasia) || os.empresa.nome;
  const mensagem = mensagemPedido({ contato: os.contatoOrigem?.ativo ? os.contatoOrigem.nome : null, numeroOs: os.numero, empresa, url: publicUrl });

  const numero = await whatsappParaAviso(os);
  const numeroLiberado = !ator.restrito || (await carregarConfigApp(ator.empresaId)).exibirContatosCliente;
  const whatsappUrl = numero && numeroLiberado ? whatsappLink(numero, mensagem) : null;

  let emailEnviado = false, emailPara: string | null = null, erroEmail: string | null = null;
  const dest = await destinatariosDaOs(os);
  if ("motivo" in dest) erroEmail = dest.motivo;
  else if (!(await emailConfigAtiva(ator.empresaId))) erroEmail = "e-mail da empresa não configurado";
  else {
    let envio: { ok: boolean; erro?: string };
    try {
      envio = await enviarEmail(ator.empresaId, {
        tipo: TEMPLATE_ACEITE, para: dest.para, cc: dest.cc, referenciaId: os.id, referenciaTipo: "OrdemServico",
        variaveis: { cliente_nome: limpo(os.cliente.nomeFantasia) || os.cliente.nome, numero_os: os.numero, link_documento: publicUrl },
      });
    } catch (e) {
      console.error("[aceite do cliente] falha ao enviar o e-mail", e);
      envio = { ok: false, erro: "erro inesperado" };
    }
    if (envio.ok) { emailEnviado = true; emailPara = dest.para; }
    else erroEmail = `falha no envio: ${envio.erro ?? "sem detalhe"}`;
  }

  const canal = canalDoPedido({ whatsapp: !!whatsappUrl, email: emailEnviado });
  const para = [emailPara, whatsappUrl ? `WhatsApp ${numero}` : null].filter(Boolean).join(" · ") || null;
  await prisma.osAceite.updateMany({ where: { ordemServicoId: os.id, empresaId: ator.empresaId }, data: { enviadoEm: agora, enviadoCanal: canal, enviadoPara: para?.slice(0, 200) ?? null, envios: { increment: 1 } } });
  await prisma.osHistorico.create({
    data: { ordemServicoId: os.id, usuarioId: ator.usuarioId, acao: ACAO_PEDIDO, detalhes: [textoDoCanal(canal), para].filter(Boolean).join(": ").slice(0, 500) },
  });
  return { publicUrl, mensagem, canal, whatsappUrl, emailEnviado, emailPara, erroEmail };
}

/* ───────── remoto: a confirmação pelo link ───────── */

const SELECT_PUBLICO = {
  ...SELECT_ACEITE, empresaId: true, contatoId: true,
  ordemServico: { select: { id: true, numero: true, status: true, clienteId: true, criadoPorId: true, dataConclusao: true } },
} satisfies Prisma.OsAceiteSelect;

/** O aceite pelo token do link (null = token que não existe) */
export async function aceitePorToken(token: string) {
  if (!token || token.length > 200) return null;
  return prisma.osAceite.findUnique({ where: { token }, select: SELECT_PUBLICO });
}

/**
 * O cliente confirmou pelo link: grava o nome, o IP, o navegador e a data/hora. Só confirma o que
 * está PENDENTE, de uma OS concluída; a troca é atômica. `contatoId`: quando quem confirma está
 * logado no portal do MESMO cliente.
 */
export async function confirmarAceitePublico(
  token: string, dados: AceitePublico, origem: OrigemDoAceite & { contato?: { id: string; clienteId: string; empresaId: string } | null } = {}, agora: Date = new Date(),
): Promise<{ confirmadoEm: string; nome: string }> {
  const a = await aceitePorToken(token);
  if (!a) throw new ErroAceite("Link de confirmação não encontrado", 404);
  const os = a.ordemServico;
  if (os.status === "CANCELADA") throw new ErroAceite(MSG_OS_CANCELADA, 409);
  if (a.situacao === "CONFIRMADO") throw new ErroAceite(MSG_JA_CONFIRMADO, 409);
  if (os.status !== "CONCLUIDA") throw new ErroAceite("Este serviço não está disponível para confirmação agora.", 409);
  const doCliente = origem.contato && origem.contato.clienteId === os.clienteId && origem.contato.empresaId === a.empresaId ? origem.contato.id : null;
  const { count } = await prisma.osAceite.updateMany({
    where: { id: a.id, situacao: "PENDENTE" },
    data: { situacao: "CONFIRMADO", metodo: "REMOTO", nome: dados.nome, observacao: dados.observacao, confirmadoEm: agora, ip: origem.ip ?? null, userAgent: navegador(origem.userAgent), contatoId: doCliente },
  });
  if (count !== 1) throw new ErroAceite(MSG_JA_CONFIRMADO, 409);
  await prisma.osHistorico.create({
    data: {
      ordemServicoId: os.id, usuarioId: os.criadoPorId, acao: ACAO_ACEITE,
      detalhes: `Pelo link, por ${dados.nome}${origem.ip ? ` (IP ${origem.ip})` : ""}${dados.observacao ? `. Observação: ${dados.observacao}` : ""}`.slice(0, 1000),
    },
  });
  return { confirmadoEm: agora.toISOString(), nome: dados.nome };
}

/* ───────── portal ───────── */

/** As confirmações pendentes do cliente: OS concluídas com o aceite em aberto, da mais recente para a mais antiga */
export async function pendenciasDoCliente(empresaId: string, clienteId: string): Promise<PendenciaAceite[]> {
  const linhas = await prisma.osAceite.findMany({
    where: { empresaId, situacao: "PENDENTE", ordemServico: { clienteId, empresaId, status: "CONCLUIDA" } },
    orderBy: { ordemServico: { dataConclusao: "desc" } }, take: 50,
    select: { token: true, ordemServico: { select: { id: true, numero: true, descricao: true, dataConclusao: true, atividades: { where: { status: { not: "CANCELADA" } }, select: { tipoOs: { select: { nome: true } } } } } } },
  });
  return linhas.map(({ token, ordemServico: os }) => ({
    osId: os.id, numero: os.numero, token, concluidaEm: os.dataConclusao, servico: servicoDaOs(os.atividades.map((x) => x.tipoOs?.nome), os.descricao),
  }));
}

/** A opção da empresa: confirmar antes de abrir chamado novo (a saída de emergência existe sempre) */
export async function aceiteObrigatorioNoPortal(empresaId: string): Promise<boolean> {
  const c = await prisma.configuracao.findUnique({ where: { empresaId }, select: { portalAceiteObrigatorio: true } });
  return !!c?.portalAceiteObrigatorio;
}

/* ───────── app do técnico ───────── */

/** O que o retrato da atividade leva para o app decidir se oferece o aceite */
export async function aceiteParaRetrato(empresaId: string, osId: string, atividadeId: string): Promise<AceiteRetrato | null> {
  const os = await prisma.ordemServico.findFirst({
    where: { id: osId, empresaId },
    select: { status: true, aceite: { select: { situacao: true, nome: true, confirmadoEm: true } }, atividades: { where: { id: { not: atividadeId }, status: { notIn: ["CONCLUIDA", "CANCELADA"] } }, select: { id: true }, take: 1 } },
  });
  if (!os || os.status === "CANCELADA") return null;
  return {
    situacao: os.aceite?.situacao ?? null, nome: os.aceite?.nome ?? null, confirmadoEm: os.aceite?.confirmadoEm?.toISOString() ?? null,
    osConcluida: os.status === "CONCLUIDA", ultimaDaOs: os.atividades.length === 0,
  };
}

/**
 * A operação "aceite" da fila do app: o cliente assinou no aparelho do técnico. A atividade dele já
 * está concluída (a fila manda "concluir" antes); a OS conclui junto quando era a última. Reenviar
 * não regrava, e quem chega depois de um aceite já feito recebe o que está valendo.
 */
export async function aceiteNoLocal(ctx: ContextoExecucao, dados: AceiteLocal, origem: OrigemDoAceite = {}, agora: Date = new Date()): Promise<ResultadoAcao<{ situacao: string; nome: string | null; confirmadoEm: string | null; jaEstava: boolean }>> {
  if (ctx.atividade.status !== "CONCLUIDA") return { ok: false, status: 409, erro: "Conclua a atividade antes de colher o aceite do cliente." };
  try {
    const r = await registrarAceiteLocal(
      { empresaId: ctx.empresaId, usuarioId: ctx.usuarioId, osId: ctx.atividade.ordemServico.id, atividadeId: ctx.atividade.id, exigirOsConcluida: false }, dados, origem, agora,
    );
    return { ok: true, status: r.jaEstava ? 200 : 201, dados: { situacao: r.aceite.situacao, nome: r.aceite.nome, confirmadoEm: r.aceite.confirmadoEm, jaEstava: r.jaEstava } };
  } catch (e) {
    if (e instanceof ErroAceite) return { ok: false, status: e.status, erro: e.message };
    throw e;
  }
}
