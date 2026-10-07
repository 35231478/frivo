import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { LABELS_FUNCAO } from "@/lib/colaborador-listagem";
import {
  MODELOS_PADRAO, calcularCusto, competenciaAnterior, type CustoColaborador, type DadosFolha, type ItemEncargo, type Regime,
} from "@/lib/folha/calculo";
import { itensDoModelo } from "@/lib/folha/validacao";

/**
 * Custo de Pessoal — consultas do servidor. TODA função recebe o empresaId da sessão e filtra por ele.
 * Quem chama já conferiu a permissão "financeiro.folha".
 */

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));

export interface ModeloResumo { id: string; nome: string; regime: Regime; padrao: boolean; ativo: boolean; itens: ItemEncargo[] }

/** Cria os modelos padrão na primeira vez (idempotente: nome é único por empresa). */
export async function garantirModelosPadrao(empresaId: string) {
  const existe = await prisma.modeloEncargos.count({ where: { empresaId } });
  if (existe > 0) return;
  await prisma.modeloEncargos.createMany({
    data: MODELOS_PADRAO.map((m) => ({ empresaId, nome: m.nome, regime: m.regime, padrao: true, itens: m.itens as any })),
    skipDuplicates: true,
  });
}

export async function listarModelos(empresaId: string): Promise<ModeloResumo[]> {
  const ms = await prisma.modeloEncargos.findMany({ where: { empresaId }, orderBy: [{ regime: "asc" }, { padrao: "desc" }, { nome: "asc" }] });
  return ms.map((m) => ({ id: m.id, nome: m.nome, regime: m.regime as Regime, padrao: m.padrao, ativo: m.ativo, itens: itensDoModelo(m.itens) }));
}

/** Modelo aplicado: o escolhido no colaborador (se ativo e do mesmo regime); senão o padrão do regime. */
export function modeloAplicado(modelos: ModeloResumo[], regime: Regime, escolhidoId?: string | null) {
  const escolhido = escolhidoId ? modelos.find((m) => m.id === escolhidoId && m.ativo && m.regime === regime) : undefined;
  return escolhido
    ?? modelos.find((m) => m.regime === regime && m.ativo && m.padrao)
    ?? modelos.find((m) => m.regime === regime && m.ativo)
    ?? null;
}

const selectColaborador = {
  id: true, nome: true, tipo: true, salario: true, dataAdmissao: true, ativo: true,
  cargo: { select: { nome: true } },
  equipesLideradas: { where: { status: "ATIVA" as const }, select: { nome: true }, orderBy: { nome: "asc" as const } },
  equipesMembro: { where: { status: "ATIVA" as const }, select: { nome: true }, orderBy: { nome: "asc" as const } },
  folha: true,
} satisfies Prisma.TecnicoSelect;

type ColaboradorComFolha = Prisma.TecnicoGetPayload<{ select: typeof selectColaborador }>;

export function dadosDoColaborador(c: { salario: Prisma.Decimal | number | null; folha: ColaboradorComFolha["folha"] }): DadosFolha {
  const f = c.folha;
  return {
    regime: (f?.regime ?? "CLT") as Regime,
    salario: num(c.salario),
    valorDiaria: num(f?.valorDiaria), diasMes: f?.diasMes ?? null, horasMes: f?.horasMes ?? null,
    adicionalTipo: f?.adicionalTipo ?? "NENHUM", adicionalPercent: num(f?.adicionalPercent), adicionalValor: num(f?.adicionalValor),
    horasExtrasValor: num(f?.horasExtrasValor),
    valeTransporte: num(f?.valeTransporte), descontaVt: f?.descontaVt ?? true,
    valeAlimentacao: num(f?.valeAlimentacao), planoSaude: num(f?.planoSaude), outrosBeneficios: num(f?.outrosBeneficios),
    descontos: num(f?.descontos),
  };
}

export interface LinhaFolha {
  id: string;
  nome: string;
  /** Função do cadastro (TECNICO_CAMPO, ADMINISTRATIVO…) */
  tipo: string;
  funcao: string;
  equipe: string | null;
  regime: Regime;
  modelo: string | null;
  /** Sem salário/base e sem dados de folha: entra com custo zero e aparece como pendência */
  semDados: boolean;
  admitidoNoMes: boolean;
  custo: CustoColaborador;
}

export function montarLinha(c: ColaboradorComFolha, modelos: ModeloResumo[], competencia?: string): LinhaFolha {
  const dados = dadosDoColaborador(c);
  const modelo = modeloAplicado(modelos, dados.regime, c.folha?.modeloEncargosId);
  const custo = calcularCusto(dados, modelo?.itens ?? []);
  const equipe = c.equipesLideradas[0]?.nome ?? c.equipesMembro[0]?.nome ?? null;
  const adm = c.dataAdmissao ? c.dataAdmissao.toISOString().slice(0, 7) : null;
  return {
    id: c.id, nome: c.nome, tipo: c.tipo,
    funcao: c.cargo?.nome ?? LABELS_FUNCAO[c.tipo] ?? c.tipo,
    equipe, regime: dados.regime, modelo: modelo?.nome ?? null,
    semDados: custo.base === 0 && !c.folha,
    admitidoNoMes: !!competencia && adm === competencia,
    custo,
  };
}

/** Folha atual (colaboradores ativos) com o custo calculado agora. */
export async function folhaAtual(empresaId: string, competencia?: string) {
  await garantirModelosPadrao(empresaId);
  const [colaboradores, modelos] = await Promise.all([
    prisma.tecnico.findMany({ where: { empresaId, ativo: true }, select: selectColaborador, orderBy: { nome: "asc" } }),
    listarModelos(empresaId),
  ]);
  return { linhas: colaboradores.map((c) => montarLinha(c, modelos, competencia)), modelos };
}

export interface Agrupado { chave: string; qtd: number; total: number }

export function agrupar(linhas: LinhaFolha[], por: (l: LinhaFolha) => string): Agrupado[] {
  const m = new Map<string, Agrupado>();
  for (const l of linhas) {
    const k = por(l);
    const g = m.get(k) ?? { chave: k, qtd: 0, total: 0 };
    g.qtd++; g.total = Math.round((g.total + l.custo.total) * 100) / 100;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

/** Grava a foto do mês: substitui a da competência (refazer = fotografar de novo com os dados atuais). */
export async function fecharMes(empresaId: string, competencia: string, criadoPor: string) {
  const { linhas } = await folhaAtual(empresaId, competencia);
  const data = linhas.map((l) => ({
    empresaId, competencia, colaboradorId: l.id, nome: l.nome, funcao: l.funcao, equipe: l.equipe, regime: l.regime,
    base: l.custo.base, adicionais: l.custo.adicional + l.custo.horasExtras, encargos: l.custo.encargos,
    beneficios: l.custo.beneficios, descontos: l.custo.descontos, custoTotal: l.custo.total,
    horasMes: l.custo.horasMes, custoHora: l.custo.custoHora,
    detalhe: { modelo: l.modelo, percentualEncargos: l.custo.percentualEncargos, encargos: l.custo.encargosItens, semDados: l.semDados } as any,
    criadoPor,
  }));
  await prisma.$transaction([
    prisma.folhaSnapshot.deleteMany({ where: { empresaId, competencia } }),
    prisma.folhaSnapshot.createMany({ data }),
  ]);
  return { colaboradores: data.length, total: Math.round(data.reduce((s, d) => s + d.custoTotal, 0) * 100) / 100 };
}

/** Evolução mês a mês (meses fechados), das `meses` competências até `ate` (inclusive). */
export async function evolucao(empresaId: string, ate: string, meses = 12) {
  const desde = competenciaAnterior(ate, meses - 1);
  const rows = await prisma.folhaSnapshot.groupBy({
    by: ["competencia"],
    where: { empresaId, competencia: { gte: desde, lte: ate } },
    _sum: { custoTotal: true, encargos: true },
    _count: { _all: true },
    orderBy: { competencia: "asc" },
  });
  return rows.map((r) => ({
    competencia: r.competencia,
    total: Number(r._sum.custoTotal ?? 0),
    encargos: Number(r._sum.encargos ?? 0),
    colaboradores: r._count._all,
  }));
}
