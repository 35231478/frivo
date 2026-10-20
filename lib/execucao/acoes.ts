/**
 * Execução da OS — AÇÕES de gravação, as mesmas para a tela da OS (rotas REST) e para o app do
 * técnico (sincronização offline). Cada ação é INCREMENTAL e idempotente: grava só o que veio, nunca
 * apaga o que já subiu e, repetida, dá o mesmo resultado (fotos/serviços com o id gerado no aparelho
 * — `clientId` — não duplicam). O técnico só CAPTURA: medição é número + unidade, sem avaliar.
 */
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { TIPOS_IMAGEM } from "@/lib/anexos";
import { validarDataUrl } from "@/lib/anexos-server";
import { carregarExecucao } from "@/lib/execucao/dados";
import { itemDoEquipamento, marcarAtendido, type ContextoExecucao } from "@/lib/execucao/contexto";
import { validarAudio } from "@/lib/execucao/audio";
import { equipamentosDoCliente, nomeEquipamento } from "@/lib/execucao/vinculos";

export type ResultadoAcao<T = Record<string, unknown>> =
  | { ok: true; status: number; dados: T }
  | { ok: false; status: number; erro: string; extra?: Record<string, unknown> };

const ok = <T>(dados: T, status = 200): ResultadoAcao<T> => ({ ok: true, status, dados });
const erro = (status: number, mensagem: string, extra?: Record<string, unknown>): ResultadoAcao<never> => ({ ok: false, status, erro: mensagem, extra });

/** Fotos por equipamento numa atividade */
export const MAX_FOTOS_EQUIPAMENTO = 40;
export const MAX_FOTOS_ADICIONAL = 20;
const TAMANHO_MAX_FOTO = 5 * 1024 * 1024;
const MSG_FOTO = "Envie uma foto (JPG, PNG, WEBP ou HEIC).";
/** Maior número que cabe na coluna (DECIMAL 12,3) */
const VALOR_MAX = 999_999_999;

const clientIdSchema = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, "Identificador inválido.");
const ehDuplicado = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/* ───────────────────────── Checklist ───────────────────────── */

export const respostaSchema = z.object({
  status: z.enum(["OK", "ATENCAO", "NAO_SE_APLICA"]).nullable().optional(),
  observacao: z.string().max(2000, "Observação com no máximo 2.000 caracteres.").nullable().optional(),
  valor: z.number({ invalid_type_error: "Informe um número." }).finite("Informe um número.").nullable().optional(),
  unidade: z.string().trim().max(20, "Unidade com no máximo 20 caracteres.").nullable().optional(),
}).strict().refine((d) => d.status !== undefined || d.observacao !== undefined || d.valor !== undefined || d.unidade !== undefined, "Nada para gravar.");
export type RespostaEntrada = z.infer<typeof respostaSchema>;

/**
 * Responde UM item do checklist de UM equipamento. Só muda o que veio (a observação não apaga o
 * status e vice-versa). Item de MEDIÇÃO: número + unidade (padrão = a do item), ou "Não se aplica";
 * OK/Atenção não valem para medição (o técnico não avalia o valor).
 */
export async function responderItem(ctx: ContextoExecucao, itemId: string, d: RespostaEntrada) {
  const vinculo = ctx.vinculo!;
  const item = await itemDoEquipamento(ctx.empresaId, ctx.atividade.id, vinculo.equipamento, itemId);
  if (!item) return erro(400, "Este item não é do checklist deste equipamento.");

  const medicao = item.tipoResposta === "MEDICAO";
  let { status, valor, unidade } = d;
  if (medicao) {
    if (status === "OK" || status === "ATENCAO") return erro(400, "Item de medição: informe o número (ou “Não se aplica”).");
    if (valor !== undefined && valor !== null) {
      if (Math.abs(valor) > VALOR_MAX) return erro(400, "Número grande demais para uma medição.");
      valor = Math.round(valor * 1000) / 1000;
      status = null; // mediu: deixa de ser "Não se aplica"
    }
    if (status === "NAO_SE_APLICA") valor = null;
  } else if ((valor !== undefined && valor !== null) || (unidade !== undefined && unidade !== null)) {
    return erro(400, "Este item não é de medição.");
  } else {
    valor = undefined; unidade = undefined;
  }
  if (unidade !== undefined) unidade = unidade?.trim() || null;

  const atividadeId = ctx.atividade.id;
  const equipamentoId = vinculo.equipamento.id;
  const observacao = d.observacao === undefined ? undefined : (d.observacao ?? "").trim() || null;
  const atual = await prisma.checklistResposta.findUnique({
    where: { atividadeId_equipamentoId_itemId: { atividadeId, equipamentoId, itemId } },
    select: { unidade: true },
  });
  // Mediu sem dizer a unidade: fica a que já estava, senão a padrão do item
  if (medicao && valor !== undefined && valor !== null && unidade === undefined) unidade = atual?.unidade ?? item.unidade ?? null;

  const agora = new Date();
  const r = await prisma.checklistResposta.upsert({
    where: { atividadeId_equipamentoId_itemId: { atividadeId, equipamentoId, itemId } },
    create: {
      empresaId: ctx.empresaId, atividadeId, equipamentoId, itemId, textoItem: item.texto,
      status: status ?? null, observacao: observacao ?? null, valor: valor ?? null, unidade: unidade ?? null,
      respondidoPorId: ctx.usuarioId, respondidoEm: agora,
    },
    update: {
      ...(status !== undefined && { status }),
      ...(observacao !== undefined && { observacao }),
      ...(valor !== undefined && { valor }),
      ...(unidade !== undefined && { unidade }),
      textoItem: item.texto, respondidoPorId: ctx.usuarioId, respondidoEm: agora,
    },
    select: { itemId: true, status: true, observacao: true, valor: true, unidade: true },
  });
  if (r.status || r.observacao || r.valor !== null) await marcarAtendido(vinculo);
  return ok({ ...r, valor: r.valor === null ? null : r.valor.toNumber(), feito: vinculo.feito });
}

/** Observação em ÁUDIO de um item (null tira o áudio). Vale como a observação do item. */
export async function gravarAudio(ctx: ContextoExecucao, itemId: string, dataUrl: string | null) {
  const vinculo = ctx.vinculo!;
  const item = await itemDoEquipamento(ctx.empresaId, ctx.atividade.id, vinculo.equipamento, itemId);
  if (!item) return erro(400, "Este item não é do checklist deste equipamento.");
  let audioUrl: string | null = null;
  if (dataUrl !== null) {
    const v = validarAudio(dataUrl);
    if (!v.ok) return erro(400, v.erro);
    audioUrl = v.dataUrl;
  }
  const atividadeId = ctx.atividade.id;
  const equipamentoId = vinculo.equipamento.id;
  const r = await prisma.checklistResposta.upsert({
    where: { atividadeId_equipamentoId_itemId: { atividadeId, equipamentoId, itemId } },
    create: {
      empresaId: ctx.empresaId, atividadeId, equipamentoId, itemId, textoItem: item.texto, audioUrl,
      respondidoPorId: ctx.usuarioId, respondidoEm: new Date(),
    },
    update: { audioUrl, respondidoPorId: ctx.usuarioId, respondidoEm: new Date() },
    select: { id: true, itemId: true },
  });
  if (audioUrl) await marcarAtendido(vinculo);
  return ok({ itemId: r.itemId, audioId: audioUrl ? r.id : null, feito: vinculo.feito });
}

/**
 * "TUDO OK": marca como OK, num toque, os itens ATIVOS do checklist (OK/Atenção/N.A.) que ainda
 * estão SEM resposta. O que já foi respondido (inclusive Atenção) fica como está; medição não entra
 * (precisa do número).
 */
export async function tudoOk(ctx: ContextoExecucao) {
  const vinculo = ctx.vinculo!;
  const tipoId = vinculo.equipamento.tipoEquipamentoId;
  if (!tipoId) return erro(400, "Este equipamento não tem tipo: não há checklist para marcar.");
  const atividadeId = ctx.atividade.id;
  const equipamentoId = vinculo.equipamento.id;
  const [itens, respostas] = await Promise.all([
    prisma.checklistTipoItem.findMany({ where: { tipoEquipamentoId: tipoId, empresaId: ctx.empresaId, ativo: true, tipoResposta: "OK_ATENCAO_NA" }, select: { id: true, texto: true } }),
    prisma.checklistResposta.findMany({ where: { atividadeId, equipamentoId }, select: { itemId: true, status: true } }),
  ]);
  const comStatus = new Set(respostas.filter((r) => r.status).map((r) => r.itemId));
  const marcar = itens.filter((i) => !comStatus.has(i.id));
  const agora = new Date();
  await prisma.$transaction(marcar.map((i) => prisma.checklistResposta.upsert({
    where: { atividadeId_equipamentoId_itemId: { atividadeId, equipamentoId, itemId: i.id } },
    create: { empresaId: ctx.empresaId, atividadeId, equipamentoId, itemId: i.id, textoItem: i.texto, status: "OK", respondidoPorId: ctx.usuarioId, respondidoEm: agora },
    update: { status: "OK", textoItem: i.texto, respondidoPorId: ctx.usuarioId, respondidoEm: agora },
  })));
  if (marcar.length) await marcarAtendido(vinculo);
  return ok({ marcados: marcar.map((i) => i.id), feito: vinculo.feito });
}

/* ───────────────────────── Formulário do tipo (Etapa 1) ───────────────────────── */

export const formularioSchema = z.object({
  formularioId: z.string().min(1),
  campoId: z.string().min(1),
  resposta: z.string().max(5000).nullable().optional(),
  arquivoUrl: z.string().nullable().optional(),
}).strict().refine((d) => d.resposta !== undefined || d.arquivoUrl !== undefined, "Nada para gravar.");

/**
 * Responde UM campo do formulário do tipo (tipo de OS × tipo de equipamento) para ESTE equipamento.
 * Só o campo enviado muda, só neste equipamento (nada é replicado para outro do mesmo tipo).
 */
export async function responderFormulario(ctx: ContextoExecucao, d: z.infer<typeof formularioSchema>) {
  const vinculo = ctx.vinculo!;
  const atividadeId = ctx.atividade.id;
  const equipamentoId = vinculo.equipamento.id;
  const { formularioId, campoId, resposta } = d;
  // O formulário precisa ser o deste tipo de equipamento neste tipo de OS (ou já ter resposta aqui)
  const mapeado = ctx.atividade.tipoOsId && vinculo.equipamento.tipoEquipamentoId
    ? await prisma.formTypeMapping.findFirst({
      where: { empresaId: ctx.empresaId, tipoOsId: ctx.atividade.tipoOsId, tipoEquipamentoId: vinculo.equipamento.tipoEquipamentoId, formularioTemplateId: formularioId },
      select: { id: true },
    })
    : null;
  const campo = await prisma.formularioCampo.findFirst({ where: { id: campoId, formularioId, formulario: { empresaId: ctx.empresaId } }, select: { id: true, tipo: true, ativo: true } });
  const ja = await prisma.respostaFormularioEquipamento.findFirst({ where: { atividadeId, equipamentoId, campoId }, select: { id: true } });
  if (!campo || (!mapeado && !ja) || (!campo.ativo && !ja)) return erro(400, "Este campo não é do formulário deste equipamento.");

  let arquivoUrl = d.arquivoUrl;
  if (arquivoUrl && campo.tipo === "FOTO") {
    const v = validarDataUrl(arquivoUrl, "foto.jpg", { tipos: TIPOS_IMAGEM, tamanhoMax: TAMANHO_MAX_FOTO, mensagemTipo: MSG_FOTO });
    if (!v.ok) return erro(400, v.erro);
    arquivoUrl = v.arquivo.conteudo;
  } else if (arquivoUrl && arquivoUrl.length > 300) {
    return erro(400, "Valor inválido para este campo.");
  }

  const agora = new Date();
  const r = await prisma.respostaFormularioEquipamento.upsert({
    where: { atividadeId_equipamentoId_campoId: { atividadeId, equipamentoId, campoId } },
    create: {
      empresaId: ctx.empresaId, atividadeId, equipamentoId, formularioId, campoId,
      resposta: resposta ?? null, arquivoUrl: arquivoUrl ?? null, respondidoPorId: ctx.atividade.tecnicoId, respondidoEm: agora,
    },
    update: {
      ...(resposta !== undefined && { resposta }),
      ...(arquivoUrl !== undefined && { arquivoUrl }),
      respondidoPorId: ctx.atividade.tecnicoId, respondidoEm: agora,
    },
    select: { campoId: true, resposta: true, arquivoUrl: true },
  });
  if ((r.resposta ?? "").trim() || r.arquivoUrl) await marcarAtendido(vinculo);
  return ok({ ...r, feito: vinculo.feito });
}

/* ───────────────────────── Fotos do equipamento ───────────────────────── */

export const fotoSchema = z.object({
  dataUrl: z.string().min(30),
  itemId: z.string().min(1).nullable().optional(),
  momento: z.enum(["ANTES", "DEPOIS"]).nullable().optional(),
  clientId: clientIdSchema.optional(),
}).strict().refine((d) => !(d.itemId && d.momento), "Foto de item não tem antes/depois.");
export type FotoEntrada = z.infer<typeof fotoSchema>;

/** Uma foto DESTE equipamento (antes/depois, de um item ou geral). Reenviar o mesmo `clientId` não duplica. */
export async function adicionarFoto(ctx: ContextoExecucao, d: FotoEntrada) {
  const vinculo = ctx.vinculo!;
  const atividadeId = ctx.atividade.id;
  const equipamentoId = vinculo.equipamento.id;
  const select = { id: true, itemId: true, momento: true, clientId: true, criadoEm: true } as const;
  if (d.clientId) {
    const ja = await prisma.fotoAtendimento.findUnique({ where: { clientId: d.clientId }, select: { ...select, atividadeId: true, equipamentoId: true, empresaId: true } });
    if (ja) {
      if (ja.empresaId !== ctx.empresaId || ja.atividadeId !== atividadeId || ja.equipamentoId !== equipamentoId) return erro(409, "Esta foto já foi enviada para outro atendimento.");
      const { atividadeId: _a, equipamentoId: _e, empresaId: _p, ...foto } = ja;
      return ok({ ...foto, feito: vinculo.feito });
    }
  }
  const itemId = d.itemId ?? null;
  if (itemId && !(await itemDoEquipamento(ctx.empresaId, atividadeId, vinculo.equipamento, itemId)))
    return erro(400, "Este item não é do checklist deste equipamento.");
  const v = validarDataUrl(d.dataUrl, "foto.jpg", { tipos: TIPOS_IMAGEM, tamanhoMax: TAMANHO_MAX_FOTO, mensagemTipo: MSG_FOTO });
  if (!v.ok) return erro(400, v.erro);
  const ja = await prisma.fotoAtendimento.count({ where: { atividadeId, equipamentoId } });
  if (ja >= MAX_FOTOS_EQUIPAMENTO) return erro(400, `Limite de ${MAX_FOTOS_EQUIPAMENTO} fotos por equipamento nesta atividade.`);
  try {
    const foto = await prisma.fotoAtendimento.create({
      data: {
        empresaId: ctx.empresaId, atividadeId, equipamentoId, itemId, momento: d.momento ?? null, clientId: d.clientId ?? null,
        url: v.arquivo.conteudo, criadoPorId: ctx.usuarioId,
      },
      select,
    });
    await marcarAtendido(vinculo);
    return ok({ ...foto, feito: true }, 201);
  } catch (e) {
    if (ehDuplicado(e) && d.clientId) return adicionarFoto(ctx, d); // enviada em paralelo: devolve a que ficou
    throw e;
  }
}

/** Tira UMA foto (por id ou pelo id do aparelho), com a atividade aberta. Nada mais é apagado. */
export async function removerFoto(ctx: ContextoExecucao, ref: { fotoId?: string; clientId?: string }) {
  if (!ref.fotoId && !ref.clientId) return erro(400, "Diga qual foto.");
  const { count } = await prisma.fotoAtendimento.deleteMany({
    where: { atividadeId: ctx.atividade.id, empresaId: ctx.empresaId, ...(ref.fotoId ? { id: ref.fotoId } : { clientId: ref.clientId }) },
  });
  // Pelo id do aparelho, "não achei" = já foi tirada (repetir não é erro)
  if (!count && ref.fotoId) return erro(404, "Foto não encontrada");
  return ok({ removidas: count });
}

/* ───────────────────────── Equipamento na atividade ───────────────────────── */

export const equipamentoSchema = z.object({
  feito: z.boolean().optional(),
  observacao: z.string().max(4000, "Observação com no máximo 4.000 caracteres.").nullable().optional(),
}).strict().refine((d) => d.feito !== undefined || d.observacao !== undefined, "Nada para gravar.");

/**
 * Atendido / não atendido e a observação deste equipamento na atividade. "Não atendido" não apaga
 * nada: o checklist e as fotos ficam guardados (só deixam de contar até marcar de novo).
 */
export async function marcarEquipamento(ctx: ContextoExecucao, d: z.infer<typeof equipamentoSchema>) {
  const vinculo = ctx.vinculo!;
  const { feito } = d;
  const observacao = d.observacao === undefined ? undefined : (d.observacao ?? "").trim() || null;
  const r = await prisma.atividadeEquipamento.update({
    where: { id: vinculo.id },
    data: {
      ...(feito !== undefined && { feito, feitoEm: feito ? (vinculo.feito ? undefined : new Date()) : null }),
      ...(observacao !== undefined && { observacao }),
      // Escreveu uma observação: o equipamento passa a contar como atendido
      ...(feito === undefined && observacao && !vinculo.feito && { feito: true, feitoEm: new Date() }),
    },
    select: { feito: true, observacao: true },
  });
  return ok(r);
}

/** Vincula equipamentos (da lista da unidade) à atividade. Só do cliente da OS e ativos; repetir não duplica. */
export async function vincularEquipamentos(ctx: ContextoExecucao, equipamentoIds: string[]) {
  const { validos, erro: msg } = await equipamentosDoCliente(ctx.empresaId, ctx.atividade.ordemServico.clienteId, equipamentoIds);
  if (msg) return erro(400, msg);
  await prisma.atividadeEquipamento.createMany({ data: validos.map((equipamentoId) => ({ atividadeId: ctx.atividade.id, equipamentoId })), skipDuplicates: true });
  return ok({ vinculados: validos });
}

/**
 * Resolve um QR escaneado (URL .../qr/<token>, token puro ou código QR-AAAA-NNNN) para o equipamento:
 * já vinculado à atividade → marca como atendido; ainda não → VINCULA (se for do cliente da OS e
 * estiver ativo) já como atendido. Equipamento de outro cliente nunca entra.
 */
export async function vincularPorQr(ctx: ContextoExecucao, valorLido: string) {
  const { empresaId } = ctx;
  const atividadeId = ctx.atividade.id;
  const valor = valorLido.trim();
  const m = valor.match(/\/qr\/([^/?#\s]+)/);
  const token = m ? m[1] : valor;
  const qrcode = await prisma.qrcode.findFirst({ where: { empresaId, OR: [{ tokenPublico: token }, { codigo: valor }] }, select: { equipamentoId: true } });
  if (!qrcode?.equipamentoId) return erro(404, "QR Code não reconhecido.");
  const equipamentoId = qrcode.equipamentoId;
  const eq = await prisma.equipamento.findFirst({
    where: { id: equipamentoId, empresaId },
    select: { nome: true, marca: true, modelo: true, ativo: true, unidade: { select: { clienteId: true } } },
  });
  if (!eq) return erro(404, "QR Code não reconhecido.");
  const nome = nomeEquipamento(eq);
  const vinculo = await prisma.atividadeEquipamento.findFirst({ where: { atividadeId, equipamentoId }, select: { id: true } });
  if (vinculo) {
    await prisma.atividadeEquipamento.update({ where: { id: vinculo.id }, data: { feito: true, feitoEm: new Date() } });
    return ok({ ok: true, vinculado: false, vinculoId: vinculo.id, equipamentoId, nome });
  }
  if (eq.unidade?.clienteId !== ctx.atividade.ordemServico.clienteId) return erro(409, `O ${nome} é de outro cliente: não entra nesta OS.`);
  if (!eq.ativo) return erro(409, `O ${nome} está inativo: reative o cadastro dele para usar na OS.`);
  const novo = await prisma.atividadeEquipamento.upsert({
    where: { atividadeId_equipamentoId: { atividadeId, equipamentoId } },
    create: { atividadeId, equipamentoId, feito: true, feitoEm: new Date() },
    update: { feito: true },
    select: { id: true },
  });
  return ok({ ok: true, vinculado: true, vinculoId: novo.id, equipamentoId, nome }, 201);
}

/* ───────────────────────── Serviço adicional ───────────────────────── */

export const adicionalSchema = z.object({
  clientId: clientIdSchema.optional(),
  id: z.string().min(1).optional(),
  descricao: z.string().trim().min(3, "Descreva o serviço adicional.").max(2000, "Descrição com no máximo 2.000 caracteres."),
  equipamentoId: z.string().min(1).nullable().optional(),
}).strict();

const selectAdicional = {
  id: true, clientId: true, descricao: true, equipamentoId: true, statusCobranca: true, criadoEm: true,
  fotos: { orderBy: { criadoEm: "asc" as const }, select: { id: true, clientId: true } },
} as const;

/** Acha o serviço adicional desta atividade pelo id ou pelo id do aparelho. */
async function acharAdicional(ctx: ContextoExecucao, ref: { id?: string; clientId?: string }) {
  if (!ref.id && !ref.clientId) return null;
  return prisma.servicoAdicional.findFirst({
    where: { atividadeId: ctx.atividade.id, empresaId: ctx.empresaId, ...(ref.id ? { id: ref.id } : { clientId: ref.clientId }) },
    select: { id: true },
  });
}

/**
 * Serviço a mais pedido na visita: entra na MESMA OS/atividade (nunca cria OS), com descrição,
 * equipamento (opcional, do cliente da OS) e fotos; sai destacado como "Adicional" no relatório e
 * fica "A avaliar" para o adm decidir a cobrança. Mesmo `clientId` = o mesmo serviço (edita).
 */
export async function salvarAdicional(ctx: ContextoExecucao, d: z.infer<typeof adicionalSchema>) {
  if (d.equipamentoId) {
    const { erro: msg } = await equipamentosDoCliente(ctx.empresaId, ctx.atividade.ordemServico.clienteId, [d.equipamentoId]);
    if (msg) return erro(400, msg);
  }
  const existente = await acharAdicional(ctx, d);
  if (d.id && !existente) return erro(404, "Serviço adicional não encontrado.");
  if (d.clientId && !existente) {
    const deOutro = await prisma.servicoAdicional.findUnique({ where: { clientId: d.clientId }, select: { id: true } });
    if (deOutro) return erro(409, "Este serviço adicional já foi enviado para outra atividade.");
  }
  const dados = { descricao: d.descricao, ...(d.equipamentoId !== undefined && { equipamentoId: d.equipamentoId }) };
  try {
    const s = existente
      ? await prisma.servicoAdicional.update({ where: { id: existente.id }, data: dados, select: selectAdicional })
      : await prisma.servicoAdicional.create({
        data: {
          ...dados, empresaId: ctx.empresaId, ordemServicoId: ctx.atividade.ordemServico.id, atividadeId: ctx.atividade.id,
          clientId: d.clientId ?? null, criadoPorId: ctx.usuarioId,
        },
        select: selectAdicional,
      });
    return ok(s, existente ? 200 : 201);
  } catch (e) {
    if (ehDuplicado(e) && d.clientId) return salvarAdicional(ctx, d);
    throw e;
  }
}

/** Tira um serviço adicional lançado por engano (atividade aberta). As fotos dele vão junto. */
export async function removerAdicional(ctx: ContextoExecucao, ref: { id?: string; clientId?: string }) {
  const s = await acharAdicional(ctx, ref);
  if (!s) return ref.id ? erro(404, "Serviço adicional não encontrado.") : ok({ removidos: 0 });
  await prisma.servicoAdicional.delete({ where: { id: s.id } });
  return ok({ removidos: 1 });
}

export const fotoAdicionalSchema = z.object({
  servicoId: z.string().min(1).optional(),
  servicoClientId: clientIdSchema.optional(),
  dataUrl: z.string().min(30),
  clientId: clientIdSchema.optional(),
}).strict().refine((d) => d.servicoId || d.servicoClientId, "Diga de qual serviço adicional é a foto.");

export async function fotoAdicional(ctx: ContextoExecucao, d: z.infer<typeof fotoAdicionalSchema>) {
  const s = await acharAdicional(ctx, { id: d.servicoId, clientId: d.servicoClientId });
  if (!s) return erro(404, "Serviço adicional não encontrado.");
  const select = { id: true, clientId: true } as const;
  if (d.clientId) {
    const ja = await prisma.servicoAdicionalFoto.findUnique({ where: { clientId: d.clientId }, select: { ...select, servicoId: true } });
    if (ja) return ja.servicoId === s.id ? ok({ id: ja.id, clientId: ja.clientId, servicoId: s.id }) : erro(409, "Esta foto já foi enviada para outro serviço.");
  }
  const v = validarDataUrl(d.dataUrl, "foto.jpg", { tipos: TIPOS_IMAGEM, tamanhoMax: TAMANHO_MAX_FOTO, mensagemTipo: MSG_FOTO });
  if (!v.ok) return erro(400, v.erro);
  if ((await prisma.servicoAdicionalFoto.count({ where: { servicoId: s.id } })) >= MAX_FOTOS_ADICIONAL)
    return erro(400, `Limite de ${MAX_FOTOS_ADICIONAL} fotos por serviço adicional.`);
  try {
    const f = await prisma.servicoAdicionalFoto.create({
      data: { empresaId: ctx.empresaId, servicoId: s.id, url: v.arquivo.conteudo, clientId: d.clientId ?? null, criadoPorId: ctx.usuarioId },
      select,
    });
    return ok({ ...f, servicoId: s.id }, 201);
  } catch (e) {
    if (ehDuplicado(e) && d.clientId) return fotoAdicional(ctx, d);
    throw e;
  }
}

export async function removerFotoAdicional(ctx: ContextoExecucao, ref: { fotoId?: string; clientId?: string }) {
  if (!ref.fotoId && !ref.clientId) return erro(400, "Diga qual foto.");
  const { count } = await prisma.servicoAdicionalFoto.deleteMany({
    where: { empresaId: ctx.empresaId, servico: { atividadeId: ctx.atividade.id }, ...(ref.fotoId ? { id: ref.fotoId } : { clientId: ref.clientId }) },
  });
  if (!count && ref.fotoId) return erro(404, "Foto não encontrada");
  return ok({ removidas: count });
}

/* ───────────────────────── Andamento da atividade ───────────────────────── */

/** O técnico começou: Agendada → Em andamento (as outras situações ficam como estão). */
export async function iniciarAtividade(ctx: ContextoExecucao) {
  if (ctx.atividade.status !== "AGENDADA") return ok({ status: ctx.atividade.status });
  const { count } = await prisma.atividadeOs.updateMany({ where: { id: ctx.atividade.id, status: "AGENDADA" }, data: { status: "EM_ANDAMENTO" } });
  if (count) {
    await prisma.osHistorico.create({
      data: { ordemServicoId: ctx.atividade.ordemServico.id, usuarioId: ctx.usuarioId, acao: "Status da atividade alterado", detalhes: `"${ctx.atividade.titulo}": AGENDADA → EM_ANDAMENTO (app do técnico)` },
    });
  }
  ctx.atividade.status = "EM_ANDAMENTO";
  return ok({ status: "EM_ANDAMENTO" });
}

/** A trava da conclusão (Etapa 1): pelo menos 1 atendido e cada atendido completo. */
export async function travaConclusao(empresaId: string, osId: string, atividadeId: string) {
  const exec = await carregarExecucao(empresaId, osId, atividadeId);
  if (exec && !exec.conclusao.ok) {
    return erro(422, exec.conclusao.mensagem ?? "Execução incompleta.", { pendencias: exec.conclusao.pendencias, semEquipamento: exec.conclusao.semEquipamento });
  }
  return null;
}

export const concluirSchema = z.object({ resumo: z.string().trim().max(4000, "Resumo com no máximo 4.000 caracteres.").nullable().optional() }).strict();

/**
 * Conclui a atividade com a trava da Etapa 1 (a mensagem diz o que falta, equipamento por
 * equipamento). Já concluída = nada a fazer (repetir não é erro); cancelada não conclui.
 */
export async function concluirAtividade(ctx: ContextoExecucao, d: z.infer<typeof concluirSchema>) {
  const { atividade } = ctx;
  if (atividade.status === "CONCLUIDA") return ok({ status: "CONCLUIDA", jaEstava: true });
  if (atividade.status === "CANCELADA") return erro(409, "Atividade cancelada: não pode ser concluída.");
  const trava = await travaConclusao(ctx.empresaId, atividade.ordemServico.id, atividade.id);
  if (trava) return trava;
  const resumo = d.resumo === undefined ? undefined : d.resumo || null;
  await prisma.atividadeOs.update({ where: { id: atividade.id }, data: { status: "CONCLUIDA", ...(resumo !== undefined && { resumo }) } });
  await prisma.osHistorico.create({
    data: { ordemServicoId: atividade.ordemServico.id, usuarioId: ctx.usuarioId, acao: "Status da atividade alterado", detalhes: `"${atividade.titulo}": ${atividade.status} → CONCLUIDA` },
  });
  atividade.status = "CONCLUIDA";
  return ok({ status: "CONCLUIDA", jaEstava: false });
}

/** Resposta HTTP de uma ação (rotas REST). */
export function respostaAcao(r: ResultadoAcao<unknown>): Response {
  return r.ok ? NextResponse.json(r.dados, { status: r.status }) : NextResponse.json({ erro: r.erro, ...r.extra }, { status: r.status });
}
