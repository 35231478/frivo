import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lerPaginacao, um, type ParamsUrl } from "@/lib/listagem";

/**
 * Filtros/ordenação/indicadores da listagem de veículos, lidos da URL (server-side) —
 * mesmo modelo da listagem de equipamentos: a URL é a fonte da verdade e a busca,
 * os filtros e a paginação rodam no banco.
 */

export const DIAS_AVISO_VEICULO = 30;
export const TIPOS_VEICULO: Record<string, string> = { CARRO: "Carro", VAN: "Van", MOTO: "Moto", CAMINHAO: "Caminhão", OUTRO: "Outro" };

export type OrdemVeiculos = "placa" | "modelo" | "ano" | "revisao";
const ORDENS: OrdemVeiculos[] = ["placa", "modelo", "ano", "revisao"];

/** Avisos da frota (um por vez, como o filtro de garantia dos equipamentos). */
export type AvisoVeiculo = "" | "doc_vencido" | "doc_vencendo" | "revisao_vencida" | "revisao_proxima" | "sem_checklist";
const AVISOS: AvisoVeiculo[] = ["doc_vencido", "doc_vencendo", "revisao_vencida", "revisao_proxima", "sem_checklist"];

export interface FiltrosVeiculos {
  q: string;
  tipos: string[];
  /** "ativo" = em uso (Ativo + Em manutenção); inativos ficam escondidos por padrão. */
  status: "ativo" | "manutencao" | "inativo" | "todos";
  aviso: AvisoVeiculo;
  ordem: OrdemVeiculos;
  dir: "asc" | "desc";
  pagina: number;
  porPagina: number;
}

export function lerFiltrosVeiculos(sp: ParamsUrl): FiltrosVeiculos {
  const status = um(sp.status);
  const aviso = um(sp.aviso) as AvisoVeiculo;
  const ordem = um(sp.ordem) as OrdemVeiculos;
  return {
    q: um(sp.q).trim().slice(0, 80),
    tipos: um(sp.tipos).split(",").filter((t) => t in TIPOS_VEICULO),
    // Link antigo "?inativos=1" (lista anterior) continua mostrando todos
    status: status === "manutencao" || status === "inativo" || status === "todos" ? status : um(sp.inativos) === "1" ? "todos" : "ativo",
    aviso: AVISOS.includes(aviso) ? aviso : "",
    ordem: ORDENS.includes(ordem) ? ordem : "placa",
    dir: um(sp.dir) === "desc" ? "desc" : "asc",
    ...lerPaginacao(sp),
  };
}

/** Referências de data usadas nos avisos (mesma regra do sino de alertas: 30 dias). */
export function datasAviso(agora = new Date()) {
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const limite = new Date(inicioHoje.getTime() + (DIAS_AVISO_VEICULO + 1) * 86_400_000);
  return { inicioHoje, limite };
}

/** `where` de cada aviso. Documento = qualquer documento com vencimento OU o seguro. */
export function whereAviso(aviso: AvisoVeiculo, agora = new Date()): Prisma.VeiculoWhereInput | null {
  const { inicioHoje, limite } = datasAviso(agora);
  switch (aviso) {
    case "doc_vencido":
      return { OR: [{ documentos: { some: { dataVencimento: { lt: inicioHoje } } } }, { seguroVencimento: { lt: inicioHoje } }] };
    case "doc_vencendo":
      return { OR: [{ documentos: { some: { dataVencimento: { gte: inicioHoje, lt: limite } } } }, { seguroVencimento: { gte: inicioHoje, lt: limite } }] };
    case "revisao_vencida":
      // Pela data OU pela quilometragem já alcançada
      return { OR: [{ proximaRevisaoData: { lt: inicioHoje } }, { quilometragemAtual: { gte: prisma.veiculo.fields.proximaRevisaoKm } }] };
    case "revisao_proxima":
      return { proximaRevisaoData: { gte: inicioHoje, lt: limite } };
    case "sem_checklist":
      // Mesma regra do alerta "checklist pendente": veículo em uso sem checklist preenchido hoje
      return { status: { not: "INATIVO" }, checklists: { none: { criadoEm: { gte: inicioHoje } } } };
    default:
      return null;
  }
}

export function whereStatus(status: FiltrosVeiculos["status"]): Prisma.VeiculoWhereInput | null {
  if (status === "ativo") return { status: { not: "INATIVO" } };
  if (status === "manutencao") return { status: "MANUTENCAO" };
  if (status === "inativo") return { status: "INATIVO" };
  return null;
}

/** Busca: placa com/sem hífen, modelo, marca, renavam, chassi, responsável, equipe. */
function whereBusca(q: string): Prisma.VeiculoWhereInput | null {
  if (!q) return null;
  const contem = (v: string) => ({ contains: v, mode: "insensitive" as const });
  const placa = q.replace(/[^a-z0-9]/gi, "");
  const variantesPlaca = [...new Set([q, placa, placa.length > 3 ? `${placa.slice(0, 3)}-${placa.slice(3)}` : ""].filter(Boolean))];
  return {
    OR: [
      ...variantesPlaca.map((v) => ({ placa: contem(v) })),
      { modelo: contem(q) }, { marca: contem(q) }, { renavam: contem(q) }, { chassi: contem(q) },
      { responsavel: { nome: contem(q) } }, { equipe: { nome: contem(q) } },
    ],
  };
}

/** Monta o `where`. `ignorar` reaproveita o escopo sem um filtro (contadores dos chips). */
export function montarWhereVeiculos(
  empresaId: string, f: FiltrosVeiculos, ignorar: Partial<Record<"status" | "aviso", boolean>> = {},
): Prisma.VeiculoWhereInput {
  const and: Prisma.VeiculoWhereInput[] = [{ empresaId }];
  const st = ignorar.status ? null : whereStatus(f.status);
  if (st) and.push(st);
  if (f.tipos.length) and.push({ tipo: { in: f.tipos as any } });
  const av = ignorar.aviso ? null : whereAviso(f.aviso);
  if (av) and.push(av);
  const b = whereBusca(f.q);
  if (b) and.push(b);
  return { AND: and };
}

export function montarOrderByVeiculos(f: FiltrosVeiculos): Prisma.VeiculoOrderByWithRelationInput[] {
  const d = f.dir;
  const fim: Prisma.VeiculoOrderByWithRelationInput[] = [{ placa: "asc" }, { id: "asc" }];
  switch (f.ordem) {
    case "modelo":
      return [{ marca: { sort: d, nulls: "last" } }, { modelo: d }, ...fim];
    case "ano":
      return [{ ano: { sort: d, nulls: "last" } }, { anoModelo: { sort: d, nulls: "last" } }, ...fim];
    case "revisao":
      return [{ proximaRevisaoData: { sort: d, nulls: "last" } }, ...fim];
    default:
      return [{ placa: d }, { id: "asc" }];
  }
}
