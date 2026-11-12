/**
 * Sugestões da busca das listas (typeahead): as ~5 que mais combinam com o que se digita.
 * Usa o MESMO `where` de cada lista (com os filtros padrão dela) — a sugestão nunca mostra algo
 * que a lista não acharia. Empresa sempre da sessão; permissão = ver o módulo da lista.
 * Devolve só id, rótulo, um detalhe curto e o link do registro (nada além do que a lista mostra).
 */
import { prisma } from "@/lib/prisma";
import { whereClientes, whereContratos, whereOrcamentos, whereOrdens, wherePedidosCompra } from "@/lib/listas/filtros";
import { lerFiltros, montarWhere } from "@/lib/equipamento-listagem";
import { lerFiltrosVeiculos, montarWhereVeiculos } from "@/lib/veiculo-listagem";
import { lerFiltrosColaboradores, montarWhereColaboradores } from "@/lib/colaborador-listagem";
import { ranquearSugestoes, type Sugestao } from "@/lib/listagem";
import { whereEstoque } from "@/lib/estoque/servidor";
import { formatarQtd } from "@/lib/estoque/regras";

/** Quantos candidatos o banco devolve antes de ranquear (os 5 melhores saem daqui) */
const CANDIDATOS = 50;

interface DefSugestao {
  /** Módulo da permissão "visualizar" */
  modulo: string;
  buscar: (empresaId: string, q: string) => Promise<Sugestao[]>;
}

const p = prisma as any;

export const SUGESTOES: Record<string, DefSugestao> = {
  clientes: {
    modulo: "clientes",
    buscar: async (empresaId, q) => (await p.cliente.findMany({
      where: whereClientes(empresaId, { busca: q }).where, select: { id: true, nome: true, nomeFantasia: true, cpfCnpj: true },
      orderBy: [{ nome: "asc" }, { id: "asc" }], take: CANDIDATOS,
    })).map((c: any) => ({ id: c.id, rotulo: c.nome, detalhe: c.cpfCnpj, href: `/clientes/${c.id}/editar` })),
  },
  ordens: {
    modulo: "ordens",
    buscar: async (empresaId, q) => (await p.ordemServico.findMany({
      where: whereOrdens(empresaId, { busca: q }), select: { id: true, numero: true, cliente: { select: { nome: true } } },
      orderBy: [{ criadoEm: "desc" }, { id: "asc" }], take: CANDIDATOS,
    })).map((o: any) => ({ id: o.id, rotulo: `OS ${o.numero}`, detalhe: o.cliente?.nome ?? null, href: `/ordens/${o.id}` })),
  },
  orcamentos: {
    modulo: "orcamentos",
    buscar: async (empresaId, q) => (await p.orcamento.findMany({
      where: whereOrcamentos(empresaId, { busca: q }), select: { id: true, codigo: true, nome: true, cliente: { select: { nome: true } } },
      orderBy: [{ criadoEm: "desc" }, { id: "asc" }], take: CANDIDATOS,
    })).map((o: any) => ({ id: o.id, rotulo: `${o.codigo} · ${o.nome}`, detalhe: o.cliente?.nome ?? null, href: `/orcamentos/${o.id}` })),
  },
  contratos: {
    modulo: "contratos",
    buscar: async (empresaId, q) => (await p.contrato.findMany({
      where: whereContratos(empresaId, { busca: q }), select: { id: true, numero: true, cliente: { select: { nome: true } } },
      orderBy: [{ criadoEm: "desc" }, { id: "asc" }], take: CANDIDATOS,
    })).map((c: any) => ({ id: c.id, rotulo: `Contrato ${c.numero}`, detalhe: c.cliente?.nome ?? null, href: `/contratos/${c.id}` })),
  },
  equipamentos: {
    modulo: "equipamentos",
    buscar: async (empresaId, q) => (await p.equipamento.findMany({
      where: montarWhere(empresaId, lerFiltros({ q })), select: { id: true, nome: true, marca: true, modelo: true, unidade: { select: { cliente: { select: { nome: true } } } } },
      orderBy: [{ nome: "asc" }, { id: "asc" }], take: CANDIDATOS,
    })).map((e: any) => ({ id: e.id, rotulo: e.nome || `${e.marca} ${e.modelo}`, detalhe: e.unidade?.cliente?.nome ?? null, href: `/equipamentos/${e.id}` })),
  },
  veiculos: {
    modulo: "veiculos",
    buscar: async (empresaId, q) => (await p.veiculo.findMany({
      where: montarWhereVeiculos(empresaId, lerFiltrosVeiculos({ q })), select: { id: true, placa: true, modelo: true, marca: true },
      orderBy: [{ placa: "asc" }, { id: "asc" }], take: CANDIDATOS,
    })).map((v: any) => ({ id: v.id, rotulo: v.placa, detalhe: [v.marca, v.modelo].filter(Boolean).join(" "), href: `/veiculos/${v.id}/editar` })),
  },
  colaboradores: {
    modulo: "equipes",
    buscar: async (empresaId, q) => (await p.tecnico.findMany({
      where: montarWhereColaboradores(empresaId, lerFiltrosColaboradores({ q })), select: { id: true, nome: true, cargo: { select: { nome: true } } },
      orderBy: [{ nome: "asc" }, { id: "asc" }], take: CANDIDATOS,
    })).map((t: any) => ({ id: t.id, rotulo: t.nome, detalhe: t.cargo?.nome ?? null, href: `/colaboradores/${t.id}/editar` })),
  },
  "pedidos-compra": {
    modulo: "compras",
    buscar: async (empresaId, q) => (await p.pedidoCompraInterno.findMany({
      where: wherePedidosCompra(empresaId, { q }), select: { id: true, numero: true, itens: { select: { descricao: true }, take: 2, orderBy: { id: "asc" } }, fornecedor: { select: { nome: true } } },
      orderBy: [{ criadoEm: "desc" }, { id: "asc" }], take: CANDIDATOS,
    })).map((x: any) => ({ id: x.id, rotulo: `${x.numero} · ${x.itens.map((i: any) => i.descricao).join(", ")}`, detalhe: x.fornecedor?.nome ?? null, href: `/compras/pedidos/${x.id}` })),
  },
  estoque: {
    modulo: "estoque",
    buscar: async (empresaId, q) => (await p.produto.findMany({
      where: whereEstoque(empresaId, { busca: q }), select: { id: true, nome: true, unidade: true, saldo: true },
      orderBy: [{ nome: "asc" }, { id: "asc" }], take: CANDIDATOS,
    })).map((x: any) => ({ id: x.id, rotulo: x.nome, detalhe: `saldo ${formatarQtd(Number(x.saldo))} ${x.unidade}`, href: `/estoque/${x.id}` })),
  },
  equipes: {
    modulo: "equipes",
    buscar: async (empresaId, q) => (await p.equipe.findMany({
      where: { empresaId, nome: { contains: q, mode: "insensitive" } }, select: { id: true, nome: true, status: true },
      orderBy: [{ nome: "asc" }, { id: "asc" }], take: CANDIDATOS,
    })).map((e: any) => ({ id: e.id, rotulo: e.nome, detalhe: e.status === "ATIVA" ? null : "inativa", href: `/equipes/${e.id}/editar` })),
  },
  // UX-4 (Y4): busca live de Medições (o where espelha a busca da lista)
  medicoes: {
    modulo: "financeiro",
    buscar: async (empresaId, q) => (await p.medicao.findMany({
      where: {
        empresaId,
        OR: [
          { numero: { contains: q, mode: "insensitive" } },
          { descricao: { contains: q, mode: "insensitive" } },
          { cliente: { nome: { contains: q, mode: "insensitive" } } },
        ],
      },
      select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } },
      orderBy: [{ criadoEm: "desc" }, { id: "asc" }], take: CANDIDATOS,
    })).map((m: any) => ({ id: m.id, rotulo: m.numero, detalhe: m.cliente?.nomeFantasia ?? m.cliente?.nome ?? null, href: `/financeiro/medicoes/${m.id}` })),
  },
};

export const ehListaSugestao = (v: string) => Object.prototype.hasOwnProperty.call(SUGESTOES, v);

export async function sugerir(lista: string, empresaId: string, q: string): Promise<Sugestao[]> {
  const termo = q.trim().slice(0, 100);
  if (termo.length < 2) return [];
  return ranquearSugestoes(await SUGESTOES[lista].buscar(empresaId, termo), termo);
}
