import type { Prisma } from "@prisma/client";
import { DIAS_AVISO_GARANTIA } from "@/lib/equipamento-garantia";
import { lerPaginacao, um, type ParamsUrl } from "@/lib/listagem";
export { TAMANHOS_PAGINA } from "@/lib/listagem";

/**
 * Filtros/ordenação da listagem de equipamentos, lidos da URL (server-side).
 * A URL é a fonte da verdade: filtros persistem ao recarregar, compartilhar link
 * ou voltar do perfil, e a busca/paginação rodam no banco (aguenta milhares).
 */

export type OrdemListagem = "nome" | "cliente" | "tipo" | "garantia" | "ultimo" | "instalacao";
export const ORDENS_VALIDAS: OrdemListagem[] = ["nome", "cliente", "tipo", "garantia", "ultimo", "instalacao"];

export interface FiltrosListagem {
  q: string;
  cliente: string;
  unidade: string;
  setor: string;
  tipos: string[];
  status: "ativo" | "inativo" | "todos";
  garantia: "" | "vigente" | "vencendo" | "vencida" | "sem";
  qr: "" | "com" | "sem";
  fluido: string;
  ordem: OrdemListagem;
  dir: "asc" | "desc";
  pagina: number;
  porPagina: number;
}

export function lerFiltros(sp: ParamsUrl): FiltrosListagem {
  const status = um(sp.status);
  const garantia = um(sp.garantia);
  const qr = um(sp.qr);
  const ordem = um(sp.ordem) as OrdemListagem;
  return {
    q: um(sp.q).trim(),
    cliente: um(sp.cliente),
    unidade: um(sp.unidade),
    setor: um(sp.setor),
    tipos: um(sp.tipos).split(",").filter(Boolean),
    // Padrão: só ativos (o dia a dia é sobre o parque em operação)
    status: status === "inativo" || status === "todos" ? status : "ativo",
    garantia: (["vigente", "vencendo", "vencida", "sem"] as const).find((g) => g === garantia) ?? "",
    qr: qr === "com" || qr === "sem" ? qr : "",
    fluido: um(sp.fluido),
    ordem: ORDENS_VALIDAS.includes(ordem) ? ordem : "nome",
    dir: um(sp.dir) === "desc" ? "desc" : "asc",
    ...lerPaginacao(sp),
  };
}

/** Filtro de garantia por data de fim (mesma regra de `situacaoGarantia`). */
function whereGarantia(g: FiltrosListagem["garantia"]): Prisma.EquipamentoWhereInput | null {
  if (!g) return null;
  const hoje = new Date();
  const limite = new Date(hoje.getTime() + DIAS_AVISO_GARANTIA * 86_400_000);
  if (g === "sem") return { garantiaAte: null };
  if (g === "vencida") return { garantiaAte: { lt: hoje } };
  if (g === "vencendo") return { garantiaAte: { gte: hoje, lte: limite } };
  return { garantiaAte: { gt: limite } };
}

/**
 * Monta o `where`. `ignorar` permite reaproveitar o escopo sem um filtro
 * (ex.: contadores de garantia calculados sem o próprio filtro de garantia).
 */
export function montarWhere(
  empresaId: string,
  f: FiltrosListagem,
  ignorar: Partial<Record<"garantia" | "status", boolean>> = {},
): Prisma.EquipamentoWhereInput {
  const and: Prisma.EquipamentoWhereInput[] = [{ empresaId }];

  if (!ignorar.status && f.status !== "todos") and.push({ ativo: f.status === "ativo" });
  if (f.cliente) and.push({ unidade: { clienteId: f.cliente } });
  if (f.unidade) and.push({ unidadeId: f.unidade });
  if (f.setor) and.push({ setor: { equals: f.setor, mode: "insensitive" } });
  if (f.tipos.length) and.push({ tipo: { in: f.tipos as any } });
  if (f.fluido) and.push({ fluido: f.fluido });
  if (f.qr === "com") and.push({ qrcode: { isNot: null } });
  if (f.qr === "sem") and.push({ qrcode: { is: null } });
  if (!ignorar.garantia) {
    const g = whereGarantia(f.garantia);
    if (g) and.push(g);
  }

  if (f.q) {
    const contem = { contains: f.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { nome: contem }, { modelo: contem }, { marca: contem },
        { numeroSerie: contem }, { patrimonio: contem },
        { setor: contem }, { localizacao: contem },
        { unidade: { nome: contem } },
        { unidade: { cliente: { nome: contem } } },
        { unidade: { cliente: { nomeFantasia: contem } } },
        { qrcode: { codigo: contem } },
      ],
    });
  }
  return { AND: and };
}

/** Ordenação no banco (o "último atendimento" é ordenado em memória — ver page.tsx). */
export function montarOrderBy(f: FiltrosListagem): Prisma.EquipamentoOrderByWithRelationInput[] {
  const d = f.dir;
  const fim: Prisma.EquipamentoOrderByWithRelationInput[] = [{ id: "asc" }];
  switch (f.ordem) {
    case "cliente":
      return [
        { unidade: { cliente: { nome: d } } }, { unidade: { nome: d } },
        { setor: { sort: d, nulls: "last" } }, { localizacao: { sort: d, nulls: "last" } }, ...fim,
      ];
    case "tipo":
      return [{ tipo: d }, { marca: "asc" }, ...fim];
    case "garantia":
      return [{ garantiaAte: { sort: d, nulls: "last" } }, ...fim];
    case "instalacao":
      return [{ dataInstalacao: { sort: d, nulls: "last" } }, ...fim];
    default:
      return [{ nome: { sort: d, nulls: "last" } }, { marca: d }, { modelo: d }, ...fim];
  }
}
