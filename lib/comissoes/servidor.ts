/**
 * COM-1 — COMISSÕES no servidor: gerar (na aprovação do orçamento), sincronizar (liberar/estornar pelo que
 * aconteceu de fato), o que entra no fechamento do mês e o extrato da própria pessoa. Tudo por empresa.
 *
 * A liberação NÃO é empurrada pelo código do financeiro: ela é RECALCULADA a partir do estado real (recebimentos
 * não estornados das faturas vivas, status do orçamento e da OS) sempre que alguém olha — o fechamento do mês e
 * o extrato. Recalcular é idempotente: cria só a diferença (liberação ou estorno), e o fechamento trava a empresa.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { medicoesDaOrigem } from "@/lib/faturamento-os";
import { ultimosCustos } from "@/lib/estoque/custo";
import { valorDesconto } from "@/lib/orcamentos/calculo";
import {
  VENDA_VIVA, alvoLiberado, chaveDaRegra, dataDeEmissao, lerVencimento, faturaFoiCancelada, fracaoEmitidaNoPeriodo, ultimaEmissaoNoPeriodo, vendaComFaturaCancelada, type FaturaDaVenda, comissoesDaVenda, entradasDaFatura, fracaoRecebidaNoPeriodo, inicioDaCompetencia, vistaPadrao, comissoesPorPessoa, descricaoDaRegra, fimDaCompetencia, fracaoRecebida, itensDaVenda,
  movimentoNecessario, round2, situacaoDaComissao, type EntradaDaVenda, type FaturaRecebida, type Quando, type Vista, type RegraComissao, type normalizarRegra,
} from "./regras";

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;

/**
 * COM-1.1 — a comissão do vendedor que SAIU numa troca de vendedor depois da liberação: fica no histórico (o que
 * foi liberado e o estorno da troca), mas não vale mais nada (alvo 0), não conta como "já gerada" e sai do relatório.
 */
export const PAPEL_SUBSTITUIDO = "VENDEDOR_ANTERIOR";
const valendo = { papel: { not: PAPEL_SUBSTITUIDO } } as const;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** A empresa usa comissão? (alguma regra ativa ou alguma comissão já gerada) — sem isso, nada de comissão aparece. */
export async function empresaUsaComissao(empresaId: string, db: Db = prisma): Promise<boolean> {
  const [regras, comissoes] = await Promise.all([
    db.comissaoRegra.count({ where: { empresaId, ativo: true } }),
    db.comissao.count({ where: { empresaId } }),
  ]);
  return regras > 0 || comissoes > 0;
}

/** O colaborador ligado ao usuário (mesmo e-mail, ativo) — dá o cargo (regras por cargo) e junta bônus + comissão na folha. */
export async function colaboradorDoUsuario(empresaId: string, usuarioId: string, db: Db = prisma) {
  const u = await db.usuario.findFirst({ where: { id: usuarioId, empresaId }, select: { id: true, nome: true, email: true } });
  if (!u) return null;
  const t = await db.tecnico.findFirst({
    where: { empresaId, ativo: true, email: { equals: u.email.trim(), mode: "insensitive" } }, orderBy: { criadoEm: "asc" }, select: { id: true, cargoId: true },
  });
  return { usuarioId: u.id, nome: u.nome, tecnicoId: t?.id ?? null, cargoId: t?.cargoId ?? null };
}

/** As regras ativas da empresa, no formato das regras puras */
export async function regrasAtivas(empresaId: string, db: Db = prisma): Promise<RegraComissao[]> {
  const rs = await db.comissaoRegra.findMany({ where: { empresaId, ativo: true }, orderBy: { criadoEm: "asc" } });
  return rs.map((r) => ({
    id: r.id, quemTipo: r.quemTipo as RegraComissao["quemTipo"], usuarioId: r.usuarioId, cargoId: r.cargoId, papel: r.papel as RegraComissao["papel"],
    sobreTipo: r.sobreTipo as RegraComissao["sobreTipo"], categoria: r.categoria, servicoId: r.servicoId, base: r.base as RegraComissao["base"], valor: num(r.valor), ativo: r.ativo,
  }));
}

const travarEmpresa = (tx: Prisma.TransactionClient, empresaId: string) => tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${`comissoes:${empresaId}`}))`;

/**
 * GERA as comissões de um orçamento recém-aprovado: uma por item que tenha regra, para o vendedor, CONGELADAS
 * (regra, base, taxa, valor e o "quando" da empresa hoje). Idempotente: orçamento que já tem comissão não gera
 * de novo. Só orçamento comum (proposta de contrato fica fora nesta leva), aprovado e com vendedor.
 */
export async function gerarComissoesDoOrcamento(
  empresaId: string, orcamentoId: string, agora: Date = new Date(),
  /** COM-1.1 (troca de vendedor): grava na transação da troca, com o "quando"/impostos congelados da comissão antiga */
  na?: { tx: Tx; quando?: Quando; liquidaImpostos?: boolean },
): Promise<number> {
  const db: Db = na?.tx ?? prisma;
  const regras = await regrasAtivas(empresaId, db);
  if (!regras.length) return 0;
  const o = await db.orcamento.findFirst({
    where: { id: orcamentoId, empresaId },
    select: {
      status: true, tipo: true, vendedorId: true, issAliquota: true,
      descontoServicos: true, tipoDescontoServicos: true, descontoProdutos: true, tipoDescontoProdutos: true,
      servicos: { select: { id: true, servicoId: true, descricao: true, quantidade: true, valorTotal: true, servico: { select: { categoria: true } }, materiais: { select: { custoUnit: true, quantidade: true, comportamento: true } } } },
      produtos: { select: { id: true, produtoId: true, descricao: true, quantidade: true, valorTotal: true, material: { select: { custoUnit: true } } } },
    },
  });
  if (!o || o.tipo !== "COMUM" || !o.vendedorId || !(VENDA_VIVA as readonly string[]).includes(o.status)) return 0;
  const pessoa = await colaboradorDoUsuario(empresaId, o.vendedorId, db);
  if (!pessoa) return 0;
  const cfg = await db.configuracao.findUnique({ where: { empresaId }, select: { comissaoQuando: true, comissaoLiquidaImpostos: true } });
  const quando = na?.quando ?? ((cfg?.comissaoQuando ?? "RECEBIMENTO") as Quando);
  const liquida = na?.liquidaImpostos ?? cfg?.comissaoLiquidaImpostos ?? false;

  // O custo de cada item (só servidor): serviço = materiais inclusos; peça = custo do material de origem ou último custo de compra
  const avulsos = o.produtos.filter((p) => !p.material && p.produtoId).map((p) => p.produtoId!);
  const custos = avulsos.length ? await ultimosCustos(empresaId, avulsos) : new Map<string, number>();
  const subS = o.servicos.reduce((s, l) => s + num(l.valorTotal), 0);
  const subP = o.produtos.reduce((s, l) => s + num(l.valorTotal), 0);
  const itens = itensDaVenda({
    issAliquota: o.issAliquota,
    descontoServicos: valorDesconto(subS, o.descontoServicos, o.tipoDescontoServicos),
    descontoProdutos: valorDesconto(subP, o.descontoProdutos, o.tipoDescontoProdutos),
    servicos: o.servicos.map((l) => {
      const inclusos = l.materiais.filter((m) => m.comportamento === "INCLUSO_NO_SERVICO");
      const custo = inclusos.some((m) => m.custoUnit == null) ? null : round2(inclusos.reduce((s, m) => s + num(m.custoUnit) * num(m.quantidade), 0));
      return { id: l.id, servicoId: l.servicoId, categoria: l.servico?.categoria ?? null, descricao: l.descricao, quantidade: l.quantidade, valorTotal: l.valorTotal, custo };
    }),
    produtos: o.produtos.map((l) => {
      const unit = l.material ? (l.material.custoUnit == null ? null : num(l.material.custoUnit)) : l.produtoId ? custos.get(l.produtoId) ?? null : null;
      return { id: l.id, servicoId: null, categoria: null, descricao: l.descricao, quantidade: l.quantidade, valorTotal: l.valorTotal, custo: unit == null ? null : round2(unit * num(l.quantidade)) };
    }),
  });
  const calculadas = comissoesDaVenda(itens, regras, { usuarioId: pessoa.usuarioId, cargoId: pessoa.cargoId }, liquida);
  if (!calculadas.length) return 0;

  // Os nomes da regra como eram (a descrição fica congelada na comissão)
  const [usuarios, cargos, servicos] = await Promise.all([
    db.usuario.findMany({ where: { empresaId, id: { in: calculadas.map((c) => c.regra.usuarioId).filter(Boolean) as string[] } }, select: { id: true, nome: true } }),
    db.cargo.findMany({ where: { empresaId, id: { in: calculadas.map((c) => c.regra.cargoId).filter(Boolean) as string[] } }, select: { id: true, nome: true } }),
    db.servico.findMany({ where: { empresaId, id: { in: calculadas.map((c) => c.regra.servicoId).filter(Boolean) as string[] } }, select: { id: true, nome: true } }),
  ]);
  const nome = (lista: { id: string; nome: string }[], id?: string | null) => lista.find((x) => x.id === id)?.nome ?? null;

  const gravar = async (tx: Tx) => {
    await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${`comissao-orc:${orcamentoId}`}))`;
    // Idempotente: já há comissão valendo (a do vendedor substituído numa troca não conta)
    if (await tx.comissao.count({ where: { orcamentoId, ...valendo } })) return 0;
    await tx.comissao.createMany({
      data: calculadas.map((c) => ({
        empresaId, orcamentoId, usuarioId: pessoa.usuarioId, beneficiarioNome: pessoa.nome, papel: c.regra.papel,
        itemTipo: c.item.tipo, itemId: c.item.id, descricao: c.item.descricao, quantidade: c.item.quantidade,
        regraId: c.regra.id, regraDescricao: descricaoDaRegra(c.regra, { pessoa: nome(usuarios, c.regra.usuarioId), cargo: nome(cargos, c.regra.cargoId), servico: nome(servicos, c.regra.servicoId) }),
        base: c.regra.base, baseValor: c.baseValor, taxa: c.taxa, valor: c.valor, quando, liquidaImpostos: liquida, criadoEm: agora,
      })),
    });
    return calculadas.length;
  };
  if (na) {
    const n = await gravar(na.tx);
    if (n) await sincronizarNaTransacao(na.tx, empresaId, { orcamentoIds: [orcamentoId] }, agora);
    return n;
  }
  const criadas = await prisma.$transaction(gravar);
  if (criadas) await sincronizarComissoes(empresaId, { orcamentoIds: [orcamentoId] }, agora);
  return criadas;
}

/* ───────── quanto da venda já entrou ───────── */

/**
 * O recebido de cada fatura viva do orçamento (e da OS gerada dele), na proporção do que é desta venda: as contas
 * a receber da fatura (e as parcelas dela), os recebimentos não estornados e, na conta renegociada, a parte dela
 * no que já entrou da renegociação. Conta RECEBIDA antiga (sem recebimentos registrados) vale o valor dela.
 */
export interface RecebimentoDaVenda {
  faturas: FaturaRecebida[];
  ultimaData: Date | null;
  /** Cada entrada de dinheiro, em reais DESTA venda (o recebido × a parte dela na fatura), com a data: o relatório "por data de recebimento" */
  entradas: EntradaDaVenda[];
}

export async function recebimentoDaVenda(db: Db, empresaId: string, orcamentoId: string): Promise<RecebimentoDaVenda> {
  const meds = await medicoesDaOrigem(db, { orcamentoId });
  if (!meds.length) return { faturas: [], ultimaData: null, entradas: [] };
  const ids = meds.map((m) => m.id);
  const os = await db.ordemServico.findFirst({ where: { orcamentoOrigemId: orcamentoId, empresaId }, select: { id: true } });
  const [itens, contas] = await Promise.all([
    db.medicaoItem.findMany({ where: { medicaoId: { in: ids } }, select: { medicaoId: true, valorTotal: true, orcamentoId: true, ordemServicoId: true } }),
    db.contaReceber.findMany({
      where: { empresaId, excluidaEm: null, status: { notIn: ["CANCELADO", "PARCELADO"] }, OR: [{ medicaoId: { in: ids } }, { lancamento: { medicaoId: { in: ids } } }] },
      select: {
        id: true, medicaoId: true, valor: true, status: true, dataRecebimento: true, renegociadaEmId: true, lancamento: { select: { medicaoId: true } },
        recebimentos: { where: { estornadoEm: null }, select: { valor: true, data: true } },
      },
    }),
  ]);
  // Renegociação: o que entrou na conta nova, repartido pelo saldo de cada conta renegociada
  const novasIds = [...new Set(contas.map((c) => c.renegociadaEmId).filter(Boolean) as string[])];
  const novas = novasIds.length ? await db.contaReceber.findMany({
    where: { id: { in: novasIds }, empresaId },
    select: { id: true, recebimentos: { where: { estornadoEm: null }, select: { valor: true, data: true } }, renegociadas: { select: { valor: true, recebimentos: { where: { estornadoEm: null }, select: { valor: true } } } } },
  }) : [];
  const saldo = (c: { valor: unknown; recebimentos: { valor: unknown }[] }) => Math.max(0, num(c.valor) - c.recebimentos.reduce((s, r) => s + num(r.valor), 0));

  let ultimaData: Date | null = null;
  const marcar = (d: Date | null | undefined) => { if (d && (!ultimaData || d > ultimaData)) ultimaData = d; };
  const porMed = new Map<string, { aCobrar: number; recebido: number }>();
  /** As entradas cruas de cada fatura (valor recebido nela, com a data), antes de virar a parte desta venda */
  const brutas = new Map<string, { data: Date; valor: number }[]>();
  const entrar = (med: string, data: Date | null | undefined, valor: number) => {
    if (!data || valor <= 0) return;
    brutas.set(med, [...(brutas.get(med) ?? []), { data, valor }]);
  };
  for (const c of contas) {
    const med = c.medicaoId ?? c.lancamento?.medicaoId;
    if (!med) continue;
    const a = porMed.get(med) ?? { aCobrar: 0, recebido: 0 };
    a.aCobrar += num(c.valor);
    let recebido = c.recebimentos.reduce((s, r) => s + num(r.valor), 0);
    c.recebimentos.forEach((r) => { marcar(r.data); entrar(med, r.data, num(r.valor)); });
    if (c.status === "RECEBIDO" && !c.recebimentos.length) { recebido = num(c.valor); marcar(c.dataRecebimento); entrar(med, c.dataRecebimento, num(c.valor)); }
    if (c.status === "RENEGOCIADO" && c.renegociadaEmId) {
      const nova = novas.find((n) => n.id === c.renegociadaEmId);
      if (nova) {
        const meu = saldo(c);
        const todos = nova.renegociadas.reduce((s, r) => s + saldo(r), 0);
        const entrou = nova.recebimentos.reduce((s, r) => s + num(r.valor), 0);
        if (todos > 0) {
          recebido += Math.min(meu, entrou * meu / todos);
          // Cada entrada da conta nova vale para esta na mesma proporção (sem passar do saldo dela)
          const fator = entrou > 0 ? Math.min(meu, entrou * meu / todos) / entrou : 0;
          nova.recebimentos.forEach((r) => entrar(med, r.data, num(r.valor) * fator));
        }
        nova.recebimentos.forEach((r) => marcar(r.data));
      }
    }
    a.recebido += recebido;
    porMed.set(med, a);
  }
  const entradas: EntradaDaVenda[] = [];
  const faturas: FaturaRecebida[] = meds.map((m) => {
    const doMed = itens.filter((i) => i.medicaoId === m.id);
    const total = doMed.reduce((s, i) => s + num(i.valorTotal), 0);
    const daVenda = doMed.filter((i) => i.orcamentoId === orcamentoId || (!!os && i.ordemServicoId === os.id)).reduce((s, i) => s + num(i.valorTotal), 0);
    // Fatura avulsa (desta venda) ou sem linha que aponte para a venda (achada pelo relatório da OS): é toda desta venda
    const parte = m.avulsa || total <= 0 || daVenda <= 0 ? 1 : Math.min(1, daVenda / total);
    const r = porMed.get(m.id) ?? { aCobrar: 0, recebido: 0 };
    const f = { daVenda: round2(num(m.valorLiquido) * parte), aCobrar: round2(r.aCobrar), recebido: round2(r.recebido) };
    entradas.push(...entradasDaFatura(f, brutas.get(m.id) ?? []));
    return f;
  });
  return { faturas, ultimaData, entradas };
}

/* ───────── as faturas da venda, vivas e canceladas (COM-1.1) ───────── */

/**
 * TODAS as faturas (medições) ligadas à venda — vivas e canceladas, pelos mesmos caminhos de `medicoesDaOrigem`
 * (item do orçamento, item da OS gerada, relatório MEDICAO_COMPLETA) — com: cancelada (a medição ou todos os
 * títulos), a data de emissão (NFS-e autorizada > NF registrada > enviada > 1º título) e o quanto é desta venda.
 */
export async function faturasDaVenda(db: Db, empresaId: string, orcamentoId: string): Promise<FaturaDaVenda[]> {
  const os = await db.ordemServico.findFirst({ where: { orcamentoOrigemId: orcamentoId, empresaId }, select: { id: true } });
  const [porItem, porRel] = await Promise.all([
    db.medicaoItem.findMany({ where: { medicao: { empresaId }, OR: [{ orcamentoId }, ...(os ? [{ ordemServicoId: os.id }] : [])] }, select: { medicaoId: true } }),
    os ? db.relatorioOs.findMany({ where: { ordemServicoId: os.id, escopo: "MEDICAO_COMPLETA", medicaoId: { not: null } }, select: { medicaoId: true } }) : [],
  ]);
  const ids = [...new Set([...porItem, ...porRel].map((x) => x.medicaoId).filter(Boolean) as string[])];
  if (!ids.length) return [];
  const [meds, titulos] = await Promise.all([
    db.medicao.findMany({
      where: { id: { in: ids }, empresaId },
      select: {
        id: true, status: true, avulsa: true, valorLiquido: true, dataEnvio: true,
        itens: { select: { valorTotal: true, orcamentoId: true, ordemServicoId: true } },
        nfs: { select: { emitidaEm: true } },
        notasFiscais: { where: { status: "CONCLUIDO" }, select: { autorizadaEm: true } },
      },
    }),
    db.contaReceber.findMany({
      where: { empresaId, status: { not: "PARCELADO" }, OR: [{ medicaoId: { in: ids } }, { lancamento: { medicaoId: { in: ids } } }] },
      select: { medicaoId: true, status: true, excluidaEm: true, criadoEm: true, lancamento: { select: { medicaoId: true } } },
    }),
  ]);
  return meds.map((m) => {
    const dela = titulos.filter((t) => (t.medicaoId ?? t.lancamento?.medicaoId) === m.id);
    const total = m.itens.reduce((s, i) => s + num(i.valorTotal), 0);
    const daVenda = m.itens.filter((i) => i.orcamentoId === orcamentoId || (!!os && i.ordemServicoId === os.id)).reduce((s, i) => s + num(i.valorTotal), 0);
    const parte = m.avulsa || total <= 0 || daVenda <= 0 ? 1 : Math.min(1, daVenda / total);
    const vivos = dela.filter((t) => t.status !== "CANCELADO" && !t.excluidaEm);
    return {
      cancelada: faturaFoiCancelada(m.status, dela.map((t) => ({ cancelado: t.status === "CANCELADO" || !!t.excluidaEm }))),
      emitidaEm: m.status === "RASCUNHO" ? null : dataDeEmissao({
        nfseAutorizadas: m.notasFiscais.map((n) => n.autorizadaEm), nfsRegistradas: m.nfs.map((n) => n.emitidaEm),
        enviadaEm: m.dataEnvio, titulosEm: vivos.map((t) => t.criadoEm),
      }),
      daVenda: round2(num(m.valorLiquido) * parte),
    };
  });
}

/* ───────── sincronizar: liberar e estornar ───────── */

const MOTIVO: Record<Quando, string> = {
  RECEBIMENTO: "Recebimento da venda", APROVACAO: "Orçamento aprovado", CONCLUSAO_OS: "OS concluída",
};

/**
 * Leva cada comissão ao ALVO do gatilho congelado nela: cria a diferença como LIBERAÇÃO (+) ou ESTORNO (−).
 * A empresa fica travada durante a conta (dois recálculos ao mesmo tempo não liberam duas vezes).
 * `orcamentoIds`/`usuarioId` limitam a conta (o extrato de uma pessoa, um orçamento recém-aprovado).
 */
export async function sincronizarComissoes(empresaId: string, filtro: { orcamentoIds?: string[]; usuarioId?: string } = {}, agora: Date = new Date()): Promise<number> {
  return prisma.$transaction((tx) => sincronizarNaTransacao(tx, empresaId, filtro, agora), { timeout: 60_000 });
}

/** O mesmo recálculo, dentro de uma transação que já existe (a troca de vendedor) */
async function sincronizarNaTransacao(tx: Tx, empresaId: string, filtro: { orcamentoIds?: string[]; usuarioId?: string }, agora: Date): Promise<number> {
  {
    await travarEmpresa(tx, empresaId);
    const comissoes = await tx.comissao.findMany({
      where: { empresaId, ...(filtro.orcamentoIds ? { orcamentoId: { in: filtro.orcamentoIds } } : {}), ...(filtro.usuarioId ? { usuarioId: filtro.usuarioId } : {}) },
      select: { id: true, orcamentoId: true, usuarioId: true, valor: true, quando: true, papel: true, criadoEm: true, lancamentos: { select: { valor: true } } },
    });
    if (!comissoes.length) return 0;
    const orcIds = [...new Set(comissoes.map((c) => c.orcamentoId))];
    const orcs = await tx.orcamento.findMany({
      where: { id: { in: orcIds }, empresaId },
      select: { id: true, status: true, totalGeral: true, osGerada: { select: { status: true, dataConclusao: true } } },
    });
    const novos: Prisma.ComissaoLancamentoCreateManyInput[] = [];
    for (const o of orcs) {
      const desta = comissoes.filter((c) => c.orcamentoId === o.id);
      const precisaRecebido = desta.some((c) => c.quando === "RECEBIMENTO");
      const rec = precisaRecebido ? await recebimentoDaVenda(tx, empresaId, o.id) : { faturas: [], ultimaData: null, entradas: [] };
      // COM-1.1: na aprovação e na conclusão, a fatura cancelada (sem outra viva) estorna
      const precisaFaturas = desta.some((c) => c.quando !== "RECEBIMENTO");
      const estado = {
        statusOrcamento: o.status,
        osConcluida: o.osGerada?.status === "CONCLUIDA",
        fracao: fracaoRecebida(rec.faturas, num(o.totalGeral)),
        faturaCancelada: precisaFaturas && vendaComFaturaCancelada(await faturasDaVenda(tx, empresaId, o.id)),
      };
      for (const c of desta) {
        const quando = c.quando as Quando;
        const substituida = c.papel === PAPEL_SUBSTITUIDO;
        const alvo = substituida ? 0 : alvoLiberado({ valor: num(c.valor), quando }, estado);
        const ja = round2(c.lancamentos.reduce((s, l) => s + num(l.valor), 0));
        const mov = movimentoNecessario(alvo, ja);
        if (!mov) continue;
        const data = mov.tipo === "ESTORNO" ? agora
          : quando === "APROVACAO" ? c.criadoEm
          : quando === "CONCLUSAO_OS" ? o.osGerada?.dataConclusao ?? agora
          : rec.ultimaData ?? agora;
        novos.push({
          empresaId, comissaoId: c.id, usuarioId: c.usuarioId, tipo: mov.tipo, valor: mov.valor, data,
          motivo: substituida ? MOTIVO_TROCA : mov.tipo === "ESTORNO" ? motivoDoEstorno(quando, o.status, estado.faturaCancelada) : MOTIVO[quando],
        });
      }
    }
    if (novos.length) await tx.comissaoLancamento.createMany({ data: novos });
    return novos.length;
  }
}

const MOTIVO_TROCA = "Troca de vendedor";

export function motivoDoEstorno(quando: Quando, status: string, faturaCancelada = false): string {
  if (!(VENDA_VIVA as readonly string[]).includes(status)) return "Orçamento cancelado ou recusado depois da aprovação";
  if (faturaCancelada && quando !== "RECEBIMENTO") return "Fatura cancelada";
  if (quando === "CONCLUSAO_OS") return "A OS deixou de estar concluída";
  return "Recebimento estornado ou fatura cancelada";
}

/* ───────── o que entra no fechamento do mês ───────── */

export interface MovimentoAberto { id: string; usuarioId: string | null; nome: string; tecnicoId: string | null; valor: number }

/**
 * Os movimentos ainda não pagos até o fim da competência (os de meses anteriores que ficaram para trás também
 * entram: nada se perde), com o colaborador de cada pessoa (para juntar com o bônus na mesma linha).
 */
export async function movimentosAbertos(empresaId: string, competencia: string, db: Db = prisma): Promise<MovimentoAberto[]> {
  const movs = await db.comissaoLancamento.findMany({
    where: { empresaId, fechamentoId: null, data: { lt: fimDaCompetencia(competencia) } },
    select: { id: true, usuarioId: true, valor: true, comissao: { select: { beneficiarioNome: true } } },
  });
  const pessoas = new Map<string, Awaited<ReturnType<typeof colaboradorDoUsuario>>>();
  for (const uid of new Set(movs.map((m) => m.usuarioId).filter(Boolean) as string[])) pessoas.set(uid, await colaboradorDoUsuario(empresaId, uid, db));
  return movs.map((m) => {
    const p = m.usuarioId ? pessoas.get(m.usuarioId) : null;
    return { id: m.id, usuarioId: m.usuarioId, nome: p?.nome ?? m.comissao.beneficiarioNome, tecnicoId: p?.tecnicoId ?? null, valor: num(m.valor) };
  });
}

/** Por pessoa, o que entra no mês (saldo negativo fica para o mês seguinte) e os ids dos movimentos que entram */
export function comissoesDoMes(movs: readonly MovimentoAberto[]) {
  const pessoas = comissoesPorPessoa(movs);
  const quem = new Set(pessoas.map((p) => p.usuarioId));
  return { pessoas, ids: movs.filter((m) => m.usuarioId && quem.has(m.usuarioId)).map((m) => m.id) };
}

/* ───────── o extrato da própria pessoa ───────── */

export interface VendaNoExtrato {
  orcamentoId: string; codigo: string; nome: string; cliente: string; osNumero: string | null;
  prevista: number; liberada: number; paga: number;
  itens: { descricao: string; regra: string; valor: number }[];
}
export interface Extrato { vendas: VendaNoExtrato[]; totais: { prevista: number; liberada: number; paga: number } }

/**
 * "Minhas comissões": o extrato da PRÓPRIA pessoa, por orçamento/OS — prevista, liberada e paga. Nunca leva custo,
 * margem nem a base em reais (a regra "% do lucro" mostra só o valor da comissão).
 */
export async function extratoDoUsuario(empresaId: string, usuarioId: string, agora: Date = new Date()): Promise<Extrato> {
  await sincronizarComissoes(empresaId, { usuarioId }, agora);
  const cs = await prisma.comissao.findMany({
    where: { empresaId, usuarioId },
    orderBy: { criadoEm: "desc" },
    select: {
      orcamentoId: true, descricao: true, regraDescricao: true, valor: true, papel: true,
      orcamento: { select: { codigo: true, nome: true, cliente: { select: { nome: true } }, osGerada: { select: { numero: true } } } },
      lancamentos: { select: { valor: true, fechamento: { select: { situacao: true } } } },
    },
    take: 600,
  });
  const vendas = new Map<string, VendaNoExtrato>();
  for (const c of cs) {
    // COM-1.1: a do vendedor substituído não tem nada a receber; fica só o que já foi pago (o estorno da troca zera o resto)
    const substituida = c.papel === PAPEL_SUBSTITUIDO;
    const s = situacaoDaComissao(substituida ? 0 : num(c.valor), c.lancamentos.map((l) => ({ valor: num(l.valor), pago: l.fechamento?.situacao === "FECHADO" })));
    if (substituida && !s.prevista && !s.liberada && !s.paga) continue;
    const v = vendas.get(c.orcamentoId) ?? {
      orcamentoId: c.orcamentoId, codigo: c.orcamento.codigo, nome: c.orcamento.nome, cliente: c.orcamento.cliente.nome, osNumero: c.orcamento.osGerada?.numero ?? null,
      prevista: 0, liberada: 0, paga: 0, itens: [],
    };
    v.prevista = round2(v.prevista + s.prevista); v.liberada = round2(v.liberada + s.liberada); v.paga = round2(v.paga + s.paga);
    if (!substituida) v.itens.push({ descricao: c.descricao, regra: c.regraDescricao, valor: num(c.valor) });
    vendas.set(c.orcamentoId, v);
  }
  const lista = [...vendas.values()];
  return {
    vendas: lista,
    totais: {
      prevista: round2(lista.reduce((s, v) => s + v.prevista, 0)), liberada: round2(lista.reduce((s, v) => s + v.liberada, 0)), paga: round2(lista.reduce((s, v) => s + v.paga, 0)),
    },
  };
}

/* ───────── o relatório do mês: por data de emissão ou por data de recebimento ───────── */

export interface VendaNoRelatorio { orcamentoId: string; codigo: string; nome: string; cliente: string; data: string; valor: number }
export interface PessoaNoRelatorio { usuarioId: string | null; nome: string; valor: number; vendas: VendaNoRelatorio[] }
export interface RelatorioComissoes { competencia: string; vista: Vista; quando: Quando; pessoas: PessoaNoRelatorio[]; total: number }

/**
 * As comissões do mês vistas por uma das datas — só LEITURA (o que o fechamento paga segue o "quando é devida"):
 *  - EMISSÃO (COM-1.1): a parte de cada comissão coberta pelas faturas vivas da venda EMITIDAS no mês (a data da
 *    fatura/NF, como no OMIE — não a aprovação). Venda viva sem fatura emitida não aparece;
 *  - RECEBIMENTO: a parte de cada comissão coberta pelo dinheiro que entrou no mês (recebimento a recebimento).
 * Sem `vista`, abre na do "quando é devida" da empresa.
 */
export async function relatorioDeComissoes(empresaId: string, competencia: string, vista?: Vista): Promise<RelatorioComissoes> {
  const cfg = await prisma.configuracao.findUnique({ where: { empresaId }, select: { comissaoQuando: true } });
  const quando = ((cfg?.comissaoQuando as Quando | undefined) ?? "RECEBIMENTO");
  const v: Vista = vista ?? vistaPadrao(quando);
  const ini = inicioDaCompetencia(competencia), fim = fimDaCompetencia(competencia);
  const cs = await prisma.comissao.findMany({
    where: { empresaId, ...valendo, ...(v === "EMISSAO" ? { orcamento: { status: { in: [...VENDA_VIVA] } } } : {}) },
    select: {
      orcamentoId: true, usuarioId: true, beneficiarioNome: true, valor: true, criadoEm: true,
      orcamento: { select: { codigo: true, nome: true, totalGeral: true, cliente: { select: { nome: true } } } },
    },
    orderBy: { criadoEm: "asc" },
  });
  const porVenda = new Map<string, { o: (typeof cs)[number]["orcamento"]; data: Date; porPessoa: Map<string, { nome: string; usuarioId: string | null; valor: number }> }>();
  for (const c of cs) {
    const ven = porVenda.get(c.orcamentoId) ?? { o: c.orcamento, data: c.criadoEm, porPessoa: new Map() };
    const k = c.usuarioId ?? `nome:${c.beneficiarioNome}`;
    const p = ven.porPessoa.get(k) ?? { nome: c.beneficiarioNome, usuarioId: c.usuarioId, valor: 0 };
    p.valor += num(c.valor);
    ven.porPessoa.set(k, p);
    porVenda.set(c.orcamentoId, ven);
  }
  const pessoas = new Map<string, PessoaNoRelatorio>();
  for (const [orcamentoId, ven] of porVenda) {
    let fator = 1;
    let data = ven.data;
    if (v === "RECEBIMENTO") {
      const rec = await recebimentoDaVenda(prisma, empresaId, orcamentoId);
      fator = fracaoRecebidaNoPeriodo(rec.entradas, num(ven.o.totalGeral), ini, fim);
      if (fator <= 0) continue;
      const noMes = rec.entradas.filter((e) => e.data >= ini && e.data < fim);
      data = noMes[noMes.length - 1]?.data ?? data;
    } else {
      const fs = await faturasDaVenda(prisma, empresaId, orcamentoId);
      fator = fracaoEmitidaNoPeriodo(fs, num(ven.o.totalGeral), ini, fim);
      if (fator <= 0) continue;
      data = ultimaEmissaoNoPeriodo(fs, ini, fim) ?? data;
    }
    for (const [k, p] of ven.porPessoa) {
      const valor = round2(p.valor * fator);
      if (valor <= 0) continue;
      const linha = pessoas.get(k) ?? { usuarioId: p.usuarioId, nome: p.nome, valor: 0, vendas: [] };
      linha.valor = round2(linha.valor + valor);
      linha.vendas.push({ orcamentoId, codigo: ven.o.codigo, nome: ven.o.nome, cliente: ven.o.cliente.nome, data: data.toISOString(), valor });
      pessoas.set(k, linha);
    }
  }
  const lista = [...pessoas.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return { competencia, vista: v, quando, pessoas: lista, total: round2(lista.reduce((s, p) => s + p.valor, 0)) };
}

/**
 * Chamado logo depois de o orçamento ser APROVADO (link do cliente ou equipe): gera as comissões. Nunca derruba a
 * aprovação — se falhar, fica no log (a aprovação do cliente vale mais que a conta da comissão).
 */
export async function comissoesNaAprovacao(empresaId: string, orcamentoId: string): Promise<void> {
  try {
    await gerarComissoesDoOrcamento(empresaId, orcamentoId);
  } catch (e) {
    console.error("[comissoes] falha ao gerar as comissões do orçamento", orcamentoId, e);
  }
}

/* ───────── trocar o vendedor ───────── */

export const MSG_VENDEDOR_INVALIDO = "Escolha um usuário ativo desta empresa.";
export const MSG_MESMO_VENDEDOR = "Este já é o vendedor do orçamento.";
export const msgComissaoPaga = (competencia: string) =>
  `A comissão desta venda já foi paga no fechamento de ${competencia.slice(5, 7)}/${competencia.slice(0, 4)}: a troca de vendedor não pode mudar o que já foi pago. Fale com o financeiro.`;

/**
 * TROCA o vendedor do orçamento (só quem tem "Trocar vendedor": a rota confere): o novo segue para a OS gerada e
 * para as faturas da venda; a trilha registra quem, de quem para quem e o motivo.
 * COM-1.1 — com a comissão já liberada, a troca vale (com o motivo), tudo NA MESMA TRANSAÇÃO: o que foi liberado
 * para o antigo é ESTORNADO ("Troca de vendedor"), a comissão dele fica como "substituída" (histórico) e o novo
 * ganha a dele (regras de hoje, o mesmo "quando" congelado), já liberada no que for devido. Se algo da comissão
 * já entrou num fechamento FECHADO (pago), a troca é recusada. Comissão sem nada liberado é simplesmente refeita.
 */
export async function trocarVendedor(o: { empresaId: string; orcamentoId: string; vendedorId: string; motivo: string; quem: { id: string; nome: string } }):
  Promise<{ ok: true; vendedor: { id: string; nome: string } } | { ok: false; status: number; erro: string }> {
  const orc = await prisma.orcamento.findFirst({ where: { id: o.orcamentoId, empresaId: o.empresaId }, select: { id: true, status: true, vendedorId: true, vendedor: { select: { nome: true } } } });
  if (!orc) return { ok: false, status: 404, erro: "Orçamento não encontrado" };
  const novo = await prisma.usuario.findFirst({ where: { id: o.vendedorId, empresaId: o.empresaId, ativo: true }, select: { id: true, nome: true } });
  if (!novo) return { ok: false, status: 400, erro: MSG_VENDEDOR_INVALIDO };
  if (orc.vendedorId === novo.id) return { ok: false, status: 400, erro: MSG_MESMO_VENDEDOR };
  const recusa = await prisma.$transaction(async (tx) => {
    // A mesma trava do recálculo e do fechamento: ninguém libera nem fecha no meio da troca
    await travarEmpresa(tx, o.empresaId);
    const pago = await tx.comissaoLancamento.findFirst({
      where: { empresaId: o.empresaId, comissao: { orcamentoId: orc.id, ...valendo }, fechamento: { situacao: "FECHADO" } },
      select: { fechamento: { select: { competencia: true } } },
    });
    if (pago?.fechamento) return msgComissaoPaga(pago.fechamento.competencia);
    await tx.orcamento.update({ where: { id: orc.id }, data: { vendedorId: novo.id } });
    await tx.ordemServico.updateMany({ where: { empresaId: o.empresaId, orcamentoOrigemId: orc.id }, data: { vendedorId: novo.id } });
    await tx.medicao.updateMany({ where: { empresaId: o.empresaId, itens: { some: { orcamentoId: orc.id } } }, data: { vendedorId: novo.id } });
    await tx.orcamentoEvento.create({
      data: {
        empresaId: o.empresaId, orcamentoId: orc.id, tipo: "VENDEDOR", usuarioId: o.quem.id,
        detalhe: `Vendedor: ${orc.vendedor?.nome ?? "sem vendedor"} → ${novo.nome}. Motivo: ${o.motivo.trim()}`.slice(0, 500),
      },
    });
    const antigas = await tx.comissao.findMany({
      where: { empresaId: o.empresaId, orcamentoId: orc.id, ...valendo },
      select: { id: true, usuarioId: true, quando: true, liquidaImpostos: true, lancamentos: { select: { valor: true } } },
    });
    if (!antigas.length) return null;
    // O que nunca foi liberado some (nasce de novo para o novo); o que já foi liberado é estornado e fica no histórico
    const agora = new Date();
    const comMovimento = antigas.filter((c) => c.lancamentos.length);
    await tx.comissao.deleteMany({ where: { id: { in: antigas.filter((c) => !c.lancamentos.length).map((c) => c.id) } } });
    const estornos = comMovimento
      .map((c) => ({ c, saldo: round2(c.lancamentos.reduce((s, l) => s + num(l.valor), 0)) }))
      .filter((x) => Math.abs(x.saldo) >= 0.01)
      .map((x) => ({ empresaId: o.empresaId, comissaoId: x.c.id, usuarioId: x.c.usuarioId, tipo: x.saldo > 0 ? "ESTORNO" : "LIBERACAO", valor: -x.saldo, data: agora, motivo: MOTIVO_TROCA }));
    if (estornos.length) await tx.comissaoLancamento.createMany({ data: estornos });
    if (comMovimento.length) await tx.comissao.updateMany({ where: { id: { in: comMovimento.map((c) => c.id) } }, data: { papel: PAPEL_SUBSTITUIDO } });
    // A do novo vendedor nasce aqui mesmo, com o "quando" que a venda já tinha, e libera o que for devido
    await gerarComissoesDoOrcamento(o.empresaId, orc.id, agora, { tx, quando: antigas[0].quando as Quando, liquidaImpostos: antigas[0].liquidaImpostos });
    return null;
  }, { timeout: 60_000 });
  if (recusa) return { ok: false, status: 409, erro: recusa };
  return { ok: true, vendedor: novo };
}

/* ───────── a configuração (Configurações › Comissões) ───────── */

export const MSG_REGRA_REPETIDA = "Já existe uma regra ativa para a mesma pessoa/cargo e o mesmo alvo. Edite a que existe.";
export const MSG_REFERENCIA = "Pessoa, cargo ou serviço não encontrado nesta empresa.";

/** A tela de Comissões: as regras (com os nomes), a configuração da empresa e as opções dos seletores */
export async function telaDeComissoes(empresaId: string) {
  const [regras, cfg, pessoas, cargos, servicos] = await Promise.all([
    prisma.comissaoRegra.findMany({
      where: { empresaId }, orderBy: [{ ativo: "desc" }, { criadoEm: "asc" }],
      select: { id: true, quemTipo: true, usuarioId: true, cargoId: true, papel: true, sobreTipo: true, categoria: true, servicoId: true, base: true, valor: true, ativo: true, usuario: { select: { nome: true } }, cargo: { select: { nome: true } }, servico: { select: { nome: true } } },
    }),
    prisma.configuracao.findUnique({ where: { empresaId }, select: { comissaoQuando: true, comissaoLiquidaImpostos: true, comissaoVencimentoTipo: true, comissaoVencimentoDia: true } }),
    prisma.usuario.findMany({ where: { empresaId, ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    prisma.cargo.findMany({ where: { empresaId, ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    prisma.servico.findMany({ where: { empresaId, ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, categoria: true } }),
  ]);
  const categorias = [...new Set(servicos.map((s) => s.categoria?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return {
    regras: regras.map((r) => ({
      id: r.id, quemTipo: r.quemTipo, usuarioId: r.usuarioId, cargoId: r.cargoId, papel: r.papel, sobreTipo: r.sobreTipo, categoria: r.categoria, servicoId: r.servicoId,
      base: r.base, valor: num(r.valor), ativo: r.ativo, nomes: { pessoa: r.usuario?.nome ?? null, cargo: r.cargo?.nome ?? null, servico: r.servico?.nome ?? null },
    })),
    config: {
      quando: (cfg?.comissaoQuando ?? "RECEBIMENTO") as Quando, liquidaImpostos: cfg?.comissaoLiquidaImpostos ?? false,
      vencimento: lerVencimento(cfg?.comissaoVencimentoTipo, cfg?.comissaoVencimentoDia),
    },
    opcoes: { pessoas, cargos, servicos: servicos.map((s) => ({ id: s.id, nome: s.nome })), categorias },
  };
}

/** Grava (cria ou edita) uma regra: as referências precisam ser da empresa e não pode haver outra ativa com a mesma chave. */
export async function salvarRegra(empresaId: string, dados: ReturnType<typeof normalizarRegra>, o: { id?: string; criadoPorId?: string } = {}):
  Promise<{ ok: true; id: string } | { ok: false; status: number; erro: string }> {
  if (o.id && !(await prisma.comissaoRegra.findFirst({ where: { id: o.id, empresaId }, select: { id: true } }))) return { ok: false, status: 404, erro: "Regra não encontrada" };
  const [u, c, s] = await Promise.all([
    dados.usuarioId ? prisma.usuario.count({ where: { id: dados.usuarioId, empresaId } }) : 1,
    dados.cargoId ? prisma.cargo.count({ where: { id: dados.cargoId, empresaId } }) : 1,
    dados.servicoId ? prisma.servico.count({ where: { id: dados.servicoId, empresaId } }) : 1,
  ]);
  if (!u || !c || !s) return { ok: false, status: 400, erro: MSG_REFERENCIA };
  if (dados.ativo) {
    const outras = await prisma.comissaoRegra.findMany({ where: { empresaId, ativo: true, ...(o.id ? { id: { not: o.id } } : {}) }, select: { papel: true, quemTipo: true, usuarioId: true, cargoId: true, sobreTipo: true, servicoId: true, categoria: true } });
    const chave = chaveDaRegra(dados as Parameters<typeof chaveDaRegra>[0]);
    if (outras.some((r) => chaveDaRegra(r as Parameters<typeof chaveDaRegra>[0]) === chave)) return { ok: false, status: 409, erro: MSG_REGRA_REPETIDA };
  }
  if (o.id) {
    await prisma.comissaoRegra.update({ where: { id: o.id }, data: dados });
    return { ok: true, id: o.id };
  }
  const r = await prisma.comissaoRegra.create({ data: { ...dados, empresaId, criadoPorId: o.criadoPorId ?? null }, select: { id: true } });
  return { ok: true, id: r.id };
}
