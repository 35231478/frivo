/**
 * PEDIDO DO CLIENTE — servidor. A regra pura está em ./regra; aqui, as consultas e as gravações:
 *  - quem está "Aguardando pedido" (o `where` das listas, do filtro rápido, do painel e do sino);
 *  - registrar o pedido (um pedido cobre várias OS e orçamentos do MESMO cliente) e liberar sem pedido;
 *  - as travas da fatura, da NFS-e e do início da execução;
 *  - o número do pedido para a discriminação da NFS-e.
 *
 * Um jeito só: o "Registrar PC recebido" da fatura (medição) também passa por `registrarPedido`, e a fatura
 * que estava "Aguardando PC" avança sozinha quando todas as OS e orçamentos dela têm pedido (ou foram liberados).
 */
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validarDataUrl } from "@/lib/anexos-server";
import { chaveHojeBR } from "@/lib/fuso";
import {
  aguardandoPedido, alertaValorPedido, inicioDaEspera, limparMotivo, limparNumeroPedido, modoEfetivo, MSG_MOTIVO, textoPedidoNaNota,
  travaFaturar, travaIniciar, DIAS_ALERTA_PEDIDO_PADRAO, reais, diasEsperando, type ModoPedido, type SituacaoPedido,
} from "@/lib/pedido-cliente/regra";

/** A fatura já saiu: a OS/orçamento não espera mais pedido (inclusive a do jeito antigo, com o PC na própria fatura) */
const FATURAS_EMITIDAS = ["NF_EMITIDA", "BOLETO_GERADO", "PAGO"] as const;
const naFaturaEmitida = { medicao: { OR: [{ status: { in: [...FATURAS_EMITIDAS] } }, { pcNumero: { not: null }, status: { not: "CANCELADA" as const } }] } };

/** O modo da unidade/cliente no `where` (os modos pedidos) */
function whereModo(modos: ModoPedido[]) {
  const doCliente = modos.includes("FATURAR") ? { cliente: { exigePcAntesNf: true } } : { cliente: { exigePcAntesNf: true, exigePedidoExecutar: true } };
  return {
    OR: [
      { unidade: { exigePedido: { in: modos } } },
      { AND: [{ OR: [{ unidadeId: null }, { unidade: { exigePedido: null } }] }, doCliente] },
    ],
  };
}

/** OS "Aguardando pedido" (sem a empresa: quem chama junta) */
export function whereOsAguardando(modos: ModoPedido[] = ["FATURAR", "EXECUTAR"]): Prisma.OrdemServicoWhereInput {
  return {
    status: { not: "CANCELADA" }, pedidoClienteId: null, pedidoLiberadoEm: null,
    medicaoItens: { none: naFaturaEmitida },
    AND: [whereModo(modos)],
  } as Prisma.OrdemServicoWhereInput;
}

/** Orçamentos aprovados "Aguardando pedido" */
export function whereOrcamentoAguardando(): Prisma.OrcamentoWhereInput {
  return {
    status: "APROVADO", pedidoClienteId: null, pedidoLiberadoEm: null,
    medicaoItens: { none: naFaturaEmitida },
    // a OS gerada dele já foi faturada (ou tem pedido): ele não espera mais
    NOT: { osGerada: { OR: [{ pedidoClienteId: { not: null } }, { pedidoLiberadoEm: { not: null } }, { medicaoItens: { some: naFaturaEmitida } }] } },
    AND: [whereModo(["FATURAR", "EXECUTAR"])],
  } as Prisma.OrcamentoWhereInput;
}

/** A empresa tem algum cliente (ou unidade) que exige pedido? Sem nenhum, nada disto aparece nas telas. */
export const usaPedidoCliente = cache(async (empresaId: string): Promise<boolean> => {
  const [c, u] = await Promise.all([
    prisma.cliente.findFirst({ where: { empresaId, exigePcAntesNf: true }, select: { id: true } }),
    prisma.unidade.findFirst({ where: { empresaId, exigePedido: { in: ["FATURAR", "EXECUTAR"] } }, select: { id: true } }),
  ]);
  return !!(c || u);
});

/* ───────── a situação de cada OS / orçamento (para a etiqueta e as travas) ───────── */

const SELECT_MODO = { cliente: { select: { exigePcAntesNf: true, exigePedidoExecutar: true } }, unidade: { select: { exigePedido: true } } } as const;
export const SELECT_PEDIDO_OS = {
  id: true, status: true, pedidoClienteId: true, pedidoLiberadoEm: true, ...SELECT_MODO,
  medicaoItens: { select: { medicao: { select: { status: true, pcNumero: true } } } },
} as const;
export const SELECT_PEDIDO_ORCAMENTO = {
  id: true, status: true, pedidoClienteId: true, pedidoLiberadoEm: true, ...SELECT_MODO,
  medicaoItens: { select: { medicao: { select: { status: true, pcNumero: true } } } },
  osGerada: { select: { pedidoClienteId: true, pedidoLiberadoEm: true, medicaoItens: { select: { medicao: { select: { status: true, pcNumero: true } } } } } },
} as const;

type ItemMedicao = { medicao: { status: string; pcNumero: string | null } };
const faturado = (itens: ItemMedicao[] = []) =>
  itens.some((i) => (FATURAS_EMITIDAS as readonly string[]).includes(i.medicao.status) || (!!i.medicao.pcNumero && i.medicao.status !== "CANCELADA"));

export function situacaoDaOs(o: {
  status: string; pedidoClienteId: string | null; pedidoLiberadoEm: Date | null;
  cliente: { exigePcAntesNf: boolean; exigePedidoExecutar: boolean } | null; unidade: { exigePedido: string | null } | null; medicaoItens?: ItemMedicao[];
}): SituacaoPedido {
  return {
    modo: modoEfetivo(o.cliente, o.unidade), pedidoId: o.pedidoClienteId, liberado: !!o.pedidoLiberadoEm,
    encerradoSemCobranca: o.status === "CANCELADA", faturado: faturado(o.medicaoItens),
  };
}

export function situacaoDoOrcamento(o: {
  status: string; pedidoClienteId: string | null; pedidoLiberadoEm: Date | null;
  cliente: { exigePcAntesNf: boolean; exigePedidoExecutar: boolean } | null; unidade: { exigePedido: string | null } | null; medicaoItens?: ItemMedicao[];
  osGerada?: { pedidoClienteId: string | null; pedidoLiberadoEm: Date | null; medicaoItens?: ItemMedicao[] } | null;
}): SituacaoPedido {
  const g = o.osGerada;
  return {
    modo: modoEfetivo(o.cliente, o.unidade), pedidoId: o.pedidoClienteId ?? g?.pedidoClienteId ?? null, liberado: !!o.pedidoLiberadoEm || !!g?.pedidoLiberadoEm,
    // só o aprovado espera pedido (o enviado ainda nem foi aceito; recusado/cancelado não vai ser cobrado)
    encerradoSemCobranca: o.status !== "APROVADO", faturado: faturado(o.medicaoItens) || faturado(g?.medicaoItens),
  };
}

/* ───────── valores ───────── */

const num = (v: unknown) => Number(v ?? 0) || 0;

/** O valor de cada OS (a soma dos itens dela, como na fatura da OS) */
export async function valoresDasOs(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const g = await prisma.osItemOrcamento.groupBy({ by: ["ordemServicoId"], where: { ordemServicoId: { in: ids } }, _sum: { valorTotal: true } });
  return new Map(g.map((x) => [x.ordemServicoId, num(x._sum.valorTotal)]));
}

/** Contagem e total (R$) das OS aguardando dentro de um filtro de lista (o chip "Aguardando pedido") */
export async function resumoOsAguardando(where: Prisma.OrdemServicoWhereInput) {
  const w = { AND: [where, whereOsAguardando()] };
  const [quantidade, soma] = await Promise.all([
    prisma.ordemServico.count({ where: w }),
    prisma.osItemOrcamento.aggregate({ where: { ordemServico: w }, _sum: { valorTotal: true } }),
  ]);
  return { quantidade, total: num(soma._sum.valorTotal) };
}

/** Contagem e total (R$) dos orçamentos aguardando dentro de um filtro de lista */
export async function resumoOrcamentosAguardando(where: Prisma.OrcamentoWhereInput) {
  const w = { AND: [where, whereOrcamentoAguardando()] };
  const r = await prisma.orcamento.aggregate({ where: w, _count: { _all: true }, _sum: { totalGeral: true } });
  return { quantidade: r._count._all, total: num(r._sum.totalGeral) };
}

/* ───────── registrar o pedido ───────── */

export interface Quem { empresaId: string; usuarioId: string }
export interface DadosPedido {
  numero: unknown; data?: unknown; valor?: unknown; observacao?: unknown;
  anexo?: { conteudo: string; nome: string } | null;
}
type Falha = { ok: false; status: number; erro: string };
const falha = (status: number, erro: string): Falha => ({ ok: false, status, erro });

function lerDados(d: DadosPedido): Falha | { numero: string; data: Date; valor: number | null; observacao: string | null; anexo: { conteudo: string; nome: string; tipo: string } | null } {
  const numero = limparNumeroPedido(d.numero);
  if (!numero) return falha(400, "Informe o número do pedido do cliente (até 60 caracteres).");
  const dataTxt = typeof d.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.data) ? d.data : null;
  // dia civil (coluna DATE): o informado, ou hoje em Brasília
  const data = new Date(`${dataTxt ?? chaveHojeBR()}T00:00:00.000Z`);
  if (Number.isNaN(data.getTime())) return falha(400, "Data do pedido inválida.");
  let valor: number | null = null;
  if (d.valor !== undefined && d.valor !== null && d.valor !== "") {
    valor = Number(d.valor);
    if (!Number.isFinite(valor) || valor < 0 || valor > 1e10) return falha(400, "Valor do pedido inválido.");
    valor = Math.round(valor * 100) / 100;
  }
  const observacao = typeof d.observacao === "string" ? d.observacao.trim().slice(0, 1000) || null : null;
  let anexo = null;
  if (d.anexo?.conteudo) {
    const v = validarDataUrl(d.anexo.conteudo, d.anexo.nome || "pedido", {
      tipos: ["application/pdf", "image/png", "image/jpeg", "image/webp"], mensagemTipo: "Envie o pedido em PDF ou foto (JPG, PNG, WEBP).",
    });
    if (!v.ok) return falha(400, v.erro);
    anexo = { conteudo: v.arquivo.conteudo, nome: v.arquivo.nome, tipo: v.arquivo.tipo };
  }
  return { numero, data, valor, observacao, anexo };
}

/** As OS e os orçamentos alvo, da empresa, com o cliente — e a propagação orçamento ⇄ OS gerada dele */
async function alvos(empresaId: string, osIds: string[], orcamentoIds: string[]) {
  const [oss, orcs] = await Promise.all([
    osIds.length ? prisma.ordemServico.findMany({ where: { id: { in: osIds }, empresaId }, select: { id: true, numero: true, clienteId: true, orcamentoOrigemId: true, pedidoClienteId: true } }) : [],
    orcamentoIds.length ? prisma.orcamento.findMany({ where: { id: { in: orcamentoIds }, empresaId }, select: { id: true, codigo: true, clienteId: true, pedidoClienteId: true, osGerada: { select: { id: true, numero: true, pedidoClienteId: true } } } }) : [],
  ]);
  return { oss, orcs };
}

/** As faturas "Aguardando PC" dessas OS/orçamentos que agora podem seguir (nenhuma linha delas espera mais) */
async function avancarFaturas(tx: Prisma.TransactionClient, osIds: string[], orcamentoIds: string[], extraMedicaoId?: string | null) {
  const medicoes = await tx.medicao.findMany({
    where: { status: "AGUARDANDO_PC", OR: [{ itens: { some: { OR: [{ ordemServicoId: { in: osIds } }, { orcamentoId: { in: orcamentoIds } }] } } }, ...(extraMedicaoId ? [{ id: extraMedicaoId }] : [])] },
    select: {
      id: true,
      itens: {
        select: {
          ordemServico: { select: { ...SELECT_PEDIDO_OS, pedidoCliente: { select: { numero: true } } } },
          orcamento: { select: { ...SELECT_PEDIDO_ORCAMENTO, pedidoCliente: { select: { numero: true } } } },
        },
      },
    },
  });
  for (const m of medicoes) {
    const esperando = m.itens.some((i) => (i.ordemServico && aguardandoPedido(situacaoDaOs(i.ordemServico))) || (i.orcamento && aguardandoPedido(situacaoDoOrcamento(i.orcamento))));
    if (esperando) continue;
    const numeros = m.itens.map((i) => i.ordemServico?.pedidoCliente?.numero ?? i.orcamento?.pedidoCliente?.numero);
    await tx.medicao.updateMany({
      where: { id: m.id, status: "AGUARDANDO_PC" },
      data: { status: "PC_RECEBIDO", pcNumero: [...new Set(numeros.filter(Boolean))].join(", ") || null, pcRecebidoEm: new Date() },
    });
  }
}

export async function registrarPedido(
  quem: Quem, dados: DadosPedido, ligar: { osIds?: string[]; orcamentoIds?: string[]; medicaoId?: string | null },
): Promise<Falha | { ok: true; pedidoId: string; alerta: string | null; ligadas: { os: number; orcamentos: number } }> {
  const lido = lerDados(dados);
  if ("ok" in lido) return lido;
  const osIds = [...new Set(ligar.osIds ?? [])].slice(0, 500);
  const orcamentoIds = [...new Set(ligar.orcamentoIds ?? [])].slice(0, 500);
  // A fatura (Registrar PC): as OS e orçamentos dela entram no pedido
  let clienteDaFatura: string | null = null;
  if (ligar.medicaoId) {
    const m = await prisma.medicao.findFirst({ where: { id: ligar.medicaoId, empresaId: quem.empresaId }, select: { clienteId: true, itens: { select: { ordemServicoId: true, orcamentoId: true } } } });
    if (!m) return falha(404, "Fatura não encontrada.");
    clienteDaFatura = m.clienteId;
    for (const i of m.itens) { if (i.ordemServicoId) osIds.push(i.ordemServicoId); if (i.orcamentoId) orcamentoIds.push(i.orcamentoId); }
  }
  if (!osIds.length && !orcamentoIds.length && !ligar.medicaoId) return falha(400, "Escolha ao menos uma OS ou orçamento.");
  const { oss, orcs } = await alvos(quem.empresaId, [...new Set(osIds)], [...new Set(orcamentoIds)]);
  if (oss.length !== new Set(osIds).size || orcs.length !== new Set(orcamentoIds).size) return falha(404, "OS ou orçamento não encontrado.");
  const clientes = new Set([...oss.map((o) => o.clienteId), ...orcs.map((o) => o.clienteId), ...(clienteDaFatura ? [clienteDaFatura] : [])]);
  if (clientes.size !== 1) return falha(400, "Um pedido do cliente cobre OS e orçamentos de um cliente só. Selecione itens do mesmo cliente.");
  const clienteId = [...clientes][0];

  // A propagação: o orçamento leva a OS gerada dele, e a OS leva o orçamento de origem (os que ainda não têm pedido)
  const todasOs = new Set(oss.map((o) => o.id));
  const todosOrc = new Set(orcs.map((o) => o.id));
  for (const o of orcs) if (o.osGerada && !o.osGerada.pedidoClienteId) todasOs.add(o.osGerada.id);
  for (const o of oss) if (o.orcamentoOrigemId) todosOrc.add(o.orcamentoOrigemId);
  const origens = await prisma.orcamento.findMany({ where: { id: { in: [...todosOrc].filter((id) => !orcs.some((o) => o.id === id)) }, empresaId: quem.empresaId, pedidoClienteId: null }, select: { id: true } });
  const orcFinais = [...orcs.map((o) => o.id), ...origens.map((o) => o.id)];

  const pedido = await prisma.$transaction(async (tx) => {
    const p = await tx.pedidoCliente.create({
      data: {
        empresaId: quem.empresaId, clienteId, numero: lido.numero, data: lido.data, valor: lido.valor, observacao: lido.observacao,
        anexo: lido.anexo?.conteudo ?? null, anexoNome: lido.anexo?.nome ?? null, anexoTipo: lido.anexo?.tipo ?? null, criadoPorId: quem.usuarioId,
      },
    });
    const osAlvo = [...todasOs];
    if (osAlvo.length) await tx.ordemServico.updateMany({ where: { id: { in: osAlvo }, empresaId: quem.empresaId }, data: { pedidoClienteId: p.id } });
    if (orcFinais.length) await tx.orcamento.updateMany({ where: { id: { in: orcFinais }, empresaId: quem.empresaId }, data: { pedidoClienteId: p.id } });
    const detalhe = `nº ${lido.numero}${lido.valor != null ? ` · ${reais(lido.valor)}` : ""}`;
    if (osAlvo.length) await tx.osHistorico.createMany({ data: osAlvo.map((id) => ({ ordemServicoId: id, usuarioId: quem.usuarioId, acao: "Pedido do cliente informado", detalhes: detalhe })) });
    if (orcFinais.length) await tx.orcamentoEvento.createMany({ data: orcFinais.map((id) => ({ empresaId: quem.empresaId, orcamentoId: id, tipo: "PEDIDO_CLIENTE", detalhe: `Pedido do cliente ${detalhe}`, usuarioId: quem.usuarioId })) });
    await avancarFaturas(tx, osAlvo, orcFinais, ligar.medicaoId ?? null);
    // A fatura sem OS nem orçamento (contrato): o PC vai direto nela, como antes
    if (ligar.medicaoId) {
      await tx.medicao.updateMany({ where: { id: ligar.medicaoId, status: "AGUARDANDO_PC", itens: { none: { OR: [{ ordemServicoId: { not: null } }, { orcamentoId: { not: null } }] } } }, data: { status: "PC_RECEBIDO", pcNumero: lido.numero, pcRecebidoEm: new Date() } });
    }
    return p;
  });

  const total = await totalLigado([...todasOs], orcFinais);
  return { ok: true, pedidoId: pedido.id, alerta: alertaValorPedido(lido.valor, total), ligadas: { os: todasOs.size, orcamentos: orcFinais.length } };
}

/** O total das OS e orçamentos ligados (o orçamento que gerou uma das OS não conta duas vezes) */
export async function totalLigado(osIds: string[], orcamentoIds: string[]) {
  const [valores, orcs, origens] = await Promise.all([
    valoresDasOs(osIds),
    orcamentoIds.length ? prisma.orcamento.findMany({ where: { id: { in: orcamentoIds } }, select: { id: true, totalGeral: true } }) : [],
    osIds.length ? prisma.ordemServico.findMany({ where: { id: { in: osIds }, orcamentoOrigemId: { not: null } }, select: { orcamentoOrigemId: true } }) : [],
  ]);
  const jaNaOs = new Set(origens.map((o) => o.orcamentoOrigemId));
  return [...valores.values()].reduce((s, v) => s + v, 0) + orcs.filter((o) => !jaNaOs.has(o.id)).reduce((s, o) => s + num(o.totalGeral), 0);
}

/** Corrigir o pedido (número, data, valor, observação, anexo) — as ligações ficam */
export async function editarPedido(quem: Quem, pedidoId: string, dados: DadosPedido & { manterAnexo?: boolean }) {
  const atual = await prisma.pedidoCliente.findFirst({ where: { id: pedidoId, empresaId: quem.empresaId }, select: { id: true, numero: true, ordens: { select: { id: true } }, orcamentos: { select: { id: true } } } });
  if (!atual) return falha(404, "Pedido do cliente não encontrado.");
  const lido = lerDados(dados);
  if ("ok" in lido) return lido;
  await prisma.$transaction(async (tx) => {
    await tx.pedidoCliente.update({
      where: { id: pedidoId },
      data: {
        numero: lido.numero, data: lido.data, valor: lido.valor, observacao: lido.observacao,
        ...(lido.anexo ? { anexo: lido.anexo.conteudo, anexoNome: lido.anexo.nome, anexoTipo: lido.anexo.tipo } : dados.manterAnexo === false ? { anexo: null, anexoNome: null, anexoTipo: null } : {}),
      },
    });
    if (atual.ordens.length) {
      await tx.osHistorico.createMany({ data: atual.ordens.map((o) => ({ ordemServicoId: o.id, usuarioId: quem.usuarioId, acao: "Pedido do cliente corrigido", detalhes: atual.numero === lido.numero ? `nº ${lido.numero}` : `nº ${atual.numero} → nº ${lido.numero}` })) });
    }
  });
  const total = await totalLigado(atual.ordens.map((o) => o.id), atual.orcamentos.map((o) => o.id));
  return { ok: true as const, alerta: alertaValorPedido(lido.valor, total) };
}

/** Liberar sem pedido (quem tem a permissão): fica na OS/orçamento e no histórico, com o motivo */
export async function liberarSemPedido(quem: Quem, ligar: { osIds?: string[]; orcamentoIds?: string[] }, motivoBruto: unknown) {
  const motivo = limparMotivo(motivoBruto);
  if (!motivo) return falha(400, MSG_MOTIVO);
  const osIds = [...new Set(ligar.osIds ?? [])].slice(0, 500);
  const orcamentoIds = [...new Set(ligar.orcamentoIds ?? [])].slice(0, 500);
  if (!osIds.length && !orcamentoIds.length) return falha(400, "Escolha ao menos uma OS ou orçamento.");
  const { oss, orcs } = await alvos(quem.empresaId, osIds, orcamentoIds);
  if (oss.length !== osIds.length || orcs.length !== orcamentoIds.length) return falha(404, "OS ou orçamento não encontrado.");
  const agora = new Date();
  const dados = { pedidoLiberadoEm: agora, pedidoLiberadoPorId: quem.usuarioId, pedidoLiberadoMotivo: motivo };
  await prisma.$transaction(async (tx) => {
    if (osIds.length) {
      await tx.ordemServico.updateMany({ where: { id: { in: osIds }, empresaId: quem.empresaId }, data: dados });
      await tx.osHistorico.createMany({ data: osIds.map((id) => ({ ordemServicoId: id, usuarioId: quem.usuarioId, acao: "Liberada sem pedido do cliente", detalhes: motivo })) });
    }
    if (orcamentoIds.length) {
      await tx.orcamento.updateMany({ where: { id: { in: orcamentoIds }, empresaId: quem.empresaId }, data: dados });
      await tx.orcamentoEvento.createMany({ data: orcamentoIds.map((id) => ({ empresaId: quem.empresaId, orcamentoId: id, tipo: "PEDIDO_CLIENTE", detalhe: `Liberado sem pedido do cliente: ${motivo}`, usuarioId: quem.usuarioId })) });
    }
    await avancarFaturas(tx, osIds, orcamentoIds);
  });
  return { ok: true as const, liberadas: osIds.length + orcamentoIds.length };
}

/* ───────── travas ───────── */

export async function travaFaturarOs(empresaId: string, osId: string) {
  const o = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: SELECT_PEDIDO_OS });
  return o ? travaFaturar([situacaoDaOs(o)]) : null;
}

export async function travaFaturarOrcamento(empresaId: string, orcamentoId: string) {
  const o = await prisma.orcamento.findFirst({ where: { id: orcamentoId, empresaId }, select: SELECT_PEDIDO_ORCAMENTO });
  return o ? travaFaturar([situacaoDoOrcamento(o)]) : null;
}

/** A NFS-e da fatura: alguma OS/orçamento dela aguarda o pedido, ou a fatura ainda está "Aguardando PC" */
export async function travaNfseDaMedicao(medicaoId: string): Promise<string | null> {
  const m = await prisma.medicao.findUnique({
    where: { id: medicaoId },
    select: { status: true, itens: { select: { ordemServico: { select: SELECT_PEDIDO_OS }, orcamento: { select: SELECT_PEDIDO_ORCAMENTO } } } },
  });
  if (!m) return null;
  const itens = m.itens.flatMap((i) => [i.ordemServico ? situacaoDaOs(i.ordemServico) : null, i.orcamento ? situacaoDoOrcamento(i.orcamento) : null]).filter((x): x is SituacaoPedido => !!x);
  return travaFaturar(itens);
}

/** O início da execução (escritório, "Cheguei" e iniciar no app): só no modo "para executar e faturar" */
export async function travaIniciarAtividade(empresaId: string, atividadeId: string): Promise<string | null> {
  const a = await prisma.atividadeOs.findFirst({ where: { id: atividadeId, empresaId }, select: { ordemServico: { select: SELECT_PEDIDO_OS } } });
  return a ? travaIniciar(situacaoDaOs(a.ordemServico)) : null;
}

/** O número do(s) pedido(s) da fatura, para a discriminação da NFS-e */
export async function textoPedidoDaMedicao(medicaoId: string): Promise<string | null> {
  const m = await prisma.medicao.findUnique({
    where: { id: medicaoId },
    select: { pcNumero: true, itens: { select: { ordemServico: { select: { pedidoCliente: { select: { numero: true } } } }, orcamento: { select: { pedidoCliente: { select: { numero: true } } } } } } },
  });
  if (!m) return null;
  const dasLinhas = m.itens.map((i) => i.ordemServico?.pedidoCliente?.numero ?? i.orcamento?.pedidoCliente?.numero);
  return textoPedidoNaNota(dasLinhas.some(Boolean) ? dasLinhas : (m.pcNumero ?? "").split(",").map((x) => x.trim()));
}

/* ───────── painel e sino ───────── */

/** As OS aguardando da empresa (o painel de pendências): quantas e o total, para a lista filtrada */
export async function resumoAguardandoEmpresa(empresaId: string) {
  return resumoOsAguardando({ empresaId });
}

/** O sino: OS aguardando há mais que os dias da empresa (desde a conclusão; no "para executar", desde a aprovação) */
export async function contarPedidosAtrasados(empresaId: string, agora: Date = new Date()) {
  const [cfg, oss] = await Promise.all([
    prisma.configuracao.findUnique({ where: { empresaId }, select: { pedidoClienteDiasAlerta: true } }),
    prisma.ordemServico.findMany({
      where: { empresaId, ...whereOsAguardando() },
      select: { id: true, criadoEm: true, dataConclusao: true, ...SELECT_MODO, orcamentoOrigem: { select: { assinadoEm: true } } },
      orderBy: { criadoEm: "asc" }, take: 2000,
    }),
  ]);
  const dias = cfg?.pedidoClienteDiasAlerta ?? DIAS_ALERTA_PEDIDO_PADRAO;
  const atrasadas = oss.filter((o) => {
    const inicio = inicioDaEspera({ modo: modoEfetivo(o.cliente, o.unidade), aprovadoEm: o.orcamentoOrigem?.assinadoEm ?? null, criadoEm: o.criadoEm, concluidoEm: o.dataConclusao });
    return inicio !== null && diasEsperando(inicio, agora) > dias;
  });
  return { pedidosAtrasados: atrasadas.length, pedidoAtrasadoOsId: atrasadas[0]?.id ?? null, diasAlertaPedido: dias };
}

/**
 * Para onde vai a fatura aprovada: "Aguardando PC" se alguma OS/orçamento dela ainda espera o pedido do cliente
 * (ou, na fatura sem OS nem orçamento — a de contrato —, se o cliente exige o pedido); senão, segue, já com o
 * número do pedido das linhas.
 */
export async function situacaoDaFaturaAprovada(medicaoId: string): Promise<{ status: "AGUARDANDO_PC" | "PC_RECEBIDO"; pcNumero: string | null }> {
  const m = await prisma.medicao.findUnique({
    where: { id: medicaoId },
    select: {
      cliente: { select: { exigePcAntesNf: true } },
      itens: { select: { ordemServico: { select: { ...SELECT_PEDIDO_OS, pedidoCliente: { select: { numero: true } } } }, orcamento: { select: { ...SELECT_PEDIDO_ORCAMENTO, pedidoCliente: { select: { numero: true } } } } } },
    },
  });
  if (!m) return { status: "PC_RECEBIDO", pcNumero: null };
  const linhas = m.itens.filter((i) => i.ordemServico || i.orcamento);
  const esperando = linhas.length
    ? linhas.some((i) => (i.ordemServico && aguardandoPedido(situacaoDaOs(i.ordemServico))) || (i.orcamento && aguardandoPedido(situacaoDoOrcamento(i.orcamento))))
    : m.cliente.exigePcAntesNf;
  const numeros = [...new Set(linhas.map((i) => i.ordemServico?.pedidoCliente?.numero ?? i.orcamento?.pedidoCliente?.numero).filter(Boolean))] as string[];
  return { status: esperando ? "AGUARDANDO_PC" : "PC_RECEBIDO", pcNumero: esperando ? null : numeros.join(", ") || null };
}

/** O início pela OS (o status manual "Em andamento" no escritório): a mesma trava do início da atividade */
export async function travaIniciarOs(empresaId: string, osId: string): Promise<string | null> {
  const o = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: SELECT_PEDIDO_OS });
  return o ? travaIniciar(situacaoDaOs(o)) : null;
}

/** A etiqueta de cada linha (lista de OS, cabeçalho): null = o cliente não exige (nada aparece) */
export interface PedidoDaLinha { aguardando: boolean; pedido: { id: string; numero: string } | null; liberadoMotivo: string | null }

/** As etiquetas das OS; vazio quando a empresa não tem nenhum cliente que exige pedido */
export async function pedidoDasOs(empresaId: string, ids: string[]): Promise<Map<string, PedidoDaLinha>> {
  if (!ids.length || !(await usaPedidoCliente(empresaId))) return new Map();
  const oss = await prisma.ordemServico.findMany({
    where: { id: { in: ids }, empresaId },
    select: { ...SELECT_PEDIDO_OS, pedidoLiberadoMotivo: true, pedidoCliente: { select: { id: true, numero: true } } },
  });
  const r = new Map<string, PedidoDaLinha>();
  for (const o of oss) {
    const s = situacaoDaOs(o);
    if (s.modo === "NAO" && !o.pedidoCliente) continue;
    r.set(o.id, { aguardando: aguardandoPedido(s), pedido: o.pedidoCliente, liberadoMotivo: o.pedidoLiberadoEm ? o.pedidoLiberadoMotivo : null });
  }
  return r;
}

/** As etiquetas dos orçamentos (mesma regra) */
export async function pedidoDosOrcamentos(empresaId: string, ids: string[]): Promise<Map<string, PedidoDaLinha>> {
  if (!ids.length || !(await usaPedidoCliente(empresaId))) return new Map();
  const orcs = await prisma.orcamento.findMany({
    where: { id: { in: ids }, empresaId },
    select: { ...SELECT_PEDIDO_ORCAMENTO, pedidoLiberadoMotivo: true, pedidoCliente: { select: { id: true, numero: true } } },
  });
  const r = new Map<string, PedidoDaLinha>();
  for (const o of orcs) {
    const s = situacaoDoOrcamento(o);
    if (s.modo === "NAO" && !o.pedidoCliente) continue;
    r.set(o.id, { aguardando: aguardandoPedido(s), pedido: o.pedidoCliente, liberadoMotivo: o.pedidoLiberadoEm ? o.pedidoLiberadoMotivo : null });
  }
  return r;
}
