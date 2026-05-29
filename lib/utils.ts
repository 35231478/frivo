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

export function gerarNumeroPedidoCompra(sequencial: number, ano = new Date().getFullYear()): string {
  return `PCI-${ano}-${String(sequencial).padStart(4, "0")}`;
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

export function whatsappLink(telefone: string | null | undefined, mensagem: string): string {
  const num = sanitizarNumero(telefone);
  const comDdi = num.length >= 12 ? num : `55${num}`;
  return `https://wa.me/${comDdi}?text=${encodeURIComponent(mensagem)}`;
}

export const LABELS_STATUS_OS: Record<string, string> = {
  ABERTA: "Aberta",
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
};

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
  OUTRO: "Outro",
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
};

export const CLASSE_STATUS_ORCAMENTO: Record<string, string> = {
  RASCUNHO: "badge-orc-rascunho",
  ENVIADO: "badge-orc-enviado",
  APROVADO: "badge-orc-aprovado",
  REPROVADO: "badge-orc-reprovado",
  CANCELADO: "badge-orc-cancelado",
};

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
