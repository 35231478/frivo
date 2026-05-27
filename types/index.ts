import type {
  Empresa,
  Usuario,
  Tecnico,
  Cliente,
  Equipamento,
  Contrato,
  ContratoUnidade,
  Unidade,
  OrdemServico,
  AtividadeOs,
} from "@prisma/client";

export type {
  Empresa,
  Usuario,
  Tecnico,
  Cliente,
  Equipamento,
  Contrato,
  ContratoUnidade,
  Unidade,
  OrdemServico,
  AtividadeOs,
};

export type OrdemServicoCompleta = OrdemServico & {
  cliente: Pick<Cliente, "id" | "nome" | "nomeFantasia">;
  contrato: Pick<Contrato, "id" | "numero"> | null;
  criadoPor: Pick<Usuario, "id" | "nome">;
  atividades: AtividadeOs[];
};

export type ClienteComContagens = Cliente & {
  _count: {
    unidades: number;
    contratos: number;
    ordensServico: number;
  };
};

export type EquipamentoComUnidade = Equipamento & {
  unidade: Unidade & {
    cliente: Pick<Cliente, "id" | "nome" | "nomeFantasia">;
  };
};

export type ContratoCompleto = Contrato & {
  cliente: Pick<Cliente, "id" | "nome" | "nomeFantasia">;
  unidades: Array<{ unidade: Unidade }>;
  responsavelTecnico: Pick<Tecnico, "id" | "nome" | "crea"> | null;
};

export interface SessaoUsuario {
  id: string;
  nome: string;
  email: string;
  empresaId: string;
  empresaNome: string;
  role: string;
}

export interface PaginacaoParams {
  pagina?: number;
  porPagina?: number;
  busca?: string;
  ordenarPor?: string;
  ordem?: "asc" | "desc";
}

export interface RespostaPaginada<T> {
  dados: T[];
  total: number;
  pagina: number;
  porPagina: number;
  totalPaginas: number;
}

export interface ResumosDashboard {
  totalClientes: number;
  totalEquipamentos: number;
  osAbertas: number;
  osHoje: number;
  contratosAtivos: number;
  tecnicosAtivos: number;
}
