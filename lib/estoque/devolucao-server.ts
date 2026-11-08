import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { movimentar } from "@/lib/estoque/servidor";
import { formatarQtd } from "@/lib/estoque/regras";
import { osJaFaturada } from "@/lib/faturamento-os";
import { aDevolver, planoDesfazerDevolucao, planoDevolucao, textoPortaoPrestacao } from "@/lib/estoque/separacao";
import { ErroSeparacao, paraSeparavel, separacaoDaOs, type SeparacaoDaOs } from "@/lib/estoque/separacao-server";

/**
 * Estoque E4.3 — devolução da sobra de material, lado do banco: a fila "A devolver" (OS com sobra pendente, ou cancelada
 * com material reservado), devolver (DEVOLUCAO no razão da E1, saldo volta, estado DEVOLVIDO) e desfazer (estorno),
 * tudo na MESMA transação com a linha do produto trancada (`movimentar`). E os Portões 2/3: com a amarra da empresa
 * ligada, faturar / gerar medição só com o material 100% prestado contas. Empresa sempre da sessão.
 */

const SELECT = { id: true, produtoId: true, descricao: true, unidade: true, quantidade: true, quantidadeSeparada: true, quantidadeConsumida: true, quantidadeDevolvida: true, consumidoEm: true, estadoSeparacao: true } as const;

/* ───────── Fila "A devolver" ───────── */
export interface OsADevolver {
  id: string; numero: string; chamadoNumero: string | null; status: string; descricao: string; criadoEm: Date;
  cliente: string; unidade: string | null;
  /** Quantos materiais têm algo a devolver */
  aDevolver: number;
  /** OS cancelada: o reservado volta inteiro (nada foi executado) */
  cancelada: boolean;
  itens: { descricao: string; quantidade: number; unidade: string }[];
}

/**
 * OS com sobra separada pendente de devolução (consumo informado) em qualquer status, e OS CANCELADA com material
 * ainda só reservado. Sai da fila quando tudo foi devolvido. Ordem: a mais antiga primeiro.
 */
export async function filaDevolucao(empresaId: string): Promise<OsADevolver[]> {
  const materiais = await prisma.osMaterial.findMany({
    where: { ordemServico: { empresaId }, produtoId: { not: null }, quantidade: { gt: 0 }, estadoSeparacao: { in: ["CONSUMIDO", "SEPARADO"] }, quantidadeSeparada: { gt: 0 } },
    select: {
      ...SELECT, ordem: true,
      ordemServico: { select: { id: true, numero: true, chamadoNumero: true, status: true, descricao: true, criadoEm: true, cliente: { select: { nome: true, nomeFantasia: true } }, unidade: { select: { nome: true } } } },
    },
    orderBy: [{ ordemServicoId: "asc" }, { ordem: "asc" }, { id: "asc" }],
  });
  const porOs = new Map<string, OsADevolver>();
  for (const m of materiais) {
    const os = m.ordemServico;
    const cancelada = os.status === "CANCELADA";
    const q = aDevolver(paraSeparavel(m), cancelada);
    if (!(q > 0)) continue;
    const linha = porOs.get(os.id) ?? {
      id: os.id, numero: os.numero, chamadoNumero: os.chamadoNumero, status: os.status, descricao: os.descricao, criadoEm: os.criadoEm,
      cliente: os.cliente.nomeFantasia || os.cliente.nome, unidade: os.unidade?.nome ?? null, aDevolver: 0, cancelada, itens: [],
    };
    linha.aDevolver++;
    if (linha.itens.length < 3) linha.itens.push({ descricao: m.descricao, quantidade: q, unidade: m.unidade });
    porOs.set(os.id, linha);
  }
  return [...porOs.values()].sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime() || a.numero.localeCompare(b.numero));
}

/** Quantas OS estão na fila "A devolver" (o sino de quem tem "Estoque › Separar material"). */
export async function contarFilaDevolucao(empresaId: string): Promise<number> {
  return (await filaDevolucao(empresaId)).length;
}

/* ───────── Devolver / desfazer ───────── */
export interface ResultadoDevolucao { separacao: SeparacaoDaOs; avisos: string[]; movimentos: number }

/**
 * Devolve tudo o que há a devolver dos materiais pedidos: DEVOLUCAO (+) no razão, vinculada à OS, saldo volta; estado
 * DEVOLVIDO com quem e quando; histórico da OS. Material de outra OS/empresa = recusado. null = OS não é da empresa.
 */
export async function devolverMateriais(empresaId: string, osId: string, usuarioId: string, ids: string[]): Promise<ResultadoDevolucao | null> {
  if (new Set(ids).size !== ids.length) throw new ErroSeparacao("Material repetido no pedido.");
  const feito = await prisma.$transaction(async (tx) => {
    const os = await tx.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true, numero: true, chamadoNumero: true, status: true } });
    if (!os) return null;
    const cancelada = os.status === "CANCELADA";
    const materiais = await tx.osMaterial.findMany({ where: { id: { in: ids }, ordemServicoId: osId }, select: SELECT });
    if (materiais.length !== ids.length) throw new ErroSeparacao("Material não pertence a esta OS.");
    const avisos: string[] = [];
    const feitos: string[] = [];
    let movimentos = 0;
    const agora = new Date();
    const numero = os.chamadoNumero ?? os.numero;
    for (const m of [...materiais].sort((a, b) => (a.produtoId ?? "").localeCompare(b.produtoId ?? "") || a.id.localeCompare(b.id))) {
      const plano = planoDevolucao(paraSeparavel(m), cancelada);
      if (!plano.ok) throw new ErroSeparacao(`${m.descricao}: ${plano.erro}`);
      const r = await movimentar({ empresaId, produtoId: m.produtoId!, operacao: "DEVOLUCAO", valor: plano.quantidade, usuarioId, refId: osId, observacao: `Devolução — OS ${numero} · ${m.descricao}${cancelada ? " (OS cancelada)" : ""}` }, tx);
      movimentos++;
      if (r.aviso) avisos.push(`${m.descricao}: ${r.aviso}`);
      await tx.osMaterial.update({ where: { id: m.id }, data: { quantidadeDevolvida: plano.quantidadeDevolvida, estadoSeparacao: "DEVOLVIDO", devolvidoEm: agora, devolvidoPorId: usuarioId } });
      feitos.push(`${m.descricao}: ${formatarQtd(plano.quantidade)} ${m.unidade}`);
    }
    await tx.osHistorico.create({ data: { ordemServicoId: osId, usuarioId, acao: "Material devolvido ao estoque", detalhes: feitos.join("; ").slice(0, 1000) } });
    return { avisos, movimentos };
  });
  if (!feito) return null;
  const separacao = (await separacaoDaOs(empresaId, osId))!;
  return { separacao, ...feito };
}

/** Desfaz a devolução de UM material (enquanto a OS não foi faturada): DEVOLUCAO − no razão; o estado volta a CONSUMIDO ou SEPARADO. */
export async function desfazerDevolucao(empresaId: string, osId: string, usuarioId: string, materialId: string): Promise<ResultadoDevolucao | null> {
  const feito = await prisma.$transaction(async (tx) => {
    const os = await tx.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true, numero: true, chamadoNumero: true } });
    if (!os) return null;
    if (await osJaFaturada(osId)) throw new ErroSeparacao("OS já faturada: a devolução não pode mais ser desfeita.");
    const m = await tx.osMaterial.findFirst({ where: { id: materialId, ordemServicoId: osId }, select: SELECT });
    if (!m) throw new ErroSeparacao("Material não pertence a esta OS.");
    const plano = planoDesfazerDevolucao(paraSeparavel(m));
    if (!plano.ok) throw new ErroSeparacao(`${m.descricao}: ${plano.erro}`);
    const r = await movimentar({ empresaId, produtoId: m.produtoId!, operacao: "ESTORNO_DEVOLUCAO", valor: plano.quantidade, usuarioId, refId: osId, observacao: `Devolução desfeita — OS ${os.chamadoNumero ?? os.numero} · ${m.descricao}` }, tx);
    await tx.osMaterial.update({ where: { id: m.id }, data: { quantidadeDevolvida: 0, estadoSeparacao: plano.estado, devolvidoEm: null, devolvidoPorId: null } });
    await tx.osHistorico.create({ data: { ordemServicoId: osId, usuarioId, acao: "Devolução de material desfeita", detalhes: `${m.descricao}: ${formatarQtd(plano.quantidade)} ${m.unidade}` } });
    return { avisos: r.aviso ? [`${m.descricao}: ${r.aviso}`] : [], movimentos: 1 };
  });
  if (!feito) return null;
  const separacao = (await separacaoDaOs(empresaId, osId))!;
  return { separacao, ...feito };
}

/* ───────── Portões 2/3 ───────── */
/**
 * O que falta para o material da OS estar 100% prestado contas (consumo informado e sobra devolvida) e se isso TRAVA
 * (amarra "Exigir prestação de contas de material" ligada na empresa). OS cancelada não fatura: nada a dizer.
 */
export async function portaoPrestacaoMaterial(empresaId: string, osId: string): Promise<{ texto: string | null; bloqueia: boolean }> {
  const [cfg, materiais] = await Promise.all([
    prisma.configuracao.findUnique({ where: { empresaId }, select: { osExigirPrestacaoMaterial: true } }),
    prisma.osMaterial.findMany({ where: { ordemServicoId: osId, ordemServico: { empresaId, status: { not: "CANCELADA" } }, quantidade: { gt: 0 }, produtoId: { not: null }, estadoSeparacao: { in: ["SEPARADO", "CONSUMIDO"] } }, select: SELECT, orderBy: { ordem: "asc" } }),
  ]);
  const texto = textoPortaoPrestacao(materiais.map(paraSeparavel));
  return { texto, bloqueia: !!texto && !!cfg?.osExigirPrestacaoMaterial };
}

/** A resposta 422 dos Portões 2/3 quando a amarra trava (null = segue). `acao` = "faturar" | "gerar a medição". */
export async function respostaPortaoPrestacao(empresaId: string, osId: string, acao: string) {
  const p = await portaoPrestacaoMaterial(empresaId, osId);
  if (!p.bloqueia) return null;
  return NextResponse.json({ erro: `Para ${acao}, falta: ${p.texto}.`, materiais: p.texto }, { status: 422 });
}
