import { z } from "zod";
import {
  TipoServico, Prioridade, StatusOS,
  TipoEquipamento, TipoContrato, StatusContrato,
  Periodicidade, TipoPessoa, TipoTecnico,
  Segmento, OrigemCliente, StatusFinanceiro,
  TipoContato, TipoInteracao,
} from "@prisma/client";

const valorOpcional = z.preprocess(
  (v) =>
    v === "" || v === null || v === undefined || (typeof v === "number" && isNaN(v as number))
      ? undefined
      : Number(v),
  z.number().positive("Deve ser maior que zero").optional()
);

export const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  senha: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
});

export const contatoClienteSchema = z.object({
  nome: z.string().min(2, "Nome do contato é obrigatório"),
  cargo: z.string().optional(),
  tipo: z.nativeEnum(TipoContato).default(TipoContato.OUTRO),
  telefone: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z.string().email("E-mail inválido").optional().or(z.literal("")),
  principal: z.boolean().default(false),
});

export const interacaoClienteSchema = z.object({
  tipo: z.nativeEnum(TipoInteracao),
  descricao: z.string().min(3, "Descrição é obrigatória"),
});

export const clienteSchema = z.object({
  tipoPessoa: z.nativeEnum(TipoPessoa),
  nome: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  nomeFantasia: z.string().optional(),
  cpfCnpj: z.string().min(11, "CPF/CNPJ inválido"),
  inscricaoEstadual: z.string().optional(),
  segmento: z.nativeEnum(Segmento).optional().nullable(),
  origem: z.nativeEnum(OrigemCliente).optional().nullable(),
  statusFinanceiro: z.nativeEnum(StatusFinanceiro).default(StatusFinanceiro.ADIMPLENTE),
  satisfacao: z.number().min(1).max(5).optional().nullable(),
  email: z.string().email("E-mail inválido").optional().or(z.literal("")),
  telefone: z.string().optional(),
  celular: z.string().optional(),
  contato: z.string().optional(),
  artNumero: z.string().optional(),
  responsavelTecnicoId: z.string().optional(),
  endereco: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  cep: z.string().optional(),
  observacoes: z.string().optional(),
});

export const unidadeSchema = z.object({
  clienteId: z.string().min(1, "Cliente é obrigatório"),
  nome: z.string().min(1, "Nome da unidade é obrigatório"),
  principal: z.boolean().default(false),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  cep: z.string().optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  telefone: z.string().optional(),
  observacoes: z.string().optional(),
});

export const equipamentoSchema = z.object({
  unidadeId: z.string().min(1, "Unidade é obrigatória"),
  tipo: z.nativeEnum(TipoEquipamento),
  marca: z.string().min(1, "Marca é obrigatória"),
  modelo: z.string().min(1, "Modelo é obrigatório"),
  numeroSerie: z.string().optional(),
  patrimonio: z.string().optional(),
  capacidade: z.string().optional(),
  fluido: z.string().optional(),
  tensao: z.string().optional(),
  localizacao: z.string().optional(),
  dataInstalacao: z.string().optional(),
  dataFabricacao: z.string().optional(),
  garantiaAte: z.string().optional(),
  observacoes: z.string().optional(),
});

export const contratoSchema = z.object({
  clienteId: z.string().min(1, "Cliente é obrigatório"),
  numero: z.string().min(1, "Número é obrigatório"),
  tipo: z.nativeEnum(TipoContrato),
  status: z.nativeEnum(StatusContrato).default(StatusContrato.ATIVO),
  periodicidade: z.nativeEnum(Periodicidade).default(Periodicidade.MENSAL),
  valorMensal: valorOpcional,
  valorTotal: valorOpcional,
  dataInicio: z.string().min(1, "Data de início é obrigatória"),
  dataFim: z.string().optional(),
  diaVencimento: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().min(1).max(31).optional()
  ),
  artNumero: z.string().optional(),
  responsavelTecnicoId: z.string().optional(),
  observacoes: z.string().optional(),
  unidadeIds: z.array(z.string()).default([]),
});

export const ordemServicoSchema = z.object({
  clienteId: z.string().min(1, "Cliente é obrigatório"),
  equipamentoId: z.string().optional(),
  contratoId: z.string().optional(),
  tecnicoId: z.string().optional(),
  tipo: z.nativeEnum(TipoServico),
  prioridade: z.nativeEnum(Prioridade),
  status: z.nativeEnum(StatusOS).optional(),
  descricao: z.string().min(10, "Descrição deve ter pelo menos 10 caracteres"),
  diagnostico: z.string().optional(),
  solucao: z.string().optional(),
  pecasUtilizadas: z.string().optional(),
  dataAgendada: z.string().optional(),
  valorServico: valorOpcional,
  valorPecas: valorOpcional,
  observacoes: z.string().optional(),
});

export const tecnicoSchema = z.object({
  nome: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  cpf: z.string().min(11, "CPF inválido"),
  email: z.string().email("E-mail inválido").optional().or(z.literal("")),
  telefone: z.string().min(8, "Telefone inválido"),
  celular: z.string().optional(),
  tipo: z.nativeEnum(TipoTecnico).default(TipoTecnico.TECNICO_CAMPO),
  crea: z.string().optional(),
  especialidades: z.array(z.string()).default([]),
  observacoes: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ClienteInput = z.infer<typeof clienteSchema>;
export type UnidadeInput = z.infer<typeof unidadeSchema>;
export type EquipamentoInput = z.infer<typeof equipamentoSchema>;
export type ContratoInput = z.infer<typeof contratoSchema>;
export type OrdemServicoInput = z.infer<typeof ordemServicoSchema>;
export type TecnicoInput = z.infer<typeof tecnicoSchema>;
