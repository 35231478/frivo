import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatarData(data: Date | string | null | undefined, mascara = "dd/MM/yyyy"): string {
  if (!data) return "—";
  return format(new Date(data), mascara, { locale: ptBR });
}

export function formatarDataHora(data: Date | string | null | undefined): string {
  return formatarData(data, "dd/MM/yyyy 'às' HH:mm");
}

export function formatarMoeda(valor: number | null | undefined): string {
  if (valor == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

export function formatarCpfCnpj(valor: string): string {
  const numeros = valor.replace(/\D/g, "");
  if (numeros.length === 11) {
    return numeros.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return numeros.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

export function formatarTelefone(valor: string): string {
  const numeros = valor.replace(/\D/g, "");
  if (numeros.length === 11) {
    return numeros.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }
  return numeros.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
}

export function gerarNumeroOS(sequencial: number): string {
  return `OS-${new Date().getFullYear()}-${String(sequencial).padStart(4, "0")}`;
}

export function gerarNumeroContrato(sequencial: number): string {
  return `CT-${new Date().getFullYear()}-${String(sequencial).padStart(3, "0")}`;
}

export function gerarCodigoOrcamento(sequencial: number): string {
  return `ORC-${new Date().getFullYear()}-${String(sequencial).padStart(4, "0")}`;
}

export function gerarNumeroMedicao(sequencial: number, ano = new Date().getFullYear()): string {
  return `MED-${ano}-${String(sequencial).padStart(4, "0")}`;
}

export function gerarNumeroContaReceber(sequencial: number, ano = new Date().getFullYear()): string {
  return `CR-${ano}-${String(sequencial).padStart(4, "0")}`;
}

export function gerarNumeroContaPagar(sequencial: number, ano = new Date().getFullYear()): string {
  return `CP-${ano}-${String(sequencial).padStart(4, "0")}`;
}

export function gerarNumeroPedidoCompra(sequencial: number, ano = new Date().getFullYear()): string {
  return `PCI-${ano}-${String(sequencial).padStart(4, "0")}`;
}

export function gerarNumeroRelatorio(sequencial: number, ano = new Date().getFullYear()): string {
  return `REL-${ano}-${String(sequencial).padStart(4, "0")}`;
}

export const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function nomeMes(mes: number | null | undefined): string {
  if (mes == null || mes < 1 || mes > 12) return "—";
  return MESES_PT[mes - 1];
}

export function sanitizarNumero(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

// Iniciais a partir do nome (1 ou 2 letras maiúsculas)
export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Paleta de avatares: azul, verde, roxo, laranja, rosa, ciano (fundo sólido, texto branco)
export const CORES_AVATAR = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500",
  "bg-orange-500", "bg-pink-500", "bg-cyan-500",
];

// Cor consistente para o mesmo nome (hash simples da string)
export function corAvatar(nome: string | null | undefined): string {
  const s = nome ?? "";
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return CORES_AVATAR[Math.abs(hash) % CORES_AVATAR.length];
}

export function whatsappLink(telefone: string | null | undefined, mensagem: string): string {
  const num = sanitizarNumero(telefone);
  const comDdi = num.length >= 12 ? num : `55${num}`;
  return `https://wa.me/${comDdi}?text=${encodeURIComponent(mensagem)}`;
}

export const LABELS_STATUS_OS: Record<string, string> = {
  ABERTA: "Aberta",
  AGUARDANDO_ATENDIMENTO: "Aguardando Atendimento",
  AGENDADA: "Agendada",
  EM_ANDAMENTO: "Em Andamento",
  PAUSADA: "Pausada",
  AGUARDANDO_PECA: "Aguardando Peça",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
};

export const LABELS_PRIORIDADE: Record<string, string> = {
  BAIXA: "Baixa",
  NORMAL: "Normal",
  ALTA: "Alta",
  URGENTE: "Urgente",
  CRITICO: "Crítico",
};

export const LABELS_ORIGEM_OS: Record<string, string> = {
  MANUAL: "Manual",
  RECORRENTE: "Recorrente",
  PORTAL_CLIENTE: "Portal do Cliente",
};

export const PERMISSOES_PORTAL = [
  { chave: "verOS", label: "Ver histórico de OS" },
  { chave: "abrirChamados", label: "Abrir chamados" },
  { chave: "verDocumentos", label: "Ver documentos (PMOC, ART, contratos)" },
  { chave: "verEquipamentos", label: "Ver equipamentos" },
  { chave: "verFinanceiro", label: "Ver financeiro" },
  { chave: "verBoletos", label: "Ver e baixar boletos" },
  { chave: "aprovarMedicoes", label: "Aprovar medições" },
  { chave: "verValores", label: "Ver valores financeiros" },
] as const;

export type PermissaoPortal = (typeof PERMISSOES_PORTAL)[number]["chave"];

export const LABELS_TIPO_SERVICO: Record<string, string> = {
  INSTALACAO: "Instalação",
  MANUTENCAO_PREVENTIVA: "Manutenção Preventiva",
  MANUTENCAO_CORRETIVA: "Manutenção Corretiva",
  LIMPEZA: "Limpeza",
  RECARGA_GAS: "Recarga de Gás",
  VISITA_TECNICA: "Visita Técnica",
  GARANTIA: "Garantia",
  ORCAMENTO: "Orçamento",
  DESMONTAGEM: "Desmontagem",
  OUTRO: "Outro",
};

export const LABELS_TIPO_EQUIPAMENTO: Record<string, string> = {
  AR_CONDICIONADO_SPLIT: "Ar-cond. Split",
  AR_CONDICIONADO_JANELA: "Ar-cond. Janela",
  AR_CONDICIONADO_CENTRAL: "Ar-cond. Central",
  AR_CONDICIONADO_PORTATIL: "Ar-cond. Portátil",
  CHILLER: "Chiller",
  TORRE_RESFRIAMENTO: "Torre de Resfriamento",
  CAMARA_FRIA: "Câmara Fria",
  CAMARA_CLIMATIZADA: "Câmara Climatizada",
  REFRIGERADOR_COMERCIAL: "Refrigerador Comercial",
  CONGELADOR_COMERCIAL: "Congelador Comercial",
  VRF: "VRF",
  FANCOIL: "Fan Coil",
  CONDENSADORA: "Condensadora",
  EVAPORADORA: "Evaporadora",
  OUTRO: "Outro",
};

export const LABELS_SEGMENTO: Record<string, string> = {
  INDUSTRIA: "Indústria",
  COMERCIO: "Comércio",
  SAUDE: "Saúde",
  EDUCACAO: "Educação",
  HOTELARIA: "Hotelaria",
  ALIMENTACAO: "Alimentação",
  CORPORATIVO: "Corporativo",
  RESIDENCIAL: "Residencial",
  OUTRO: "Outro",
};

export const LABELS_ORIGEM: Record<string, string> = {
  INDICACAO: "Indicação",
  GOOGLE: "Google",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  PROSPECCAO_ATIVA: "Prospecção Ativa",
  SITE: "Site",
  OUTRO: "Outro",
};

export const LABELS_STATUS_FINANCEIRO: Record<string, string> = {
  ADIMPLENTE: "Adimplente",
  INADIMPLENTE: "Inadimplente",
  EM_NEGOCIACAO: "Em Negociação",
  AGUARDANDO_VENCIMENTO: "Aguard. Vencimento",
};

export const COR_STATUS_FINANCEIRO: Record<string, string> = {
  ADIMPLENTE: "bg-success-50 text-success-700",
  INADIMPLENTE: "bg-red-50 text-red-700",
  EM_NEGOCIACAO: "bg-amber-50 text-amber-700",
  AGUARDANDO_VENCIMENTO: "bg-orange-50 text-orange-700",
};

export const LABELS_TIPO_CONTATO: Record<string, string> = {
  FINANCEIRO: "Financeiro",
  OPERACIONAL: "Operacional / Chamados",
  TECNICO: "Técnico",
  DIRETORIA: "Diretoria",
  CONTRATUAL: "Contratual",
  OUTRO: "Outro",
};

// Tipos de contato usados na aba "Comunicação" (roteamento de e-mails por área).
export const TIPOS_COMUNICACAO = ["OPERACIONAL", "FINANCEIRO", "CONTRATUAL"] as const;
export type TipoComunicacao = (typeof TIPOS_COMUNICACAO)[number];

export const LABELS_TIPO_COMUNICACAO: Record<TipoComunicacao, string> = {
  OPERACIONAL: "Operacional",
  FINANCEIRO: "Financeiro",
  CONTRATUAL: "Contratual",
};

// Preferências de comunicação (aba Comunicação do cliente): seções e canais.
export const LABELS_CANAL_COMUNICACAO: Record<string, string> = {
  EMAIL: "E-mail",
  WHATSAPP: "WhatsApp",
  AMBOS: "Ambos",
};

export const SECOES_COMUNICACAO = [
  {
    tipo: "ORDENS",
    titulo: "Ordens de Serviço e Agendamentos",
    descricao: "Recebem notificações de OS, agendamentos, PMOC e relatórios de serviço.",
  },
  {
    tipo: "ORCAMENTOS",
    titulo: "Orçamentos",
    descricao: "Recebem orçamentos e propostas.",
  },
  {
    tipo: "FINANCEIRO",
    titulo: "Notas Fiscais e Boletos",
    descricao: "Recebem NF-e, boletos, cobranças e lembretes de vencimento.",
  },
] as const;

// Cores dos badges por tipo de contato (cobre todos os valores de TipoContato).
export const COR_TIPO_CONTATO: Record<string, string> = {
  OPERACIONAL: "bg-blue-50 text-blue-700",
  FINANCEIRO: "bg-emerald-50 text-emerald-700",
  CONTRATUAL: "bg-purple-50 text-purple-700",
  TECNICO: "bg-amber-50 text-amber-700",
  DIRETORIA: "bg-slate-100 text-slate-600",
  OUTRO: "bg-gray-100 text-gray-600",
};

export const LABELS_TIPO_INTERACAO: Record<string, string> = {
  LIGACAO: "Ligação",
  VISITA: "Visita",
  EMAIL: "E-mail",
  WHATSAPP: "WhatsApp",
  REUNIAO: "Reunião",
};

export const LABELS_STATUS_ORCAMENTO: Record<string, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  APROVADO: "Aprovado",
  REPROVADO: "Reprovado",
  CANCELADO: "Cancelado",
  CONVERTIDA: "Convertida",
};

export const CLASSE_STATUS_ORCAMENTO: Record<string, string> = {
  RASCUNHO: "badge-orc-rascunho",
  ENVIADO: "badge-orc-enviado",
  APROVADO: "badge-orc-aprovado",
  REPROVADO: "badge-orc-reprovado",
  CANCELADO: "badge-orc-cancelado",
  CONVERTIDA: "badge-base bg-primary-50 text-primary-700",
};

export const LABELS_TIPO_ORCAMENTO: Record<string, string> = {
  COMUM: "Orçamento Comum",
  PROPOSTA_CONTRATO: "Proposta de Contrato",
};

export const CLASSE_TIPO_ORCAMENTO: Record<string, string> = {
  COMUM: "badge-base bg-primary-50 text-primary-700",
  PROPOSTA_CONTRATO: "badge-base bg-success-50 text-success-700",
};

/** Variáveis disponíveis no termo de referência da proposta de contrato. */
export const VARIAVEIS_TERMO = [
  "{{cliente_nome}}",
  "{{valor_mensal}}",
  "{{vigencia}}",
  "{{frequencia}}",
  "{{data_inicio}}",
  "{{responsavel_tecnico}}",
  "{{art_numero}}",
] as const;

/** Calcula a data fim somando `meses` à data de início. */
export function calcularDataFimContrato(inicio: Date | string | null | undefined, meses: number | null | undefined): Date | null {
  if (!inicio || !meses) return null;
  const d = new Date(inicio);
  if (isNaN(d.getTime())) return null;
  const fim = new Date(d);
  fim.setMonth(fim.getMonth() + meses);
  return fim;
}

export const LABELS_TIPO_DESCONTO: Record<string, string> = {
  VALOR: "R$",
  PERCENTUAL: "%",
};

// ─────────────────────────────────────────────
// FINANCEIRO
// ─────────────────────────────────────────────

export const LABELS_PERFIL_FATURAMENTO: Record<string, string> = {
  COM_APROVACAO: "Com aprovação (licitação/corporativo)",
  AUTOMATICO: "Automático (privado simples)",
  FATURA_UNICA: "Fatura única (agrupa tudo)",
};

export const LABELS_TIPO_MEDICAO: Record<string, string> = {
  MENSAL_FIXO: "Mensal fixo",
  ADICIONAL: "Adicional",
  FATURA_UNICA: "Fatura única",
};

export const LABELS_STATUS_MEDICAO: Record<string, string> = {
  RASCUNHO: "Rascunho",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  APROVADA: "Aprovada",
  AGUARDANDO_PC: "Aguardando PC",
  PC_RECEBIDO: "PC recebido",
  NF_EMITIDA: "NF emitida",
  BOLETO_GERADO: "Boleto gerado",
  PAGO: "Pago",
  CANCELADA: "Cancelada",
};

export const CLASSE_STATUS_MEDICAO: Record<string, string> = {
  RASCUNHO: "badge-med-rascunho",
  AGUARDANDO_APROVACAO: "badge-med-aguardando",
  APROVADA: "badge-med-aprovada",
  AGUARDANDO_PC: "badge-med-aguardando-pc",
  PC_RECEBIDO: "badge-med-pc",
  NF_EMITIDA: "badge-med-nf",
  BOLETO_GERADO: "badge-med-boleto",
  PAGO: "badge-med-pago",
  CANCELADA: "badge-med-cancelada",
};

export const LABELS_STATUS_CONTA_RECEBER: Record<string, string> = {
  PREVISTO: "Previsto",
  A_RECEBER: "A receber",
  RECEBIDO: "Recebido",
  CANCELADO: "Cancelado",
  ATRASADO: "Atrasado",
};

export const CLASSE_STATUS_CONTA_RECEBER: Record<string, string> = {
  PREVISTO: "badge-base bg-slate-100 text-slate-600",
  A_RECEBER: "badge-base bg-primary-50 text-primary-700",
  RECEBIDO: "badge-base bg-success-50 text-success-700",
  CANCELADO: "badge-base bg-slate-100 text-slate-500",
  ATRASADO: "badge-base bg-red-50 text-red-700",
};

export const LABELS_FORMA_PAGAMENTO: Record<string, string> = {
  BOLETO: "Boleto",
  PIX: "PIX",
  TRANSFERENCIA: "Transferência",
  DINHEIRO: "Dinheiro",
  CARTAO: "Cartão",
  CHEQUE: "Cheque",
};

// ─────────────────────────────────────────────
// PRAZOS / SLA E COMPRAS
// ─────────────────────────────────────────────

export const LABELS_RESPONSAVEL_PRAZO: Record<string, string> = {
  COMPRADOR: "Comprador",
  GESTOR: "Gestor",
  TECNICO: "Técnico",
  CLIENTE: "Cliente",
};

export const LABELS_CANAL_NOTIFICACAO: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  SISTEMA: "Sistema",
};

export const LABELS_STATUS_PEDIDO_COMPRA: Record<string, string> = {
  SOLICITADO: "Solicitado",
  COTANDO: "Cotando",
  COMPRADO: "Comprado",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};

export const CLASSE_STATUS_PEDIDO_COMPRA: Record<string, string> = {
  SOLICITADO: "badge-base bg-primary-50 text-primary-700",
  COTANDO: "badge-base bg-amber-50 text-amber-700",
  COMPRADO: "badge-base bg-violet-50 text-violet-700",
  ENTREGUE: "badge-base bg-success-50 text-success-700",
  CANCELADO: "badge-base bg-slate-100 text-slate-500",
};

export const LABELS_STATUS_OS_PRAZO: Record<string, string> = {
  ATIVO: "Ativo",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado",
  ATRASADO: "Atrasado",
};

export const LABELS_STATUS_PRAZO_ETAPA: Record<string, string> = {
  PENDENTE: "Pendente",
  EM_ANDAMENTO: "Em andamento",
  CONCLUIDA: "Concluída",
  ATRASADA: "Atrasada",
};

export const LABELS_TIPO_TABELA_PRECO: Record<string, string> = {
  PADRAO: "Padrão",
  CONTRATO: "Contrato",
  PERSONALIZADA: "Personalizada",
};

export const LABELS_TIPO_PRECO_TABELA: Record<string, string> = {
  VALOR_FIXO: "Valor fixo",
  DESCONTO_PERCENTUAL: "Desconto percentual",
};

// ── OS recorrente / Relatórios ──

export const LABELS_PERIODICIDADE: Record<string, string> = {
  SEMANAL: "Semanal",
  QUINZENAL: "Quinzenal",
  MENSAL: "Mensal",
  BIMESTRAL: "Bimestral",
  TRIMESTRAL: "Trimestral",
  SEMESTRAL: "Semestral",
  ANUAL: "Anual",
};

// Frequências válidas para recorrência de OS
export const FREQUENCIAS_RECORRENCIA = ["MENSAL", "BIMESTRAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"] as const;

export const LABELS_TRATAMENTO_FIM_SEMANA: Record<string, string> = {
  MANTER: "Manter na data original",
  ADIANTAR: "Adiantar para sexta-feira",
  POSTERGAR: "Postergar para segunda-feira",
};

// ── Contratos ──
export const LABELS_TIPO_CONTRATO: Record<string, string> = {
  MANUTENCAO_PREVENTIVA: "Manutenção Preventiva",
  MANUTENCAO_CORRETIVA: "Manutenção Corretiva",
  MANUTENCAO_COMPLETA: "Manutenção Completa",
  INSTALACAO: "Instalação",
  LOCACAO: "Locação",
  ASSISTENCIA_TECNICA: "Assistência Técnica",
};

export const LABELS_STATUS_CONTRATO: Record<string, string> = {
  ATIVO: "Ativo",
  SUSPENSO: "Suspenso",
  ENCERRADO: "Encerrado",
  CANCELADO: "Cancelado",
  VENCIDO: "Vencido",
  AGUARDANDO_ASSINATURA: "Aguardando Assinatura",
  EM_RENOVACAO: "Em renovação",
};

export const COR_STATUS_CONTRATO: Record<string, string> = {
  ATIVO: "bg-success-50 text-success-700",
  SUSPENSO: "bg-amber-50 text-amber-700",
  ENCERRADO: "bg-slate-100 text-slate-600",
  CANCELADO: "bg-red-50 text-red-700",
  VENCIDO: "bg-red-50 text-red-700",
  AGUARDANDO_ASSINATURA: "bg-slate-100 text-slate-600",
  EM_RENOVACAO: "bg-blue-50 text-blue-700",
};

// Status oferecidos no formulário/gerenciamento de contrato (subconjunto do enum).
export const STATUS_CONTRATO_FORM = ["ATIVO", "SUSPENSO", "EM_RENOVACAO", "ENCERRADO", "CANCELADO"] as const;

// Ajuste de fins de semana/feriados para o vencimento da parcela.
export const LABELS_AJUSTE_FIM_SEMANA: Record<string, string> = {
  ADIANTAR: "Antecipar para dia útil anterior",
  POSTERGAR: "Postergar para próximo dia útil",
  MANTER: "Manter data original",
};

export const LABELS_TIPO_VENCIMENTO: Record<string, string> = {
  DIAS_APOS_FATURAMENTO: "Dias após o faturamento",
  DIA_FIXO_MES: "Dia fixo do mês",
};

export const LABELS_INDICE_REAJUSTE: Record<string, string> = {
  IPCA: "IPCA",
  IGPM: "IGP-M",
  INPC: "INPC",
  PERCENTUAL_FIXO: "Percentual fixo",
};

export const LABELS_PERIODO_REF_NFSE: Record<string, string> = {
  MES_ANTERIOR_FATURAMENTO: "Mês anterior ao faturamento",
  MES_FATURAMENTO: "Mês do faturamento",
  MES_POSTERIOR_FATURAMENTO: "Mês posterior ao faturamento",
  MES_ANTERIOR_VENCIMENTO: "Mês anterior ao vencimento",
  MES_VENCIMENTO: "Mês do vencimento",
};

export const LABELS_PERIODO_VISITA: Record<string, string> = {
  MES: "por mês",
  TRIMESTRE: "por trimestre",
  SEMESTRE: "por semestre",
  ANO: "por ano",
};

export const LABELS_MES: Record<number, string> = {
  1: "Janeiro", 2: "Fevereiro", 3: "Março", 4: "Abril", 5: "Maio", 6: "Junho",
  7: "Julho", 8: "Agosto", 9: "Setembro", 10: "Outubro", 11: "Novembro", 12: "Dezembro",
};

// Itens inclusos padrão do escopo do contrato (checklist).
export const ITENS_INCLUSOS_CONTRATO = [
  { chave: "manutencaoPreventivaMensal", label: "Manutenção preventiva mensal" },
  { chave: "limpezaQuimicaSemestral", label: "Limpeza química semestral" },
  { chave: "atendimentoCorretivo", label: "Atendimento corretivo" },
  { chave: "relatorioPmoc", label: "Relatório PMOC" },
] as const;

export const LABELS_TIPO_RELATORIO: Record<string, string> = {
  PMOC: "PMOC",
  MANUTENCAO: "Relatório de Manutenção",
  MEDICAO: "Medição",
};

export const TITULO_RELATORIO: Record<string, string> = {
  PMOC: "RELATÓRIO DE MANUTENÇÃO — PMOC",
  MANUTENCAO: "RELATÓRIO DE MANUTENÇÃO",
  MEDICAO: "RELATÓRIO DE MEDIÇÃO",
};

export const LABELS_STATUS_RELATORIO: Record<string, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  APROVADO: "Aprovado",
  REPROVADO: "Reprovado",
};

export const CLASSE_STATUS_RELATORIO: Record<string, string> = {
  RASCUNHO: "badge-base bg-slate-100 text-slate-600",
  ENVIADO: "badge-base bg-primary-50 text-primary-700",
  APROVADO: "badge-base bg-success-50 text-success-700",
  REPROVADO: "badge-base bg-red-50 text-red-700",
};

/** Substitui variáveis {{nome}} em um template de mensagem. */
export function aplicarVariaveis(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, chave) => vars[chave] ?? "");
}

/** Formata uma duração em horas como texto legível (ex.: 30min, 4h, 2d). */
export function formatarPrazoHoras(horas: number): string {
  if (horas < 1) return `${Math.round(horas * 60)}min`;
  if (horas % 24 === 0) return `${horas / 24}d`;
  if (horas < 24) return `${horas}h`;
  const dias = Math.floor(horas / 24);
  const resto = horas % 24;
  return resto ? `${dias}d ${resto}h` : `${dias}d`;
}
