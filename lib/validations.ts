import { z } from "zod";
import {
  TipoServico, Prioridade, StatusOS,
  TipoEquipamento, TipoContrato, StatusContrato,
  Periodicidade, TipoPessoa, TipoTecnico,
  Segmento, OrigemCliente, StatusFinanceiro,
  TipoContato, TipoInteracao,
  TipoDesconto, TipoOrcamento,
  PerfilFaturamento, TipoMedicao, TipoItemMedicao,
  StatusMedicaoFin, StatusContaReceber, FormaPagamento,
  ResponsavelPrazo, CanalNotificacao, StatusPedidoCompra,
  TipoTabelaPreco, TipoPrecoTabela,
  TratamentoFimSemana, TipoRelatorio,
  TipoVencimento, IndiceReajuste, PeriodoRefNFSe, PeriodoVisita,
  StatusColaborador, TipoVeiculo, StatusVeiculo, StatusEquipe,
  TipoManutencaoVeiculo, TipoDocumentoVeiculo, FrequenciaChecklist, TipoItemChecklist,
} from "@prisma/client";

const valorOpcional = z.preprocess(
  (v) =>
    v === "" || v === null || v === undefined || (typeof v === "number" && isNaN(v as number))
      ? undefined
      : Number(v),
  z.number().positive("Deve ser maior que zero").optional()
);

// decimal opcional aceitando 0 (alíquotas, percentuais) — vazio vira null
const decimalOpcional = z.preprocess(
  (v) =>
    v === "" || v === null || v === undefined || (typeof v === "number" && isNaN(v as number))
      ? null
      : Number(v),
  z.number().nonnegative("Não pode ser negativo").nullable()
);

export const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  senha: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
});

// Login do Portal do Cliente (contatos)
export const portalLoginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  senha: z.string().min(1, "Senha é obrigatória"),
});

// Concessão/edição de acesso ao portal para um contato
export const acessoPortalSchema = z.object({
  email: z.string().email("E-mail inválido"),
  senha: z.string().optional(), // se vazio, mantém a senha atual
  ativo: z.boolean().default(true),
  permissoes: z.object({
    verOS: z.boolean().default(false),
    abrirChamados: z.boolean().default(false),
    verDocumentos: z.boolean().default(false),
    verEquipamentos: z.boolean().default(false),
    verFinanceiro: z.boolean().default(false),
    verBoletos: z.boolean().default(false),
    aprovarMedicoes: z.boolean().default(false),
    verValores: z.boolean().default(false),
  }).default({}),
});

// Abertura de chamado pelo portal
export const chamadoPortalSchema = z.object({
  unidadeId: z.string().optional().nullable(),
  equipamentoId: z.string().optional().nullable(),
  tipoProblema: z.string().optional().nullable(),
  descricao: z.string().min(5, "Descreva o problema (mín. 5 caracteres)"),
  urgencia: z.enum(["NORMAL", "URGENTE", "CRITICO"]).default("NORMAL"),
  fotos: z.array(z.object({
    nome: z.string(),
    tipo: z.string(),
    tamanho: z.number(),
    conteudo: z.string(),
  })).default([]),
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
  ativo: z.boolean().default(true),
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
  // Perfil de faturamento
  tipoFaturamento: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.nativeEnum(PerfilFaturamento).nullable()
  ).default(null),
  diaFaturamento: z.preprocess(
    (v) => (v === "" || v == null ? 1 : Number(v)),
    z.number().min(1).max(28)
  ).default(1),
  condicaoPagamento: z.string().optional().nullable(),
  exigePcAntesNf: z.boolean().default(false),
  agrupaAdicionais: z.boolean().default(false),
  boletoUnicoMensal: z.boolean().default(false),
  emailsFaturamento: z.array(z.string()).default([]),
  whatsappFaturamento: z.string().optional().nullable(),
  // Preferências de e-mail
  emailReceberBoletos: z.boolean().default(true),
  emailReceberRelatorios: z.boolean().default(true),
  emailReceberLembretes: z.boolean().default(true),
  emailReceberConfirmacoes: z.boolean().default(true),
  emailReceberOrcamentos: z.boolean().default(true),
  emailReceberOs: z.boolean().default(true),
  emailsCopia: z.array(z.string()).default([]),
  tabelaPrecoId: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.string().nullable()
  ).default(null),
  portalAtivo: z.boolean().default(false),
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
  nome: z.string().optional(),
  marca: z.string().min(1, "Marca é obrigatória"),
  modelo: z.string().min(1, "Modelo é obrigatório"),
  numeroSerie: z.string().optional(),
  patrimonio: z.string().optional(),
  anoFabricacao: z.string().optional(),
  capacidade: z.string().optional(),
  fluido: z.string().optional(),
  tensao: z.string().optional(),
  potencia: z.string().optional(),
  fase: z.string().optional(),
  correnteNominal: z.string().optional(),
  localizacao: z.string().optional(),
  dataInstalacao: z.string().optional(),
  dataFabricacao: z.string().optional(),
  garantiaAte: z.string().optional(),
  observacoes: z.string().optional(),
  observacoesTecnicas: z.string().optional(),
  fotos: z.array(z.string()).max(5, "Máximo de 5 imagens").optional(),
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
  // Recorrência de OS
  recorrencia: z.boolean().default(false),
  frequenciaRecorrencia: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.nativeEnum(Periodicidade).nullable()
  ).default(null),
  diaRecorrencia: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().min(1).max(28).nullable()
  ).default(null),
  fimSemanaRecorrencia: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.nativeEnum(TratamentoFimSemana).nullable()
  ).default(null),
  tipoOsRecorrenciaId: z.string().optional().nullable(),
  tecnicoRecorrenciaId: z.string().optional().nullable(),

  // Recorrência de OS por local coberto
  recorrenciasLocais: z.array(z.object({
    unidadeId: z.string(),
    ativa: z.boolean().default(false),
    frequencia: z.preprocess((v) => (v === "" || v == null ? null : v), z.nativeEnum(Periodicidade).nullable()).default(null),
    tipoOsId: z.string().optional().nullable(),
    tecnicoId: z.string().optional().nullable(),
    dataPrimeiraOs: z.string().optional().nullable(),
  })).default([]),

  // Faturamento / NFS-e
  diaFaturamento: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(1).max(28).nullable()).default(null),
  tipoVencimento: z.preprocess((v) => (v === "" || v == null ? null : v), z.nativeEnum(TipoVencimento).nullable()).default(null),
  diasAposVencimento: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).max(365).nullable()).default(null),
  diaFixoMes: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(1).max(31).nullable()).default(null),
  ajusteFinsDeSemana: z.preprocess((v) => (v === "" || v == null ? null : v), z.nativeEnum(TratamentoFimSemana).nullable()).default(null),
  descricaoNFSe: z.string().optional().nullable(),
  servicosNFSeIds: z.array(z.string()).default([]),
  adicionarPeriodoRef: z.boolean().default(false),
  periodoRefOpcao: z.preprocess((v) => (v === "" || v == null ? null : v), z.nativeEnum(PeriodoRefNFSe).nullable()).default(null),
  adicionarNumContrato: z.boolean().default(false),
  adicionarVencimentoNFSe: z.boolean().default(false),

  // Escopo
  descricaoServicos: z.string().optional().nullable(),
  itensInclusos: z.record(z.any()).optional().nullable(),
  qtdVisitas: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).nullable()).default(null),
  periodoVisitas: z.preprocess((v) => (v === "" || v == null ? null : v), z.nativeEnum(PeriodoVisita).nullable()).default(null),

  // Responsabilidade técnica
  artVencimento: z.string().optional().nullable(),
  exibirRTNFSe: z.boolean().default(false),
  exibirRTPDF: z.boolean().default(false),

  // Reajuste
  reajusteAtivo: z.boolean().default(false),
  reajusteIndice: z.preprocess((v) => (v === "" || v == null ? null : v), z.nativeEnum(IndiceReajuste).nullable()).default(null),
  reajustePercentual: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).nullable()).default(null),
  reajusteMesAniversario: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(1).max(12).nullable()).default(null),
  reajusteNotificar: z.boolean().default(false),
  reajusteNotificarDias: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).nullable()).default(null),

  // Alertas e renovação
  alertaDias: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).nullable()).default(30),
  renovacaoAutomatica: z.boolean().default(false),
  renovacaoMeses: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(1).nullable()).default(null),
  notificarClienteRenovacao: z.boolean().default(false),
  notificarClienteDias: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).nullable()).default(null),
  alertaEmailCliente: z.boolean().default(false),
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

const documentoColaboradorSchema = z.object({
  tipo: z.string().min(1),
  nome: z.string().min(1),
  arquivoUrl: z.string().optional().nullable(),
  dataVencimento: z.string().optional().nullable(),
});

// Colaborador (antigo "Técnico") — cadastro completo em abas
export const tecnicoSchema = z.object({
  // Dados pessoais
  nome: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  cpf: z.string().min(11, "CPF inválido"),
  rg: z.string().optional(),
  dataNascimento: z.string().optional().nullable(),
  email: z.string().email("E-mail inválido").optional().or(z.literal("")),
  telefone: z.string().min(8, "Telefone inválido"),
  celular: z.string().optional(),
  whatsapp: z.string().optional(),
  avatar: z.string().optional(),
  endereco: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  cep: z.string().optional(),
  // Dados profissionais
  cargoId: z.string().optional().nullable(),
  perfilAcessoId: z.string().optional().nullable(),
  tipoEquipe: z.enum(["CAMPO", "ADMINISTRATIVO"]).default("CAMPO"),
  tipo: z.nativeEnum(TipoTecnico).default(TipoTecnico.TECNICO_CAMPO),
  crea: z.string().optional(),
  dataAdmissao: z.string().optional().nullable(),
  salario: decimalOpcional.optional(),
  jornadaEntrada: z.string().optional(),
  jornadaSaida: z.string().optional(),
  jornadaDias: z.array(z.string()).default([]),
  statusColaborador: z.nativeEnum(StatusColaborador).default(StatusColaborador.ATIVO),
  // Competências e especialidades
  competenciaIds: z.array(z.string()).default([]),
  especialidades: z.array(z.string()).default([]),
  // Documentos
  documentos: z.array(documentoColaboradorSchema).default([]),
  observacoes: z.string().optional(),
});

// ─────────────────────────────────────────────
// VEÍCULOS
// ─────────────────────────────────────────────

export const veiculoSchema = z.object({
  fotos: z.array(z.string()).max(5, "Máximo de 5 fotos").default([]),
  placa: z.string().min(1, "Placa é obrigatória"),
  modelo: z.string().min(1, "Modelo é obrigatório"),
  marca: z.string().optional(),
  ano: z.string().optional(),
  cor: z.string().optional(),
  tipo: z.nativeEnum(TipoVeiculo).default(TipoVeiculo.CARRO),
  chassi: z.string().optional(),
  renavam: z.string().optional(),
  quilometragemAtual: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nonnegative().nullable()).optional(),
  proximaRevisaoKm: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nonnegative().nullable()).optional(),
  proximaRevisaoData: z.string().optional().nullable(),
  seguroVencimento: z.string().optional().nullable(),
  status: z.nativeEnum(StatusVeiculo).default(StatusVeiculo.ATIVO),
  responsavelId: z.string().optional().nullable(),
  equipeId: z.string().optional().nullable(),
  observacoes: z.string().optional(),
  documentos: z.array(z.object({
    tipo: z.nativeEnum(TipoDocumentoVeiculo).default(TipoDocumentoVeiculo.OUTRO),
    nome: z.string().min(1),
    arquivoUrl: z.string().optional().nullable(),
    dataVencimento: z.string().optional().nullable(),
  })).default([]),
});

export const veiculoManutencaoSchema = z.object({
  tipo: z.nativeEnum(TipoManutencaoVeiculo).default(TipoManutencaoVeiculo.PREVENTIVA),
  descricao: z.string().min(1, "Descrição é obrigatória"),
  quilometragem: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nonnegative().nullable()).optional(),
  custo: decimalOpcional.optional(),
  dataRealizacao: z.string().min(1, "Data é obrigatória"),
  proximaData: z.string().optional().nullable(),
  proximaKm: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nonnegative().nullable()).optional(),
  anexoUrl: z.string().optional().nullable(),
});

// ─────────────────────────────────────────────
// EQUIPES
// ─────────────────────────────────────────────

export const equipeSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório"),
  cor: z.string().default("#0EA5E9"),
  liderId: z.string().optional().nullable(),
  membroIds: z.array(z.string()).default([]),
  veiculoId: z.string().optional().nullable(),
  status: z.nativeEnum(StatusEquipe).default(StatusEquipe.ATIVA),
  observacoes: z.string().optional(),
});

// ─────────────────────────────────────────────
// CHECKLIST DE VEÍCULO
// ─────────────────────────────────────────────

export const checklistTemplateSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório"),
  descricao: z.string().optional(),
  frequencia: z.nativeEnum(FrequenciaChecklist).default(FrequenciaChecklist.DIARIO),
  ativo: z.boolean().default(true),
  itens: z.array(z.object({
    categoria: z.string().min(1),
    descricao: z.string().min(1),
    tipo: z.nativeEnum(TipoItemChecklist).default(TipoItemChecklist.OK_NOK),
    opcoes: z.array(z.string()).default([]),
    obrigatorio: z.boolean().default(true),
    ordem: z.number().int().default(0),
  })).default([]),
});

export const checklistPreenchidoSchema = z.object({
  veiculoId: z.string().min(1, "Veículo é obrigatório"),
  templateId: z.string().min(1, "Template é obrigatório"),
  observacaoGeral: z.string().optional(),
  itens: z.array(z.object({
    itemTemplateId: z.string().min(1),
    valor: z.string().optional().nullable(),
    foto: z.string().optional().nullable(),
    alerta: z.boolean().default(false),
  })).default([]),
});

// ─────────────────────────────────────────────
// ORÇAMENTO
// ─────────────────────────────────────────────

export const orcamentoItemSchema = z.object({
  catalogoId: z.string().optional().nullable(),
  descricao: z.string().min(1, "Descrição é obrigatória"),
  quantidade: z.preprocess(
    (v) => (v === "" || v == null ? 1 : Number(v)),
    z.number().positive("Quantidade deve ser > 0")
  ),
  valorUnitario: z.preprocess(
    (v) => (v === "" || v == null ? 0 : Number(v)),
    z.number().nonnegative("Valor não pode ser negativo")
  ),
  observacao: z.string().optional().nullable(),
});

const intOpcional = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().min(min).max(max).nullable()
  ).default(null);

export const orcamentoSchema = z.object({
  nome: z.string().min(2, "Nome do orçamento é obrigatório"),
  clienteId: z.string().min(1, "Cliente é obrigatório"),
  tipo: z.nativeEnum(TipoOrcamento).default(TipoOrcamento.COMUM),
  descricao: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
  validadeEm: z.string().optional().nullable(),
  desconto: z.preprocess(
    (v) => (v === "" || v == null ? 0 : Number(v)),
    z.number().nonnegative("Desconto não pode ser negativo")
  ).default(0),
  tipoDesconto: z.nativeEnum(TipoDesconto).default(TipoDesconto.VALOR),
  servicos: z.array(orcamentoItemSchema).default([]),
  produtos: z.array(orcamentoItemSchema).default([]),
  ordensServicoIds: z.array(z.string()).default([]),

  // Proposta de contrato
  valorMensal: decimalOpcional,
  frequenciaContrato: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.nativeEnum(Periodicidade).nullable()
  ).default(null),
  diaExecucao: intOpcional(1, 31),
  dataInicioContrato: z.string().optional().nullable(),
  vigenciaMeses: intOpcional(1, 120),
  condicaoPagamento: z.string().optional().nullable(),
  diaFaturamento: intOpcional(1, 28),
  perfilFaturamento: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.nativeEnum(PerfilFaturamento).nullable()
  ).default(null),
  exigePcAntesNf: z.boolean().default(false),
  responsavelTecnicoId: z.string().optional().nullable(),
  artNumero: z.string().optional().nullable(),
  termoReferencia: z.string().optional().nullable(),
  visitasPorPeriodo: intOpcional(1, 999),
  equipamentosCobertos: z.array(z.string()).default([]),
  prazoEmergencial: intOpcional(0, 100000),
  prazoNormal: intOpcional(0, 100000),
  horarioAtendimento: z.string().optional().nullable(),
});

export const termoTemplateSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório"),
  descricao: z.string().optional().nullable(),
  conteudo: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
});

export const aprovacaoPublicaSchema = z.object({
  nome: z.string().min(3, "Nome completo é obrigatório"),
  cpf: z.string().refine(
    (v) => v.replace(/\D/g, "").length === 11,
    "CPF inválido"
  ),
  assinaturaUrl: z.string().min(20, "Assinatura é obrigatória")
    .refine((v) => v.startsWith("data:image/"), "Assinatura inválida"),
});

// ─────────────────────────────────────────────
// MEDIÇÃO / FINANCEIRO
// ─────────────────────────────────────────────

export const medicaoItemSchema = z.object({
  tipo: z.nativeEnum(TipoItemMedicao).default(TipoItemMedicao.SERVICO),
  servicoId: z.string().optional().nullable(),
  produtoId: z.string().optional().nullable(),
  ordemServicoId: z.string().optional().nullable(),
  orcamentoId: z.string().optional().nullable(),
  descricao: z.string().min(1, "Descrição é obrigatória"),
  quantidade: z.preprocess(
    (v) => (v === "" || v == null ? 1 : Number(v)),
    z.number().positive("Quantidade deve ser > 0")
  ),
  valorUnitario: z.preprocess(
    (v) => (v === "" || v == null ? 0 : Number(v)),
    z.number().nonnegative("Valor não pode ser negativo")
  ),
  codigoMunicipal: z.string().optional().nullable(),
  aliquotaISS: decimalOpcional.optional(),
  aliquotaPIS: decimalOpcional.optional(),
  aliquotaCOFINS: decimalOpcional.optional(),
  aliquotaCSLL: decimalOpcional.optional(),
  aliquotaIR: decimalOpcional.optional(),
  observacao: z.string().optional().nullable(),
});

export const medicaoSchema = z.object({
  clienteId: z.string().min(1, "Cliente é obrigatório"),
  contratoId: z.string().optional().nullable(),
  tipo: z.nativeEnum(TipoMedicao).default(TipoMedicao.MENSAL_FIXO),
  mes: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().min(1).max(12).nullable()
  ).optional(),
  ano: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().min(2000).max(2100).nullable()
  ).optional(),
  descricao: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
  descontoValor: z.preprocess(
    (v) => (v === "" || v == null ? 0 : Number(v)),
    z.number().nonnegative()
  ).default(0),
  descontoPercent: z.preprocess(
    (v) => (v === "" || v == null ? 0 : Number(v)),
    z.number().nonnegative().max(100)
  ).default(0),
  itens: z.array(medicaoItemSchema).default([]),
});

export const aprovacaoMedicaoSchema = aprovacaoPublicaSchema;

export const acaoMedicaoSchema = z.object({
  acao: z.enum([
    "ENVIAR", "APROVAR_MANUAL", "REGISTRAR_PC", "REGISTRAR_NF",
    "REGISTRAR_BOLETO", "REGISTRAR_PAGAMENTO", "CANCELAR",
  ]),
  // Campos contextuais conforme a ação
  pcNumero: z.string().optional().nullable(),
  pcAnexoUrl: z.string().optional().nullable(),
  nfNumero: z.string().optional().nullable(),
  nfUrl: z.string().optional().nullable(),
  boletoUrl: z.string().optional().nullable(),
  boletoCodigoBarras: z.string().optional().nullable(),
  dataPagamento: z.string().optional().nullable(),
  formaPagamento: z.nativeEnum(FormaPagamento).optional().nullable(),
  valorPago: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().nonnegative().nullable()
  ).optional(),
});

export const contaReceberUpdateSchema = z.object({
  status: z.nativeEnum(StatusContaReceber).optional(),
  descricao: z.string().optional(),
  categoria: z.string().optional().nullable(),
  valor: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().positive()).optional(),
  dataVencimento: z.string().optional().nullable(),
  dataRecebimento: z.string().optional().nullable(),
  formaPagamento: z.nativeEnum(FormaPagamento).optional().nullable(),
  banco: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
});

// ─────────────────────────────────────────────
// CONTAS A PAGAR
// ─────────────────────────────────────────────

const valorObrigatorio = z.preprocess(
  (v) => (v === "" || v == null ? undefined : Number(v)),
  z.number().positive("Valor deve ser maior que zero"),
);

export const contaPagarSchema = z.object({
  fornecedor: z.string().min(1, "Fornecedor é obrigatório"),
  fornecedorCnpj: z.string().optional().nullable(),
  descricao: z.string().min(1, "Descrição é obrigatória"),
  valorTotal: valorObrigatorio,
  dataVencimento: z.string().optional().nullable(),
  formaPagamento: z.nativeEnum(FormaPagamento).optional().nullable(),
  banco: z.string().optional().nullable(),
  pedidoCompraId: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
});

export const contaPagarUpdateSchema = contaPagarSchema.partial();

export const pagamentoContaPagarSchema = z.object({
  valor: valorObrigatorio,
  dataPagamento: z.string().min(1, "Data é obrigatória"),
  formaPagamento: z.nativeEnum(FormaPagamento).optional().nullable(),
  banco: z.string().optional().nullable(),
  comprovante: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ClienteInput = z.infer<typeof clienteSchema>;
export type UnidadeInput = z.infer<typeof unidadeSchema>;
export type EquipamentoInput = z.infer<typeof equipamentoSchema>;
export type ContratoInput = z.infer<typeof contratoSchema>;
export type OrdemServicoInput = z.infer<typeof ordemServicoSchema>;
export type TecnicoInput = z.infer<typeof tecnicoSchema>;
export type OrcamentoItemInput = z.infer<typeof orcamentoItemSchema>;
export type OrcamentoInput = z.infer<typeof orcamentoSchema>;
export type AprovacaoPublicaInput = z.infer<typeof aprovacaoPublicaSchema>;
export type MedicaoItemInput = z.infer<typeof medicaoItemSchema>;
export type MedicaoInput = z.infer<typeof medicaoSchema>;
export type AcaoMedicaoInput = z.infer<typeof acaoMedicaoSchema>;
export type ContaReceberUpdateInput = z.infer<typeof contaReceberUpdateSchema>;

// ─────────────────────────────────────────────
// PRAZOS / SLA E COMPRAS
// ─────────────────────────────────────────────

export const prazoEtapaTemplateSchema = z.object({
  nome: z.string().min(1, "Nome da etapa é obrigatório"),
  prazoHoras: z.preprocess(
    (v) => (v === "" || v == null ? 24 : Number(v)),
    z.number().positive("Prazo deve ser > 0")
  ),
  responsavel: z.nativeEnum(ResponsavelPrazo).default(ResponsavelPrazo.COMPRADOR),
  canal: z.nativeEnum(CanalNotificacao).default(CanalNotificacao.WHATSAPP),
  mensagem: z.string().optional().nullable(),
  ordem: z.number().default(0),
});

export const prazoTemplateSchema = z.object({
  nome: z.string().min(2, "Nome do template é obrigatório"),
  descricao: z.string().optional().nullable(),
  cor: z.string().default("#0EA5E9"),
  ativo: z.boolean().default(true),
  etapas: z.array(prazoEtapaTemplateSchema).default([]),
});

export const pedidoCompraItemSchema = z.object({
  produtoId: z.string().optional().nullable(),
  descricao: z.string().min(1, "Descrição é obrigatória"),
  quantidade: z.preprocess(
    (v) => (v === "" || v == null ? 1 : Number(v)),
    z.number().positive("Quantidade deve ser > 0")
  ),
  unidade: z.string().default("un"),
  valorEstimado: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().nonnegative().nullable()
  ).optional(),
  fornecedor: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
});

export const pedidoCompraSchema = z.object({
  ordemServicoId: z.string().optional().nullable(),
  orcamentoId: z.string().optional().nullable(),
  compradorId: z.string().optional().nullable(),
  prazoNecessario: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
  itens: z.array(pedidoCompraItemSchema).min(1, "Adicione ao menos um item"),
});

export const pedidoCompraStatusSchema = z.object({
  status: z.nativeEnum(StatusPedidoCompra),
});

export const pedidoCompraItemUpdateSchema = z.object({
  valorReal: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().nonnegative().nullable()
  ).optional(),
  fornecedor: z.string().optional().nullable(),
});

export const osPrazoSchema = z.object({
  templateId: z.string().min(1, "Selecione um template de prazo"),
  nome: z.string().optional().nullable(),
});

// ─────────────────────────────────────────────
// TABELAS DE PREÇOS
// ─────────────────────────────────────────────

export const tabelaPrecoItemSchema = z.object({
  servicoId: z.string().optional().nullable(),
  produtoId: z.string().optional().nullable(),
  tipoPreco: z.nativeEnum(TipoPrecoTabela).default(TipoPrecoTabela.VALOR_FIXO),
  valorFixo: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().nonnegative().nullable()
  ).optional(),
  descontoPercent: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().nonnegative().max(100).nullable()
  ).optional(),
  bloqueado: z.boolean().default(false),
}).refine((it) => it.servicoId || it.produtoId, { message: "Selecione um serviço ou produto" });

export const tabelaPrecoSchema = z.object({
  nome: z.string().min(2, "Nome da tabela é obrigatório"),
  descricao: z.string().optional().nullable(),
  tipo: z.nativeEnum(TipoTabelaPreco).default(TipoTabelaPreco.PERSONALIZADA),
  precosBloqueados: z.boolean().default(false),
  ativo: z.boolean().default(true),
  itens: z.array(tabelaPrecoItemSchema).default([]),
});

export type TabelaPrecoInput = z.infer<typeof tabelaPrecoSchema>;
export type TabelaPrecoItemInput = z.infer<typeof tabelaPrecoItemSchema>;

// ─────────────────────────────────────────────
// RELATÓRIO DE OS
// ─────────────────────────────────────────────

export const relatorioSchema = z.object({
  tipo: z.nativeEnum(TipoRelatorio).default(TipoRelatorio.PMOC),
  mesReferencia: z.preprocess(
    (v) => (v === "" || v == null ? new Date().getMonth() + 1 : Number(v)),
    z.number().min(1).max(12)
  ),
  anoReferencia: z.preprocess(
    (v) => (v === "" || v == null ? new Date().getFullYear() : Number(v)),
    z.number().min(2000).max(2100)
  ),
  valorFinanceiro: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().nonnegative().nullable()
  ).optional(),
  observacao: z.string().optional().nullable(),
});

export const aprovacaoRelatorioSchema = aprovacaoPublicaSchema;

export type RelatorioInput = z.infer<typeof relatorioSchema>;

export type PrazoTemplateInput = z.infer<typeof prazoTemplateSchema>;
export type PrazoEtapaTemplateInput = z.infer<typeof prazoEtapaTemplateSchema>;
export type PedidoCompraInput = z.infer<typeof pedidoCompraSchema>;
export type PedidoCompraItemInput = z.infer<typeof pedidoCompraItemSchema>;
export type OsPrazoInput = z.infer<typeof osPrazoSchema>;
