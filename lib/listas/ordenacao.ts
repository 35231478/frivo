/**
 * Ordenação das listas renderizadas no servidor: LISTA BRANCA coluna → orderBy (o resto da URL é
 * ignorado). `ordemPrisma` (lib/listagem.ts) acrescenta o `id` de desempate.
 */
import type { MapaOrdem } from "@/lib/listagem";

export const ORDEM_CLIENTES: MapaOrdem = {
  nome: (d) => ({ nome: d }),
  documento: (d) => ({ cpfCnpj: d }),
  segmento: (d) => ({ segmento: { sort: d, nulls: "last" } }),
  unidades: (d) => ({ unidades: { _count: d } }),
  os: (d) => ({ ordensServico: { _count: d } }),
};
export const ORDEM_PADRAO_CLIENTES = [{ nome: "asc" }];

export const ORDEM_ORCAMENTOS: MapaOrdem = {
  codigo: (d) => ({ codigo: d }),
  nome: (d) => ({ nome: d }),
  cliente: (d) => ({ cliente: { nome: d } }),
  valor: (d) => ({ totalGeral: d }),
  status: (d) => ({ status: d }),
  criado: (d) => ({ criadoEm: d }),
};
export const ORDEM_PADRAO_ORCAMENTOS = [{ criadoEm: "desc" }];

export const ORDEM_EQUIPES: MapaOrdem = {
  nome: (d) => ({ nome: d }),
  membros: (d) => ({ membros: { _count: d } }),
};
export const ORDEM_COLABORADORES_EQUIPE: MapaOrdem = {
  nome: (d) => ({ nome: d }),
  cargo: (d) => ({ cargo: { nome: d } }),
};

export const ORDEM_PMOC: MapaOrdem = {
  nome: (d) => ({ nome: d }),
  cliente: (d) => ({ cliente: { nome: d } }),
  local: (d) => ({ unidade: { nome: d } }),
  equipamentos: (d) => ({ equipamentos: { _count: d } }),
  validade: (d) => ({ dataExpiracao: d }),
};
/** Inativados no fim; depois o que vence primeiro. */
export const ORDEM_PADRAO_PMOC = [{ ativo: "desc" }, { dataExpiracao: "asc" }];
