/**
 * Aviso ao cliente pelo app do técnico ("A caminho" / "Cheguei") — o lado do SERVIDOR. Reaproveita o
 * que o sistema já usa para falar com o cliente: o e-mail sai pelo mesmo envio (`enviarEmail`: Resend
 * da empresa, modelo editável, registro em email_logs), para os mesmos contatos das comunicações de
 * Ordens (`getEmailsComunicacao`), e o registro fica no histórico da OS (`OsHistorico`). O que é
 * próprio daqui:
 *  - o toque fica gravado em `atividade_avisos`, um por atividade/evento/dia — a chave única é o que
 *    impede o segundo aviso quando o técnico toca de novo (ou dois aparelhos tocam juntos);
 *  - o aviso só sai se o toque chegou dentro da janela (lib/tecnico/aviso-cliente): o que subiu tarde
 *    da fila do aparelho registra o horário e NÃO avisa;
 *  - WhatsApp: o sistema não tem integração de envio — o app abre o WhatsApp do técnico com a mensagem
 *    pronta. O número só vai para o aparelho com "Exibir contatos do cliente" ligado.
 */
import { CanalComunicacao, TipoComunicacao } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chaveDiaBR, diaCivilDeChave } from "@/lib/fuso";
import { emailConfigAtiva, enviarEmail, getContatosComunicacao, getEmailsComunicacao, montarDestinatarios } from "@/lib/email";
import { whatsappContatoPrincipal } from "@/lib/cliente/cobranca-destino";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import {
  ACAO_HISTORICO, EVENTOS_AVISO, TEMPLATE_AVISO, decidirAviso, horarioDoToque, recadoAviso,
  type AvisoCliente, type AvisoClienteRetrato, type AvisosTela, type EventoAviso, type StatusAviso,
} from "@/lib/tecnico/aviso-cliente";
import type { ContextoExecucao } from "@/lib/execucao/contexto";
import type { ResultadoAcao } from "@/lib/execucao/acoes";

const ok = <T>(dados: T, status = 200): ResultadoAcao<T> => ({ ok: true, status, dados });
const limpo = (v: string | null | undefined) => (v ?? "").trim();

/** O relógio do aparelho: `em` = hora do toque; `agoraAparelho` = hora do envio (o mesmo relógio). */
export interface RelogioAparelho { em?: string | null; agoraAparelho?: string | null }

const SELECT_OS = {
  id: true, numero: true, clienteId: true,
  cliente: { select: { id: true, nome: true, nomeFantasia: true, celular: true, emailReceberOs: true, emailsCopia: true } },
  contatoOrigem: { select: { email: true, whatsapp: true, ativo: true } },
} as const;

/**
 * Quem recebe o e-mail: o contato que abriu o chamado (se a OS tem um, ativo e com e-mail) e os
 * contatos das comunicações de Ordens do cliente — a mesma resolução dos outros e-mails de OS.
 */
export async function destinatariosDaOs(os: {
  cliente: { id: string; emailReceberOs: boolean; emailsCopia: string[] };
  contatoOrigem: { email: string | null; ativo: boolean } | null;
}): Promise<{ para: string; cc: string[] } | { motivo: string }> {
  if (!os.cliente.emailReceberOs) return { motivo: "o cliente não recebe e-mails de OS (cadastro do cliente)" };
  const doChamado = os.contatoOrigem?.ativo && limpo(os.contatoOrigem.email) ? [limpo(os.contatoOrigem.email)] : [];
  const dest = montarDestinatarios([...doChamado, ...await getEmailsComunicacao(os.cliente.id, TipoComunicacao.ORDENS)], os.cliente);
  return dest ?? { motivo: "o cliente não tem e-mail para avisos de OS" };
}

/**
 * O WhatsApp do cliente para o toque manual do técnico: o contato que abriu o chamado, depois o
 * contato das comunicações de Ordens que aceita WhatsApp, depois o contato principal / celular do cadastro.
 */
export async function whatsappParaAviso(os: {
  clienteId: string; cliente: { celular: string | null };
  contatoOrigem: { whatsapp: string | null; ativo: boolean } | null;
}): Promise<string | null> {
  if (os.contatoOrigem?.ativo && limpo(os.contatoOrigem.whatsapp)) return limpo(os.contatoOrigem.whatsapp);
  const deOrdens = (await getContatosComunicacao(os.clienteId, TipoComunicacao.ORDENS))
    .find((c) => (c.canal === CanalComunicacao.WHATSAPP || c.canal === CanalComunicacao.AMBOS) && limpo(c.whatsapp));
  if (deOrdens) return limpo(deOrdens.whatsapp);
  return whatsappContatoPrincipal(os.clienteId, os.cliente.celular);
}

/** O que foi registrado HOJE (Brasília) em cada uma destas atividades, por evento (uma consulta só). */
export async function avisosDeHojePorAtividade(atividadeIds: string[], agora: Date = new Date()): Promise<Map<string, AvisosTela>> {
  const porAtividade = new Map<string, AvisosTela>();
  if (!atividadeIds.length) return porAtividade;
  const dia = diaCivilDeChave(chaveDiaBR(agora))!;
  const linhas = await prisma.atividadeAviso.findMany({
    where: { atividadeId: { in: atividadeIds }, dia }, select: { atividadeId: true, evento: true, registradoEm: true, avisoStatus: true },
  });
  for (const l of linhas) {
    if (!(EVENTOS_AVISO as readonly string[]).includes(l.evento)) continue;
    const avisos = porAtividade.get(l.atividadeId) ?? {};
    avisos[l.evento as EventoAviso] = { em: l.registradoEm.toISOString(), status: l.avisoStatus as StatusAviso };
    porAtividade.set(l.atividadeId, avisos);
  }
  return porAtividade;
}

/** O que foi registrado HOJE (Brasília) nesta atividade, por evento. */
export async function avisosDeHoje(atividadeId: string, agora: Date = new Date()): Promise<AvisosTela> {
  return (await avisosDeHojePorAtividade([atividadeId], agora)).get(atividadeId) ?? {};
}

/**
 * O que o retrato da atividade leva para o app: null com a permissão desligada (os botões não
 * aparecem). O número do WhatsApp só sai do servidor com "Exibir contatos do cliente" ligado.
 */
export async function avisoParaRetrato(
  empresaId: string, config: { avisarCliente: boolean; exibirContatosCliente: boolean }, osId: string,
): Promise<AvisoClienteRetrato | null> {
  if (!config.avisarCliente) return null;
  const [empresa, os] = await Promise.all([
    prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true, nomeFantasia: true } }),
    config.exibirContatosCliente ? prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: SELECT_OS }) : null,
  ]);
  return {
    empresa: limpo(empresa?.nomeFantasia) || limpo(empresa?.nome),
    whatsapp: os ? await whatsappParaAviso(os) : null,
  };
}

/**
 * O técnico tocou "A caminho" / "Cheguei": grava o horário (uma vez por dia), avisa o cliente por
 * e-mail se ainda estiver em tempo e deixa no histórico da OS. Repetir não é erro e não avisa de novo.
 * Nunca falha por causa do e-mail: o horário fica, e o motivo de o aviso não ter saído também.
 */
export async function avisarCliente(ctx: ContextoExecucao, d: AvisoCliente, relogio: RelogioAparelho = {}, agora: Date = new Date()) {
  const { empresaId, atividade } = ctx;
  const { registradoEm, atrasoMs } = horarioDoToque(relogio.em, agora.getTime(), relogio.agoraAparelho);
  const dia = diaCivilDeChave(chaveDiaBR(registradoEm))!;
  const chave = { atividadeId_evento_dia: { atividadeId: atividade.id, evento: d.evento, dia } };

  // A chave única decide quem é o primeiro: só ele segue para o aviso
  const { count } = await prisma.atividadeAviso.createMany({
    data: [{ empresaId, atividadeId: atividade.id, evento: d.evento, dia, registradoEm, usuarioId: ctx.usuarioId }], skipDuplicates: true,
  });
  if (!count) {
    const ja = await prisma.atividadeAviso.findUnique({ where: chave, select: { registradoEm: true, avisoStatus: true } });
    return ok({ evento: d.evento, em: (ja?.registradoEm ?? registradoEm).toISOString(), status: (ja?.avisoStatus ?? "PENDENTE") as StatusAviso, jaEstava: true, aviso: null });
  }

  const [config, os, chegada] = await Promise.all([
    carregarConfigApp(empresaId),
    prisma.ordemServico.findFirst({ where: { id: atividade.ordemServico.id, empresaId }, select: SELECT_OS }),
    d.evento === "A_CAMINHO" ? prisma.atividadeAviso.findUnique({ where: { atividadeId_evento_dia: { atividadeId: atividade.id, evento: "CHEGOU", dia } }, select: { id: true } }) : null,
  ]);

  let status: StatusAviso;
  let detalhe: string | null = null;
  let para: string | null = null;
  const decisao = decidirAviso({ ligado: config.avisarCliente, atrasoMs, evento: d.evento, chegadaRegistrada: !!chegada });
  if (!decisao.enviar) ({ status, detalhe } = decisao);
  else if (!os) { status = "INDISPONIVEL"; detalhe = "OS não encontrada"; }
  else {
    const dest = await destinatariosDaOs(os);
    if ("motivo" in dest) { status = "SEM_DESTINO"; detalhe = dest.motivo; }
    else if (!(await emailConfigAtiva(empresaId))) { status = "INDISPONIVEL"; detalhe = "e-mail da empresa não configurado (Configurações › E-mail)"; }
    else {
      let envio: { ok: boolean; erro?: string };
      try {
        envio = await enviarEmail(empresaId, {
          tipo: TEMPLATE_AVISO[d.evento], para: dest.para, cc: dest.cc, referenciaId: os.id, referenciaTipo: "OrdemServico",
          variaveis: { cliente_nome: limpo(os.cliente.nomeFantasia) || os.cliente.nome, numero_os: os.numero },
        });
      } catch (e) {
        console.error("[aviso ao cliente] falha ao enviar o e-mail", e);
        envio = { ok: false, erro: "erro inesperado" };
      }
      if (envio.ok) { status = "ENVIADO"; para = dest.para; }
      else { status = "INDISPONIVEL"; detalhe = `falha no envio do e-mail: ${envio.erro ?? "sem detalhe"}`; }
    }
  }

  await prisma.atividadeAviso.update({
    where: chave, data: { avisoStatus: status, avisoDetalhe: detalhe?.slice(0, 500) ?? null, avisoPara: para, avisoEm: status === "ENVIADO" ? new Date() : null },
  });
  await prisma.osHistorico.create({
    data: {
      ordemServicoId: atividade.ordemServico.id, usuarioId: ctx.usuarioId, acao: ACAO_HISTORICO[d.evento], criadoEm: registradoEm,
      detalhes: `"${atividade.titulo}": ${status === "ENVIADO" ? `cliente avisado por e-mail (${para})` : `horário registrado; cliente não avisado — ${detalhe}`} (app do técnico)`.slice(0, 1000),
    },
  });

  return ok({ evento: d.evento, em: registradoEm.toISOString(), status, jaEstava: false, aviso: recadoAviso(d.evento, status) }, 201);
}
