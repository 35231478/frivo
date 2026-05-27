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
  ADIMPLENTE: "bg-green-100 text-green-700",
  INADIMPLENTE: "bg-red-100 text-red-700",
  EM_NEGOCIACAO: "bg-yellow-100 text-yellow-700",
  AGUARDANDO_VENCIMENTO: "bg-orange-100 text-orange-700",
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
