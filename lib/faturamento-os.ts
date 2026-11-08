import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface MedicaoDaOs {
  id: string;
  numero: string;
  tokenPublico: string | null;
  /** Fatura avulsa ("Faturar") — aparece como "Fatura AAAA-NNNN" */
  avulsa: boolean;
}

type Db = Prisma.TransactionClient | typeof prisma;
const VIVA = { status: { not: "CANCELADA" as const } };
/** Medição viva — fora a que está sendo editada (ela pode manter os próprios itens) */
const viva = (ignorar?: string) => (ignorar ? { ...VIVA, id: { not: ignorar } } : VIVA);
const SELECT_MED = { id: true, numero: true, tokenPublico: true, avulsa: true } as const;

/**
 * Fonte ÚNICA da trava de faturamento da OS (F1/C7): a OS já entrou em alguma medição VIVA?
 * Enxerga os três caminhos — itens da OS numa medição (MedicaoItem), o documento integrado
 * (relatório MEDICAO_COMPLETA com medição vinculada) e o orçamento de ORIGEM da OS (o "Gerar OS"
 * copia os itens dele) já faturado direto (fatura única / medição manual). Medição CANCELADA não
 * conta (F4): cancelou, a OS volta a poder ser faturada.
 */
export async function osJaFaturada(osId: string, db: Db = prisma, ignorar?: string): Promise<MedicaoDaOs | null> {
  const [item, relatorio, origem] = await Promise.all([
    db.medicaoItem.findFirst({ where: { ordemServicoId: osId, medicao: viva(ignorar) }, select: { medicao: { select: SELECT_MED } } }),
    db.relatorioOs.findFirst({
      where: { ordemServicoId: osId, escopo: "MEDICAO_COMPLETA", medicao: { is: viva(ignorar) } },
      select: { medicao: { select: SELECT_MED } },
    }),
    db.medicaoItem.findFirst({
      where: { medicao: viva(ignorar), orcamento: { is: { osGerada: { is: { id: osId } } } } },
      select: { medicao: { select: SELECT_MED } },
    }),
  ]);
  return item?.medicao ?? relatorio?.medicao ?? origem?.medicao ?? null;
}

/**
 * O orçamento já foi faturado? Direto (item da medição aponta para ele) ou pela OS gerada dele
 * (os itens do orçamento foram copiados para a OS — faturar os dois cobraria o mesmo serviço 2×).
 */
export async function orcamentoJaFaturado(orcamentoId: string, db: Db = prisma, ignorar?: string): Promise<MedicaoDaOs | null> {
  const direto = await db.medicaoItem.findFirst({ where: { orcamentoId, medicao: viva(ignorar) }, select: { medicao: { select: SELECT_MED } } });
  if (direto) return direto.medicao;
  const os = await db.ordemServico.findFirst({ where: { orcamentoOrigemId: orcamentoId }, select: { id: true } });
  return os ? osJaFaturada(os.id, db, ignorar) : null;
}

/**
 * Trava (a): dentro de uma transação, tranca as OS e os orçamentos que vão para uma medição (dois
 * cliques/duas abas/dois caminhos ao mesmo tempo esperam na fila) e devolve os que JÁ estão numa
 * medição viva. Quem chama recusa (ou pula) esses e só então cria a medição — na mesma transação.
 */
export async function travarParaFaturar(tx: Prisma.TransactionClient, o: {
  osIds?: (string | null | undefined)[]; orcamentoIds?: (string | null | undefined)[];
  /** Edição de uma medição: os itens dela mesma não contam como "já faturado" */
  ignorarMedicaoId?: string;
}) {
  const osIds = [...new Set((o.osIds ?? []).filter(Boolean))].sort() as string[];
  const orcIds = [...new Set((o.orcamentoIds ?? []).filter(Boolean))].sort() as string[];
  // Orçamento de origem das OS também entra na fila (o caminho "orçamento direto" disputa com a OS)
  const origens = osIds.length
    ? (await tx.ordemServico.findMany({ where: { id: { in: osIds } }, select: { orcamentoOrigemId: true } })).map((x) => x.orcamentoOrigemId)
    : [];
  const todosOrc = [...new Set([...orcIds, ...origens.filter(Boolean)])].sort() as string[];
  // Ordem fixa (orçamentos e depois OS, por id) evita impasse entre dois faturamentos cruzados
  if (todosOrc.length) await tx.$queryRaw`SELECT id FROM orcamentos WHERE id IN (${Prisma.join(todosOrc)}) ORDER BY id FOR UPDATE`;
  if (osIds.length) await tx.$queryRaw`SELECT id FROM ordens_servico WHERE id IN (${Prisma.join(osIds)}) ORDER BY id FOR UPDATE`;
  const os: { id: string; medicao: MedicaoDaOs }[] = [];
  for (const id of osIds) { const m = await osJaFaturada(id, tx, o.ignorarMedicaoId); if (m) os.push({ id, medicao: m }); }
  const orcamentos: { id: string; medicao: MedicaoDaOs }[] = [];
  for (const id of orcIds) { const m = await orcamentoJaFaturado(id, tx, o.ignorarMedicaoId); if (m) orcamentos.push({ id, medicao: m }); }
  return { os, orcamentos };
}

/**
 * O que a OS tem PARA faturar (itens executados + adicionais marcados "Cobrar" com preço).
 * A mensalidade do contrato NUNCA entra aqui: ela é cobrada pelo faturamento mensal do contrato.
 */
export async function itensFaturaveisDaOs(osId: string) {
  const [itens, adicionais] = await Promise.all([
    prisma.osItemOrcamento.findMany({
      where: { ordemServicoId: osId, executado: true }, orderBy: [{ ordem: "asc" }, { id: "asc" }],
      // O serviço do orçamento de origem (copiado pelo "Gerar OS") leva os dados fiscais até a nota
      include: { orcamentoServico: { select: { servicoId: true } } },
    }),
    prisma.servicoAdicional.findMany({
      where: { ordemServicoId: osId, statusCobranca: "COBRAR", valor: { gt: 0 } },
      orderBy: { criadoEm: "asc" },
    }),
  ]);
  return { itens, adicionais };
}

/* ───────────────────────── P5 — faturamento parcial ───────────────────────── */

const SELECT_FAT = { ...SELECT_MED, status: true, valorLiquido: true, faturaParcial: true, percentualFaturado: true, criadoEm: true, nfNumero: true } as const;
type MedicaoFat = { id: string; numero: string; tokenPublico: string | null; avulsa: boolean; status: string; valorLiquido: unknown; faturaParcial: boolean; percentualFaturado: unknown; criadoEm: Date; nfNumero: string | null };

/** Só tranca as origens (ordem fixa), sem decidir nada: quem chama lê o saldo na mesma transação */
export async function travarOrigens(tx: Prisma.TransactionClient, o: { osIds?: (string | null | undefined)[]; orcamentoIds?: (string | null | undefined)[] }) {
  const osIds = [...new Set((o.osIds ?? []).filter(Boolean))].sort() as string[];
  const orcIds = [...new Set((o.orcamentoIds ?? []).filter(Boolean))].sort() as string[];
  const origens = osIds.length
    ? (await tx.ordemServico.findMany({ where: { id: { in: osIds } }, select: { orcamentoOrigemId: true } })).map((x) => x.orcamentoOrigemId)
    : [];
  const todosOrc = [...new Set([...orcIds, ...origens.filter(Boolean)])].sort() as string[];
  if (todosOrc.length) await tx.$queryRaw`SELECT id FROM orcamentos WHERE id IN (${Prisma.join(todosOrc)}) ORDER BY id FOR UPDATE`;
  if (osIds.length) await tx.$queryRaw`SELECT id FROM ordens_servico WHERE id IN (${Prisma.join(osIds)}) ORDER BY id FOR UPDATE`;
}

/**
 * Todas as medições VIVAS ligadas à origem (os mesmos três caminhos da trava: item do orçamento, item da OS,
 * relatório MEDICAO_COMPLETA, e o orçamento de origem ↔ OS gerada), sem repetição, da mais antiga à mais nova.
 */
async function medicoesDaOrigem(db: Db, origem: { orcamentoId?: string | null; osId?: string | null }, ignorar?: string): Promise<MedicaoFat[]> {
  const orcIds = new Set<string>(); const osIds = new Set<string>();
  if (origem.orcamentoId) {
    orcIds.add(origem.orcamentoId);
    const os = await db.ordemServico.findFirst({ where: { orcamentoOrigemId: origem.orcamentoId }, select: { id: true } });
    if (os) osIds.add(os.id);
  }
  if (origem.osId) {
    osIds.add(origem.osId);
    const os = await db.ordemServico.findUnique({ where: { id: origem.osId }, select: { orcamentoOrigemId: true } });
    if (os?.orcamentoOrigemId) orcIds.add(os.orcamentoOrigemId);
  }
  const v = viva(ignorar);
  const [porOrc, porOs, porRel] = await Promise.all([
    orcIds.size ? db.medicaoItem.findMany({ where: { orcamentoId: { in: [...orcIds] }, medicao: v }, select: { medicao: { select: SELECT_FAT } } }) : [],
    osIds.size ? db.medicaoItem.findMany({ where: { ordemServicoId: { in: [...osIds] }, medicao: v }, select: { medicao: { select: SELECT_FAT } } }) : [],
    osIds.size ? db.relatorioOs.findMany({ where: { ordemServicoId: { in: [...osIds] }, escopo: "MEDICAO_COMPLETA", medicao: { is: v } }, select: { medicao: { select: SELECT_FAT } } }) : [],
  ]);
  const porId = new Map<string, MedicaoFat>();
  for (const x of [...porOrc, ...porOs, ...porRel]) if (x.medicao) porId.set(x.medicao.id, x.medicao as MedicaoFat);
  return [...porId.values()].sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime() || a.numero.localeCompare(b.numero));
}

export interface FaturamentoDaOrigem {
  total: number; faturado: number; saldo: number;
  faturas: { id: string; numero: string; status: string; valor: number; parcial: boolean; percentual: number | null; criadoEm: string; nfNumero: string | null }[];
  /** Medição NÃO avulsa viva (medição de contrato / manual) que já cobre a origem: a origem conta como faturada por inteiro */
  outra: MedicaoDaOs | null;
  /** A última fatura avulsa viva (para "já faturado → abrir") */
  ultima: MedicaoDaOs | null;
}

/**
 * O faturamento da origem: `total` é o valor da fatura cheia hoje; `faturado` = soma do líquido das faturas avulsas
 * vivas ligadas; `saldo` = o que ainda dá para faturar. Cobrem a origem INTEIRA (saldo zero, seja qual for a soma):
 * uma medição de contrato/manual viva, ou uma fatura avulsa CHEIA ("Faturar" sem parte antes — ex.: a OS gerada
 * faturou só os itens executados; o orçamento não fatura o resto por fora, como sempre foi).
 */
export async function faturamentoDaOrigem(db: Db, origem: { orcamentoId?: string | null; osId?: string | null }, total: number, ignorar?: string): Promise<FaturamentoDaOrigem> {
  const medicoes = await medicoesDaOrigem(db, origem, ignorar);
  const outra = medicoes.find((m) => !m.avulsa) ?? null;
  const avulsas = medicoes.filter((m) => m.avulsa);
  const somaAvulsas = Math.round(avulsas.reduce((s, m) => s + Number(m.valorLiquido), 0) * 100) / 100;
  const cheia = avulsas.some((m) => !m.faturaParcial);
  const faturado = outra || cheia ? Math.max(Number(total), somaAvulsas) : somaAvulsas;
  const saldo = Math.round(Math.max(0, Number(total) - faturado) * 100) / 100;
  const resumo = (m: MedicaoFat): MedicaoDaOs => ({ id: m.id, numero: m.numero, tokenPublico: m.tokenPublico, avulsa: m.avulsa });
  return {
    total: Math.round(Number(total) * 100) / 100, faturado, saldo, outra: outra ? resumo(outra) : null,
    ultima: avulsas.length ? resumo(avulsas[avulsas.length - 1]) : null,
    faturas: avulsas.map((m) => ({
      id: m.id, numero: m.numero, status: m.status, valor: Number(m.valorLiquido), parcial: m.faturaParcial,
      percentual: m.percentualFaturado == null ? null : Number(m.percentualFaturado), criadoEm: m.criadoEm.toISOString(), nfNumero: m.nfNumero,
    })),
  };
}
