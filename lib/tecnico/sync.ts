/**
 * Sincronização do app do técnico (offline-first). O aparelho guarda cada gravação como uma
 * OPERAÇÃO com id próprio (uuid) e manda a fila quando o sinal volta. Aqui:
 *  - cada operação vira a MESMA ação da tela da OS (lib/execucao/acoes) — mesmas regras e travas;
 *  - IDEMPOTENTE: operação já aplicada (sync_operacoes) devolve o resultado guardado, sem gravar de
 *    novo — reenviar depois de perder a resposta não duplica nada;
 *  - INCREMENTAL: cada operação grava só os campos dela; nada que já subiu é apagado por outra;
 *  - a ordem vale POR ATIVIDADE: se uma operação falha, as seguintes da mesma atividade ficam para a
 *    próxima rodada (não se conclui com uma resposta anterior pendente); as de outras atividades seguem;
 *  - a execução é do técnico: a gravação dele vale (a última), item a item.
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { carregarContexto, type Ator } from "@/lib/execucao/contexto";
import {
  adicionalSchema, adicionarFoto, concluirAtividade, concluirSchema, equipamentoSchema, formularioSchema, fotoAdicional, fotoAdicionalSchema, fotoSchema,
  gravarAudio, iniciarAtividade, marcarEquipamento, removerAdicional, removerFoto, removerFotoAdicional, respostaSchema, responderItem,
  responderFormulario, salvarAdicional, tudoOk, vincularEquipamentos, vincularPorQr, type ResultadoAcao,
} from "@/lib/execucao/acoes";

export const MAX_OPERACOES = 100;
/** Quanto tempo a marca de "já aplicada" fica guardada (reenvio depois disso é raríssimo) */
export const DIAS_GUARDA_OPERACAO = 30;

const id = z.string().min(1).max(64);
const ref = z.object({ id: id.optional(), clientId: id.optional() }).strict();
const base = { id: z.string().uuid("Operação sem identificador válido."), atividadeId: id, em: z.string().max(40).optional() };

export const operacaoSchema = z.discriminatedUnion("tipo", [
  z.object({ ...base, tipo: z.literal("iniciar") }).strict(),
  z.object({ ...base, tipo: z.literal("resposta"), equipamentoId: id, itemId: id, dados: respostaSchema }).strict(),
  z.object({ ...base, tipo: z.literal("audio"), equipamentoId: id, itemId: id, dataUrl: z.string().min(30).nullable() }).strict(),
  z.object({ ...base, tipo: z.literal("tudoOk"), equipamentoId: id }).strict(),
  z.object({ ...base, tipo: z.literal("foto"), equipamentoId: id, dados: fotoSchema }).strict(),
  z.object({ ...base, tipo: z.literal("fotoRemover"), dados: ref }).strict(),
  z.object({ ...base, tipo: z.literal("equipamento"), equipamentoId: id, dados: equipamentoSchema }).strict(),
  z.object({ ...base, tipo: z.literal("formulario"), equipamentoId: id, dados: formularioSchema }).strict(),
  z.object({ ...base, tipo: z.literal("vincular"), equipamentoIds: z.array(id).min(1).max(200) }).strict(),
  z.object({ ...base, tipo: z.literal("scan"), valor: z.string().min(1).max(500) }).strict(),
  z.object({ ...base, tipo: z.literal("adicional"), dados: adicionalSchema }).strict(),
  z.object({ ...base, tipo: z.literal("adicionalRemover"), dados: ref }).strict(),
  z.object({ ...base, tipo: z.literal("adicionalFoto"), dados: fotoAdicionalSchema }).strict(),
  z.object({ ...base, tipo: z.literal("adicionalFotoRemover"), dados: ref }).strict(),
  z.object({ ...base, tipo: z.literal("concluir"), dados: concluirSchema }).strict(),
]);
export type Operacao = z.infer<typeof operacaoSchema>;
export const loteSchema = z.object({ operacoes: z.array(z.unknown()).min(1).max(MAX_OPERACOES, `No máximo ${MAX_OPERACOES} operações por envio.`) }).strict();

export interface ResultadoOperacao {
  id: string;
  ok: boolean;
  status: number;
  dados?: unknown;
  erro?: string;
  extra?: Record<string, unknown>;
  /** Já tinha sido aplicada antes (reenvio) */
  repetida?: boolean;
  /** Não tentada: uma anterior da mesma atividade falhou (vai na próxima rodada) */
  adiada?: boolean;
}

const MSG_ADIADA = "Aguardando a gravação anterior desta OS.";

async function executar(ator: Ator, op: Operacao): Promise<ResultadoAcao<unknown>> {
  const equipamentoId = "equipamentoId" in op ? op.equipamentoId : undefined;
  const ctx = await carregarContexto(ator, op.atividadeId, { equipamentoId, permitirBloqueada: op.tipo === "concluir" });
  if (!ctx.ok) return { ok: false, status: ctx.status, erro: ctx.erro };
  switch (op.tipo) {
    case "iniciar": return iniciarAtividade(ctx);
    case "resposta": return responderItem(ctx, op.itemId, op.dados);
    case "audio": return gravarAudio(ctx, op.itemId, op.dataUrl);
    case "tudoOk": return tudoOk(ctx);
    case "foto": return adicionarFoto(ctx, op.dados);
    case "fotoRemover": return removerFoto(ctx, { fotoId: op.dados.id, clientId: op.dados.clientId });
    case "equipamento": return marcarEquipamento(ctx, op.dados);
    case "formulario": return responderFormulario(ctx, op.dados);
    case "vincular": return vincularEquipamentos(ctx, op.equipamentoIds);
    case "scan": return vincularPorQr(ctx, op.valor);
    case "adicional": return salvarAdicional(ctx, op.dados);
    case "adicionalRemover": return removerAdicional(ctx, op.dados);
    case "adicionalFoto": return fotoAdicional(ctx, op.dados);
    case "adicionalFotoRemover": return removerFotoAdicional(ctx, { fotoId: op.dados.id, clientId: op.dados.clientId });
    case "concluir": return concluirAtividade(ctx, op.dados);
  }
}

/** JSON puro (datas viram texto) para guardar o resultado. */
const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

/** Processa um lote, em ordem. Nunca lança por causa de uma operação: cada uma tem o seu resultado. */
export async function processarLote(ator: Ator, operacoes: unknown[]): Promise<ResultadoOperacao[]> {
  const resultados: ResultadoOperacao[] = [];
  const travadas = new Set<string>();
  const ids = operacoes.map((o) => (o && typeof o === "object" && typeof (o as { id?: unknown }).id === "string" ? (o as { id: string }).id : "")).filter(Boolean);
  const jaFeitas = new Map((await prisma.syncOperacao.findMany({
    where: { id: { in: ids } }, select: { id: true, empresaId: true, usuarioId: true, resultado: true },
  })).map((s) => [s.id, s]));

  for (const bruta of operacoes) {
    const parsed = operacaoSchema.safeParse(bruta);
    const idOp = (bruta as { id?: unknown })?.id;
    if (!parsed.success) {
      const atividadeId = (bruta as { atividadeId?: unknown })?.atividadeId;
      if (typeof atividadeId === "string") travadas.add(atividadeId);
      resultados.push({ id: typeof idOp === "string" ? idOp : "", ok: false, status: 400, erro: parsed.error.issues[0]?.message ?? "Operação inválida." });
      continue;
    }
    const op = parsed.data;
    const feita = jaFeitas.get(op.id);
    if (feita) {
      if (feita.empresaId !== ator.empresaId || feita.usuarioId !== ator.usuarioId) {
        resultados.push({ id: op.id, ok: false, status: 409, erro: "Identificador de operação já usado por outro usuário." });
        travadas.add(op.atividadeId);
      } else {
        resultados.push({ id: op.id, ok: true, status: 200, dados: feita.resultado, repetida: true });
      }
      continue;
    }
    if (travadas.has(op.atividadeId)) {
      resultados.push({ id: op.id, ok: false, status: 0, erro: MSG_ADIADA, adiada: true });
      continue;
    }
    let r: ResultadoAcao<unknown>;
    try {
      r = await executar(ator, op);
    } catch (e) {
      console.error("[sync técnico] falha ao aplicar operação", op.tipo, e);
      r = { ok: false, status: 500, erro: "Não foi possível gravar agora: o app tenta de novo sozinho." };
    }
    if (r.ok) {
      const resultado = json(r.dados);
      await prisma.syncOperacao.createMany({
        data: [{ id: op.id, empresaId: ator.empresaId, usuarioId: ator.usuarioId, tipo: op.tipo, atividadeId: op.atividadeId, resultado }],
        skipDuplicates: true,
      });
      jaFeitas.set(op.id, { id: op.id, empresaId: ator.empresaId, usuarioId: ator.usuarioId, resultado });
      resultados.push({ id: op.id, ok: true, status: r.status, dados: resultado });
    } else {
      travadas.add(op.atividadeId);
      resultados.push({ id: op.id, ok: false, status: r.status, erro: r.erro, ...(r.extra && { extra: json(r.extra) }) });
    }
  }
  return resultados;
}

/** Limpa as marcas antigas deste usuário (a tabela não cresce sem fim). */
export async function limparOperacoesAntigas(ator: Ator, agora = new Date()) {
  const limite = new Date(agora.getTime() - DIAS_GUARDA_OPERACAO * 24 * 60 * 60 * 1000);
  await prisma.syncOperacao.deleteMany({ where: { empresaId: ator.empresaId, usuarioId: ator.usuarioId, processadoEm: { lt: limite } } });
}
