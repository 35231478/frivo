/**
 * MATERIAIS USADOS EM CAMPO — lado do banco. As regras são as puras de lib/tecnico/materiais.ts.
 *
 *  - Técnico (fila do app, lib/tecnico/sync): grava/corrige a linha dele (`gravarMaterial`) e remove a linha
 *    dele com a atividade aberta (`removerMaterial`). Idempotente pelo `clientId`.
 *  - Escritório (OS › Materiais usados em campo): corrige a quantidade ou estorna QUALQUER linha da OS, com
 *    registro de quem fez (`corrigido_*` / `removido_*` + histórico da OS).
 *
 * Toda mudança acerta o estoque NA MESMA TRANSAÇÃO, só pela diferença (movimentar trava a linha do produto):
 *  - linha ligada a uma separação da OS: o consumo dela passa a ser a soma das linhas do campo (a reserva troca
 *    para saída; nunca baixa duas vezes) — o mesmo estado CONSUMIDO do fluxo do Estoque (E4.2);
 *  - linha sem separação: SAIDA direta (ESTORNO_SAIDA ao diminuir/estornar);
 *  - produto que não controla estoque, material fora do catálogo ou módulo Estoque desligado: só o registro.
 * Saldo negativo é permitido (o técnico não trava em campo): volta como aviso e o escritório vê no sino.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { agendarPush, notificarEstoqueNegativo } from "@/lib/push/eventos";
import { movimentar } from "@/lib/estoque/servidor";
import { arred } from "@/lib/estoque/regras";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";
import { medicaoValida } from "@/lib/os/status";
import type { ContextoExecucao } from "@/lib/execucao/contexto";
import {
  deltaBaixaDireta, escolherSeparacao, identificado, MSG_EQUIP_FORA, MSG_SEM_MATERIAL, MSG_MATERIAL_REMOVIDO, MSG_PRODUTO_INVALIDO, MSG_SO_O_SEU, MSG_SOBRA_DEVOLVIDA,
  planoAjusteConsumo, textoQuantidade, type DadosMaterial, type MaterialTela,
} from "@/lib/tecnico/materiais";

type Resultado<T> = { ok: true; status: number; dados: T } | { ok: false; status: number; erro: string };
const ok = <T>(dados: T, status = 200): Resultado<T> => ({ ok: true, status, dados });
const erro = (status: number, mensagem: string): Resultado<never> => ({ ok: false, status, erro: mensagem });

/** Recusa no meio da transação (desfaz tudo) com o status para a resposta. */
class ErroMaterial extends Error { constructor(readonly status: number, msg: string) { super(msg); } }

type Linha = {
  id: string; empresaId: string; ordemServicoId: string; atividadeId: string; clientId: string; produtoId: string | null; osMaterialId: string | null;
  veiculoId: string | null; quantidade: Prisma.Decimal; baixado: Prisma.Decimal; descricao: string; unidade: string; equipamentoId: string | null;
  criadoPorId: string | null; removidoEm: Date | null;
};
const SELECT_LINHA = {
  id: true, empresaId: true, ordemServicoId: true, atividadeId: true, clientId: true, produtoId: true, osMaterialId: true, veiculoId: true,
  quantidade: true, baixado: true, descricao: true, unidade: true, equipamentoId: true, criadoPorId: true, removidoEm: true,
} as const;

interface Acerto { avisos: string[]; mexeuNaSeparacao: boolean }

/**
 * Leva o estoque da linha ao que ela vale agora (`novaQtd`; 0 = removida/estornada), lançando só a diferença.
 * Roda dentro da transação de quem chama.
 */
async function acertarEstoque(tx: Prisma.TransactionClient, l: Linha, novaQtd: number, usuarioId: string, osNumero: string): Promise<Acerto> {
  const acerto: Acerto = { avisos: [], mexeuNaSeparacao: false };
  if (!l.produtoId) return acerto;
  const produto = await tx.produto.findFirst({ where: { id: l.produtoId, empresaId: l.empresaId }, select: { controlaEstoque: true } });
  if (!produto?.controlaEstoque) return acerto;
  const base = { empresaId: l.empresaId, produtoId: l.produtoId, usuarioId, refId: l.ordemServicoId, localId: l.veiculoId };
  const obs = `Uso em campo — OS ${osNumero} · ${l.descricao}`;
  const lancar = async (operacao: "SAIDA" | "ESTORNO_SAIDA" | "RESERVA" | "ESTORNO_RESERVA", valor: number) => {
    if (!(Math.abs(valor) > 0)) return null;
    const r = await movimentar({ ...base, operacao, valor: Math.abs(valor), observacao: obs }, tx);
    if (r.aviso) acerto.avisos.push(`${l.descricao}: ${r.aviso}`);
    // Ficou negativo: o escritório (quem vê o Estoque) recebe o push — um por produto por dia; relê o saldo depois
    if (r.saldo < 0) agendarPush(() => notificarEstoqueNegativo(l.empresaId, l.produtoId!, osNumero));
    return r;
  };

  if (l.osMaterialId) {
    const m = await tx.osMaterial.findFirst({ where: { id: l.osMaterialId, ordemServicoId: l.ordemServicoId }, select: { id: true, estadoSeparacao: true, quantidadeSeparada: true, quantidadeConsumida: true } });
    if (m) {
      if (m.estadoSeparacao === "DEVOLVIDO") throw new ErroMaterial(409, MSG_SOBRA_DEVOLVIDA);
      // O consumo da separação = a soma das linhas do campo ligadas a ela (as outras + esta, como fica)
      const outras = await tx.atividadeMaterial.aggregate({ where: { osMaterialId: m.id, removidoEm: null, id: { not: l.id } }, _sum: { quantidade: true } });
      const antes = Number(m.quantidadeConsumida);
      const depois = arred(Number(outras._sum.quantidade ?? 0) + novaQtd);
      const plano = planoAjusteConsumo(Number(m.quantidadeSeparada), antes, depois);
      // Primeiro a reserva (estorno), depois a saída: o saldo nunca "pisca" negativo à toa
      if (plano.reserva > 0) await lancar("ESTORNO_RESERVA", plano.reserva);
      if (plano.saida !== 0) await lancar(plano.saida > 0 ? "SAIDA" : "ESTORNO_SAIDA", plano.saida);
      if (plano.reserva < 0) await lancar("RESERVA", plano.reserva);
      const consumido = depois > 0;
      await tx.osMaterial.update({
        where: { id: m.id },
        data: consumido
          ? { quantidadeConsumida: depois, estadoSeparacao: "CONSUMIDO", consumidoEm: new Date(), consumidoPorId: usuarioId }
          : { quantidadeConsumida: 0, estadoSeparacao: Number(m.quantidadeSeparada) > 0 ? "SEPARADO" : null, consumidoEm: null, consumidoPorId: null },
      });
      acerto.mexeuNaSeparacao = antes !== depois;
      return acerto;
    }
  }
  // Sem separação: SAIDA direta pela diferença
  const delta = deltaBaixaDireta(Number(l.baixado), novaQtd);
  if (delta !== 0) {
    const r = await lancar(delta > 0 ? "SAIDA" : "ESTORNO_SAIDA", delta);
    // Módulo Estoque desligado: nada foi lançado, nada fica marcado como baixado
    if (r?.movimentacao) await tx.atividadeMaterial.update({ where: { id: l.id }, data: { baixado: novaQtd } });
  }
  return acerto;
}

/** De onde o material sai: o veículo da atividade; sem ele, o veículo padrão do técnico (ou do responsável). */
async function veiculoDoUso(ctx: ContextoExecucao): Promise<string | null> {
  const a = await prisma.atividadeOs.findUnique({ where: { id: ctx.atividade.id }, select: { veiculoId: true, tecnico: { select: { veiculoId: true } } } });
  if (a?.veiculoId) return a.veiculoId;
  if (ctx.escopo.tecnicoId) {
    const t = await prisma.tecnico.findFirst({ where: { id: ctx.escopo.tecnicoId, empresaId: ctx.empresaId }, select: { veiculoId: true } });
    if (t?.veiculoId) return t.veiculoId;
  }
  return a?.tecnico?.veiculoId ?? null;
}

const numeroDaOs = async (tx: Prisma.TransactionClient, osId: string) =>
  (await tx.ordemServico.findUnique({ where: { id: osId }, select: { numero: true, chamadoNumero: true } }).then((o) => o?.chamadoNumero ?? o?.numero)) ?? "";

function apresentar(l: Pick<Linha, "id" | "clientId" | "produtoId" | "descricao" | "unidade" | "quantidade" | "equipamentoId" | "criadoPorId">, usuarioId: string, nome: string | null = null): MaterialTela {
  return {
    id: l.id, clientId: l.clientId, produtoId: l.produtoId, descricao: l.descricao, unidade: l.unidade, quantidade: Number(l.quantidade),
    equipamentoId: l.equipamentoId, meu: l.criadoPorId === usuarioId, criadoPor: nome,
  };
}

async function executar<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | Resultado<never>> {
  try {
    return await prisma.$transaction(fn);
  } catch (e) {
    if (e instanceof ErroMaterial) return erro(e.status, e.message);
    if ((e as { code?: string })?.code === "P2002") return erro(409, "Gravação repetida: tente de novo.");
    throw e;
  }
}
const ehErro = (r: unknown): r is Resultado<never> => !!r && typeof r === "object" && "ok" in r && (r as { ok: boolean }).ok === false;

/* ───────── técnico (fila do app) ───────── */

/** Grava (ou corrige) o material usado. A mesma gravação reenviada não duplica nem baixa de novo. */
export async function gravarMaterial(ctx: ContextoExecucao, d: DadosMaterial): Promise<Resultado<{ material: MaterialTela; avisos: string[] }>> {
  const { empresaId, usuarioId } = ctx;
  const atividadeId = ctx.atividade.id;
  const osId = ctx.atividade.ordemServico.id;
  if (d.equipamentoId) {
    const v = await prisma.atividadeEquipamento.findFirst({ where: { atividadeId, equipamentoId: d.equipamentoId }, select: { id: true } });
    if (!v) return erro(404, MSG_EQUIP_FORA);
  }
  const existe = await prisma.atividadeMaterial.findUnique({ where: { empresaId_clientId: { empresaId, clientId: d.clientId } }, select: SELECT_LINHA });
  if (existe) {
    if (existe.atividadeId !== atividadeId) return erro(409, "Identificador de material já usado em outra atividade.");
    if (existe.removidoEm) return erro(409, MSG_MATERIAL_REMOVIDO);
    if (existe.criadoPorId !== usuarioId) return erro(403, MSG_SO_O_SEU);
  }
  else if (!identificado(d)) return erro(400, MSG_SEM_MATERIAL);
  const veiculoId = existe ? existe.veiculoId : await veiculoDoUso(ctx);
  let mexeu = false;
  const r = await executar(async (tx) => {
    const osNumero = await numeroDaOs(tx, osId);
    const qtd = arred(d.quantidade);
    if (existe) {
      const mesmo = Number(existe.quantidade) === qtd && (d.equipamentoId === undefined || (d.equipamentoId ?? null) === existe.equipamentoId);
      if (mesmo) return { material: apresentar(existe, usuarioId), avisos: [] as string[] };
      const acerto = await acertarEstoque(tx, existe, qtd, usuarioId, osNumero);
      mexeu = acerto.mexeuNaSeparacao;
      const nova = await tx.atividadeMaterial.update({
        where: { id: existe.id },
        data: { quantidade: qtd, ...(d.equipamentoId !== undefined && { equipamentoId: d.equipamentoId ?? null }) },
        select: SELECT_LINHA,
      });
      return { material: apresentar(nova, usuarioId), avisos: acerto.avisos };
    }
    let produto: { id: string; nome: string; unidade: string; controlaEstoque: boolean } | null = null;
    if (d.produtoId) {
      produto = await tx.produto.findFirst({ where: { id: d.produtoId, empresaId, ativo: true }, select: { id: true, nome: true, unidade: true, controlaEstoque: true } });
      if (!produto) throw new ErroMaterial(400, MSG_PRODUTO_INVALIDO);
    }
    // Separação desta OS que o uso consome (mesmo produto, ainda separada ou consumida pelo próprio campo)
    let osMaterialId: string | null = null;
    if (produto?.controlaEstoque) {
      const separacoes = await tx.osMaterial.findMany({
        where: { ordemServicoId: osId, produtoId: produto.id },
        select: { id: true, produtoId: true, estadoSeparacao: true, quantidadeSeparada: true, quantidadeConsumida: true, ordem: true, _count: { select: { usosCampo: { where: { removidoEm: null } } } } },
      });
      osMaterialId = escolherSeparacao(separacoes.map((m) => ({
        id: m.id, produtoId: m.produtoId, estadoSeparacao: m.estadoSeparacao, quantidadeSeparada: Number(m.quantidadeSeparada),
        quantidadeConsumida: Number(m.quantidadeConsumida), ordem: m.ordem, doCampo: m._count.usosCampo > 0,
      })), produto.id);
    }
    const criada = await tx.atividadeMaterial.create({
      data: {
        empresaId, ordemServicoId: osId, atividadeId, equipamentoId: d.equipamentoId ?? null, produtoId: produto?.id ?? null,
        descricao: produto?.nome ?? (d.descricao ?? "").trim(), unidade: produto?.unidade ?? ((d.unidade ?? "").trim() || "un"),
        quantidade: qtd, clientId: d.clientId, veiculoId, osMaterialId, criadoPorId: usuarioId,
      },
      select: SELECT_LINHA,
    });
    const acerto = await acertarEstoque(tx, { ...criada, quantidade: criada.quantidade }, qtd, usuarioId, osNumero);
    mexeu = acerto.mexeuNaSeparacao;
    return { material: apresentar(criada, usuarioId), avisos: acerto.avisos };
  });
  if (ehErro(r)) return r;
  // Consumo informado: o status automático da OS pode destravar (igual ao "Informar consumo" do Estoque)
  if (mexeu) await sincronizarStatusOs(osId, empresaId, usuarioId).catch(() => null);
  return ok(r, existe ? 200 : 201);
}

/** O técnico tira a linha DELE (atividade aberta — o contexto já garante). O estoque volta pela diferença. */
export async function removerMaterial(ctx: ContextoExecucao, ref: { id?: string; clientId?: string }): Promise<Resultado<{ removido: boolean }>> {
  const { empresaId, usuarioId } = ctx;
  const l = await prisma.atividadeMaterial.findFirst({
    where: { empresaId, atividadeId: ctx.atividade.id, ...(ref.clientId ? { clientId: ref.clientId } : { id: ref.id }) },
    select: SELECT_LINHA,
  });
  if (!l) return erro(404, "Material não encontrado nesta atividade.");
  if (l.removidoEm) return ok({ removido: true }); // reenvio: já está fora
  if (l.criadoPorId !== usuarioId) return erro(403, MSG_SO_O_SEU);
  return retirar(l, usuarioId, null);
}

async function retirar(l: Linha, usuarioId: string, historico: string | null): Promise<Resultado<{ removido: boolean }>> {
  let mexeu = false;
  const r = await executar(async (tx) => {
    const osNumero = await numeroDaOs(tx, l.ordemServicoId);
    const acerto = await acertarEstoque(tx, l, 0, usuarioId, osNumero);
    mexeu = acerto.mexeuNaSeparacao;
    await tx.atividadeMaterial.update({ where: { id: l.id }, data: { removidoEm: new Date(), removidoPorId: usuarioId } });
    if (historico) await tx.osHistorico.create({ data: { ordemServicoId: l.ordemServicoId, usuarioId, acao: "Material usado em campo estornado", detalhes: historico.slice(0, 1000) } });
    return { removido: true };
  });
  if (ehErro(r)) return r;
  if (mexeu) await sincronizarStatusOs(l.ordemServicoId, l.empresaId, usuarioId).catch(() => null);
  return ok(r);
}

/** O que a atividade tem de materiais usados (para o retrato do app). Nunca leva valor. */
export async function materiaisDaAtividade(empresaId: string, atividadeId: string, usuarioId: string): Promise<MaterialTela[]> {
  const linhas = await prisma.atividadeMaterial.findMany({ where: { empresaId, atividadeId, removidoEm: null }, orderBy: { criadoEm: "asc" }, select: SELECT_LINHA });
  const nomes = await nomesDeUsuarios(empresaId, linhas.map((l) => l.criadoPorId));
  return linhas.map((l) => apresentar(l, usuarioId, l.criadoPorId ? nomes.get(l.criadoPorId) ?? null : null));
}

async function nomesDeUsuarios(empresaId: string, ids: (string | null)[]) {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unicos.length) return new Map<string, string>();
  const us = await prisma.usuario.findMany({ where: { id: { in: unicos }, empresaId }, select: { id: true, nome: true } });
  return new Map(us.map((u) => [u.id, u.nome]));
}

/* ───────── escritório (OS) ───────── */

export interface LinhaEscritorio {
  id: string; atividadeId: string; atividade: string; equipamento: string | null; produtoId: string | null; descricao: string; unidade: string;
  quantidade: number; veiculo: string | null; daSeparacao: boolean; criadoPor: string | null; criadoEm: string;
  corrigidoPor: string | null; corrigidoEm: string | null; removidoPor: string | null; removidoEm: string | null;
}

/** As linhas da OS (inclusive as estornadas, para o registro), para o card do escritório. */
export async function materiaisCampoDaOs(empresaId: string, osId: string): Promise<LinhaEscritorio[] | null> {
  const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true } });
  if (!os) return null;
  const linhas = await prisma.atividadeMaterial.findMany({
    where: { empresaId, ordemServicoId: osId }, orderBy: { criadoEm: "asc" },
    select: {
      ...SELECT_LINHA, criadoEm: true, corrigidoEm: true, corrigidoPorId: true, removidoPorId: true,
      atividade: { select: { titulo: true } }, equipamento: { select: { nome: true, marca: true, modelo: true } },
    },
  });
  const veiculos = await prisma.veiculo.findMany({ where: { empresaId, id: { in: [...new Set(linhas.map((l) => l.veiculoId).filter((x): x is string => !!x))] } }, select: { id: true, placa: true, modelo: true } });
  const placa = new Map(veiculos.map((v) => [v.id, `${v.placa} · ${v.modelo}`]));
  const nomes = await nomesDeUsuarios(empresaId, linhas.flatMap((l) => [l.criadoPorId, l.corrigidoPorId, l.removidoPorId]));
  const nome = (u: string | null) => (u ? nomes.get(u) ?? null : null);
  return linhas.map((l) => ({
    id: l.id, atividadeId: l.atividadeId, atividade: l.atividade.titulo,
    equipamento: l.equipamento ? (l.equipamento.nome || `${l.equipamento.marca} ${l.equipamento.modelo}`).trim() : null,
    produtoId: l.produtoId, descricao: l.descricao, unidade: l.unidade, quantidade: Number(l.quantidade),
    veiculo: l.veiculoId ? placa.get(l.veiculoId) ?? null : null, daSeparacao: !!l.osMaterialId,
    criadoPor: nome(l.criadoPorId), criadoEm: l.criadoEm.toISOString(),
    corrigidoPor: nome(l.corrigidoPorId), corrigidoEm: l.corrigidoEm?.toISOString() ?? null,
    removidoPor: nome(l.removidoPorId), removidoEm: l.removidoEm?.toISOString() ?? null,
  }));
}

/** OS já numa medição/fatura válida: o uso em campo não muda mais (o faturamento já contou). */
async function travadaPeloFaturamento(osId: string) {
  const os = await prisma.ordemServico.findUnique({ where: { id: osId }, select: { status: true, medicaoItens: { select: { medicao: { select: { status: true } } } } } });
  if (!os) return "OS não encontrada.";
  if (os.medicaoItens.some((mi) => medicaoValida(mi.medicao))) return "OS já está numa medição: o material usado não pode mais ser alterado.";
  return null;
}

async function linhaDaOs(empresaId: string, osId: string, linhaId: string) {
  return prisma.atividadeMaterial.findFirst({ where: { id: linhaId, empresaId, ordemServicoId: osId }, select: SELECT_LINHA });
}

/** Escritório corrige a quantidade de uma linha do campo (registra quem e quando, e no histórico da OS). */
export async function corrigirMaterialEscritorio(empresaId: string, osId: string, linhaId: string, usuarioId: string, quantidade: number): Promise<Resultado<{ avisos: string[] }>> {
  const l = await linhaDaOs(empresaId, osId, linhaId);
  if (!l) return erro(404, "Material não encontrado nesta OS.");
  if (l.removidoEm) return erro(409, MSG_MATERIAL_REMOVIDO);
  const trava = await travadaPeloFaturamento(osId);
  if (trava) return erro(409, trava);
  const qtd = arred(quantidade);
  if (qtd === Number(l.quantidade)) return ok({ avisos: [] });
  let mexeu = false;
  const r = await executar(async (tx) => {
    const acerto = await acertarEstoque(tx, l, qtd, usuarioId, await numeroDaOs(tx, osId));
    mexeu = acerto.mexeuNaSeparacao;
    await tx.atividadeMaterial.update({ where: { id: l.id }, data: { quantidade: qtd, corrigidoEm: new Date(), corrigidoPorId: usuarioId } });
    await tx.osHistorico.create({ data: {
      ordemServicoId: osId, usuarioId, acao: "Material usado em campo corrigido",
      detalhes: `${l.descricao}: ${textoQuantidade(Number(l.quantidade), l.unidade)} → ${textoQuantidade(qtd, l.unidade)}`.slice(0, 1000),
    } });
    return { avisos: acerto.avisos };
  });
  if (ehErro(r)) return r;
  if (mexeu) await sincronizarStatusOs(osId, empresaId, usuarioId).catch(() => null);
  return ok(r);
}

/** Escritório estorna uma linha do campo: sai da OS (fica no registro) e o estoque volta. */
export async function estornarMaterialEscritorio(empresaId: string, osId: string, linhaId: string, usuarioId: string): Promise<Resultado<{ removido: boolean }>> {
  const l = await linhaDaOs(empresaId, osId, linhaId);
  if (!l) return erro(404, "Material não encontrado nesta OS.");
  if (l.removidoEm) return ok({ removido: true });
  const trava = await travadaPeloFaturamento(osId);
  if (trava) return erro(409, trava);
  return retirar(l, usuarioId, `${l.descricao}: ${textoQuantidade(Number(l.quantidade), l.unidade)}`);
}
