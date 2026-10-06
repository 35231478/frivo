import type { Prisma } from "@prisma/client";
import { lerPaginacao, um, type ParamsUrl } from "@/lib/listagem";

/**
 * Filtros/ordenação/indicadores da listagem de colaboradores (server-side) — mesmo
 * modelo de Equipamentos e Veículos: URL = fonte da verdade; busca, filtros e
 * paginação rodam no banco.
 */

export const DIAS_AVISO_COLABORADOR = 30;
export const LABELS_FUNCAO: Record<string, string> = {
  TECNICO_CAMPO: "Técnico de campo",
  RESPONSAVEL_TECNICO: "Responsável técnico",
  ADMINISTRATIVO: "Administrativo",
  MOTORISTA: "Motorista",
  OUTRO: "Outro",
};
/** Funções que contam como "técnico" no indicador. */
export const FUNCOES_TECNICAS = ["TECNICO_CAMPO", "RESPONSAVEL_TECNICO"];

export type OrdemColaboradores = "nome" | "cargo" | "admissao";
const ORDENS: OrdemColaboradores[] = ["nome", "cargo", "admissao"];
export type AvisoColaborador = "" | "sem_equipe" | "ausente" | "doc_vencido" | "doc_vencendo" | "tecnicos";
const AVISOS: AvisoColaborador[] = ["sem_equipe", "ausente", "doc_vencido", "doc_vencendo", "tecnicos"];

export interface FiltrosColaboradores {
  q: string;
  status: "ativo" | "inativo" | "todos";
  funcoes: string[];
  cargo: string;
  equipe: string;
  aviso: AvisoColaborador;
  ordem: OrdemColaboradores;
  dir: "asc" | "desc";
  pagina: number;
  porPagina: number;
}

export function lerFiltrosColaboradores(sp: ParamsUrl): FiltrosColaboradores {
  const status = um(sp.status);
  const aviso = um(sp.aviso) as AvisoColaborador;
  const ordem = um(sp.ordem) as OrdemColaboradores;
  return {
    q: um(sp.q).trim().slice(0, 80) || um(sp.busca).trim().slice(0, 80), // "?busca=" era o parâmetro da lista anterior
    // Padrão: só ativos. Link antigo "?inativos=1" continua mostrando todos
    status: status === "inativo" || status === "todos" ? status : um(sp.inativos) === "1" ? "todos" : "ativo",
    funcoes: um(sp.funcoes).split(",").filter((t) => t in LABELS_FUNCAO),
    cargo: um(sp.cargo),
    equipe: um(sp.equipe),
    aviso: AVISOS.includes(aviso) ? aviso : "",
    ordem: ORDENS.includes(ordem) ? ordem : "nome",
    dir: um(sp.dir) === "desc" ? "desc" : "asc",
    ...lerPaginacao(sp),
  };
}

export function datasAvisoColaborador(agora = new Date()) {
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const limite = new Date(inicioHoje.getTime() + (DIAS_AVISO_COLABORADOR + 1) * 86_400_000);
  return { inicioHoje, limite };
}

/** Sem equipe = não é membro nem líder de nenhuma equipe ATIVA. */
export const WHERE_SEM_EQUIPE: Prisma.TecnicoWhereInput = {
  equipesMembro: { none: { status: "ATIVA" } },
  equipesLideradas: { none: { status: "ATIVA" } },
};

export function whereAvisoColaborador(aviso: AvisoColaborador, agora = new Date()): Prisma.TecnicoWhereInput | null {
  const { inicioHoje, limite } = datasAvisoColaborador(agora);
  switch (aviso) {
    case "sem_equipe": return WHERE_SEM_EQUIPE;
    case "ausente": return { statusColaborador: { in: ["FERIAS", "AFASTADO"] } };
    case "tecnicos": return { tipo: { in: FUNCOES_TECNICAS as any } };
    case "doc_vencido": return { documentos: { some: { dataVencimento: { lt: inicioHoje } } } };
    case "doc_vencendo": return { documentos: { some: { dataVencimento: { gte: inicioHoje, lt: limite } } } };
    default: return null;
  }
}

function whereBusca(q: string): Prisma.TecnicoWhereInput | null {
  if (!q) return null;
  const contem = { contains: q, mode: "insensitive" as const };
  const digitos = q.replace(/\D/g, "");
  return {
    OR: [
      { nome: contem }, { email: contem }, { cargo: { nome: contem } }, { crea: contem },
      { especialidades: { has: q } },
      ...(digitos.length >= 3 ? [{ cpf: { contains: digitos } }, { cpf: contem }, { telefone: { contains: digitos } }, { telefone: contem }] : []),
    ],
  };
}

export function montarWhereColaboradores(
  empresaId: string, f: FiltrosColaboradores, ignorar: Partial<Record<"status" | "aviso", boolean>> = {},
): Prisma.TecnicoWhereInput {
  const and: Prisma.TecnicoWhereInput[] = [{ empresaId }];
  if (!ignorar.status && f.status !== "todos") and.push({ ativo: f.status === "ativo" });
  if (f.funcoes.length) and.push({ tipo: { in: f.funcoes as any } });
  if (f.cargo) and.push({ cargoId: f.cargo });
  if (f.equipe) and.push({ OR: [{ equipesMembro: { some: { id: f.equipe } } }, { equipesLideradas: { some: { id: f.equipe } } }] });
  const av = ignorar.aviso ? null : whereAvisoColaborador(f.aviso);
  if (av) and.push(av);
  const b = whereBusca(f.q);
  if (b) and.push(b);
  return { AND: and };
}

export function montarOrderByColaboradores(f: FiltrosColaboradores): Prisma.TecnicoOrderByWithRelationInput[] {
  const d = f.dir;
  const fim: Prisma.TecnicoOrderByWithRelationInput[] = [{ nome: "asc" }, { id: "asc" }];
  if (f.ordem === "cargo") return [{ cargo: { nome: d } }, ...fim];
  if (f.ordem === "admissao") return [{ dataAdmissao: { sort: d, nulls: "last" } }, ...fim];
  return [{ nome: d }, { id: "asc" }];
}
