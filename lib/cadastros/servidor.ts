import { prisma } from "@/lib/prisma";
import type { Impacto } from "@/lib/inativacao-server";
import {
  CADASTROS, mensagemValidacao, whereCadastro, type DefCadastro, type EntidadeCadastro, type FiltroAtivo,
} from "@/lib/cadastros/registro";
import { REGRAS, type Ator, type Registro } from "@/lib/cadastros/especificos";

/**
 * Cadastros padronizados — lado do servidor (Prisma). Toda operação recebe o empresaId da SESSÃO;
 * id de outra empresa = não encontrado. Permissão é conferida por quem chama (rotas.ts).
 */

type Delegate = {
  findMany: (a: object) => Promise<Record<string, unknown>[]>;
  findFirst: (a: object) => Promise<Record<string, unknown> | null>;
  count: (a: object) => Promise<number>;
  create: (a: object) => Promise<Record<string, unknown>>;
  update: (a: object) => Promise<Record<string, unknown>>;
};
export const tabela = (def: DefCadastro) => (prisma as unknown as Record<string, Delegate>)[def.modelo];

export type ResultadoGravacao = { ok: true; item: Record<string, unknown> } | { ok: false; status: number; erro: string };

/** Tira as colunas ocultas (ex.: hash da senha) de QUALQUER resposta. */
export function limpar<T extends Record<string, unknown> | null>(def: DefCadastro, item: T): T {
  if (!item || !def.ocultos?.length) return item;
  const copia: Record<string, unknown> = { ...item };
  for (const k of def.ocultos) delete copia[k];
  return copia as T;
}

export async function listarCadastro(def: DefCadastro, empresaId: string, f: { ativo: FiltroAtivo; q?: string | null }) {
  await REGRAS[def.entidade]?.antesDeListar?.(empresaId);
  const itens = await tabela(def).findMany({
    where: whereCadastro(def, empresaId, f), orderBy: def.ordem ?? { nome: "asc" }, ...(def.incluir && { include: def.incluir }),
  });
  return itens.map((i) => limpar(def, i));
}

/** Registro BRUTO (com colunas ocultas) — só para uso interno, nunca para resposta. */
export function obterBruto(def: DefCadastro, empresaId: string, id: string) {
  const include = def.incluir || def.incluirItem ? { ...def.incluir, ...def.incluirItem } : undefined;
  return tabela(def).findFirst({ where: { id, empresaId }, ...(include && { include }) });
}

export async function obterCadastro(def: DefCadastro, empresaId: string, id: string) {
  return limpar(def, await obterBruto(def, empresaId, id));
}

/** Cria (sempre ativo, sempre na empresa da sessão). Campo desconhecido no corpo = 400. */
export async function criarCadastro(def: DefCadastro, ator: Ator, corpo: unknown): Promise<ResultadoGravacao> {
  const parsed = def.schemaCriar.safeParse(corpo ?? {});
  if (!parsed.success) return { ok: false, status: 400, erro: mensagemValidacao(parsed.error, def) };
  const especifico = REGRAS[def.entidade]?.criar;
  const r = especifico
    ? await especifico(parsed.data as Record<string, unknown>, ator)
    : { ok: true as const, item: await tabela(def).create({ data: { ...(parsed.data as object), empresaId: ator.empresaId, ativo: true } }) };
  return r.ok ? { ok: true, item: limpar(def, r.item) } : r;
}

/** Edição PARCIAL: só os campos enviados mudam (nunca zera o que não veio). Campo desconhecido = 400. */
export async function editarCadastro(def: DefCadastro, ator: Ator, id: string, corpo: unknown): Promise<ResultadoGravacao> {
  const existente = await obterBruto(def, ator.empresaId, id);
  if (!existente) return { ok: false, status: 404, erro: `${def.singular[0].toUpperCase()}${def.singular.slice(1)} não encontrad${def.feminino ? "a" : "o"}.` };
  const parsed = def.schemaEditar.safeParse(corpo ?? {});
  if (!parsed.success) return { ok: false, status: 400, erro: mensagemValidacao(parsed.error, def) };
  const data = Object.fromEntries(Object.entries(parsed.data as object).filter(([, v]) => v !== undefined));
  if (!Object.keys(data).length) return { ok: true, item: limpar(def, existente) };
  const especifico = REGRAS[def.entidade]?.editar;
  const r = especifico
    ? await especifico(existente as Registro, data, ator)
    : { ok: true as const, item: await tabela(def).update({ where: { id }, data }) };
  return r.ok ? { ok: true, item: limpar(def, r.item) } : r;
}

/* ───────── Impacto: quantos registros usam (para o diálogo de inativar) ───────── */
export interface Uso { rotulo: string; total: number }
export type ImpactoCadastro = Impacto & { usos: Uso[] };

const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
function juntar(partes: string[]) {
  return partes.length <= 1 ? partes.join("") : `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

async function contarUsos(entidade: EntidadeCadastro, id: string, nome: string, empresaId: string): Promise<Uso[]> {
  switch (entidade) {
    case "produtos": {
      const [orc, med, ped, tab] = await Promise.all([
        prisma.orcamento.count({ where: { empresaId, produtos: { some: { produtoId: id } } } }),
        prisma.medicao.count({ where: { empresaId, itens: { some: { produtoId: id } } } }),
        prisma.pedidoCompraInterno.count({ where: { empresaId, itens: { some: { produtoId: id } } } }),
        prisma.tabelaPreco.count({ where: { empresaId, itens: { some: { produtoId: id } } } }),
      ]);
      return [
        { rotulo: pl(orc, "orçamento", "orçamentos"), total: orc }, { rotulo: pl(med, "medição", "medições"), total: med },
        { rotulo: pl(ped, "pedido de compra", "pedidos de compra"), total: ped }, { rotulo: pl(tab, "tabela de preço", "tabelas de preço"), total: tab },
      ];
    }
    case "servicos": {
      const [orc, med, tab, ctr] = await Promise.all([
        prisma.orcamento.count({ where: { empresaId, servicos: { some: { servicoId: id } } } }),
        prisma.medicao.count({ where: { empresaId, itens: { some: { servicoId: id } } } }),
        prisma.tabelaPreco.count({ where: { empresaId, itens: { some: { servicoId: id } } } }),
        prisma.contrato.count({ where: { empresaId, servicosNFSeIds: { has: id } } }),
      ]);
      return [
        { rotulo: pl(orc, "orçamento", "orçamentos"), total: orc }, { rotulo: pl(med, "medição", "medições"), total: med },
        { rotulo: pl(tab, "tabela de preço", "tabelas de preço"), total: tab }, { rotulo: pl(ctr, "contrato (NFS-e)", "contratos (NFS-e)"), total: ctr },
      ];
    }
    case "cargos": {
      const n = await prisma.tecnico.count({ where: { empresaId, cargoId: id, ativo: true } });
      return [{ rotulo: pl(n, "colaborador ativo", "colaboradores ativos"), total: n }];
    }
    case "categorias-financeiras": {
      // A conta a receber guarda o NOME da categoria
      const n = await prisma.contaReceber.count({ where: { empresaId, categoria: nome } });
      return [{ rotulo: pl(n, "conta a receber", "contas a receber"), total: n }];
    }
     default:
      return [];
  }
}

/**
 * Impacto antes de inativar: usos + avisos + o que BLOQUEIA (mesma trava da rota e da ação em massa;
 * o modal mostra e desabilita o botão). `ator` = quem vai inativar (travas que dependem dele).
 */
export async function impactoCadastro(entidade: EntidadeCadastro, id: string, empresaId: string, ator?: Pick<Ator, "id" | "empresaId" | "role" | "permissoes">): Promise<ImpactoCadastro | null> {
  const def = CADASTROS[entidade];
  const r = await obterBruto(def, empresaId, id);
  if (!r) return null;
  const regras = REGRAS[entidade];
  const bloqueio = ator && regras?.bloqueioAtivo ? await regras.bloqueioAtivo(r as Registro, false, ator) : null;
  if (regras?.impacto) {
    const e = await regras.impacto(r as Registro, empresaId);
    return { bloqueio, avisos: e.avisos.length ? e.avisos : ["Não está em uso em nenhum registro."], usos: e.usos.filter((u) => u.total > 0) };
  }
  const usos = (await contarUsos(entidade, id, String(r.nome ?? ""), empresaId)).filter((u) => u.total > 0);
  const o = def.feminino ? "a" : "o";
  const avisos = usos.length
    ? [
      `Em uso: ${juntar(usos.map((u) => u.rotulo))}.`,
      `Esses registros continuam como estão (nada é apagado) e seguem mostrando ${o} ${def.singular} como “inativ${o}”; ${def.feminino ? "ela" : "ele"} só deixa de ser oferecid${o} para novas escolhas.`,
    ]
    : [`Não está em uso em nenhum registro.`];
  return { bloqueio, avisos, usos };
}

/* ───────── Ações em massa (seleção, rótulos, "todos do filtro", exportação) ───────── */
export async function rotulosCadastro(entidade: EntidadeCadastro, ids: string[], empresaId: string): Promise<[string, string][]> {
  const rs = await tabela(CADASTROS[entidade]).findMany({ where: { id: { in: ids }, empresaId }, select: { id: true, nome: true } });
  return rs.map((r) => [String(r.id), String(r.nome)]);
}

/** O filtro vem da URL da tela (?aba=ativos|inativos|todos&q=…): mesmo where da lista. */
export async function idsCadastro(entidade: EntidadeCadastro, sp: Record<string, string>, empresaId: string, max: number) {
  const def = CADASTROS[entidade];
  const ativo: FiltroAtivo = sp.aba === "inativos" ? "nao" : sp.aba === "todos" ? "todos" : "sim";
  const where = whereCadastro(def, empresaId, { ativo, q: sp.q });
  const [linhas, total] = await Promise.all([
    tabela(def).findMany({ where, select: { id: true }, orderBy: { nome: "asc" }, take: max + 1 }),
    tabela(def).count({ where }),
  ]);
  return { ids: linhas.slice(0, max).map((l) => String(l.id)), total };
}

export async function linhasCadastro(entidade: EntidadeCadastro, ids: string[], empresaId: string): Promise<string[][]> {
  const def = CADASTROS[entidade];
  const rs = await tabela(def).findMany({ where: { id: { in: ids }, empresaId }, orderBy: { nome: "asc" } });
  const campos = def.campos;
  const fmt = (v: unknown) => (v == null ? "" : typeof v === "object" ? String(Number(v)).replace(".", ",") : String(v));
  return [[...campos.map((c) => c.label), "Situação"], ...rs.map((r) => [...campos.map((c) => fmt(r[c.key])), r.ativo ? "Ativo" : "Inativo"])];
}
