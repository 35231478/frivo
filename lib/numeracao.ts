import { z } from "zod";

/**
 * Numeração de documentos (Configurações › Numeração de documentos) — a parte PURA: os tipos que
 * geram número, o formato de cada um, como ler o sequencial de um número já gravado e a validação do
 * "próximo número" que a tela manda. A sequência é CONTÍNUA (não reinicia no ano): o ano no número é
 * só o rótulo de quando o documento nasceu.
 *
 * Fora daqui: NFS-e (o número vem da prefeitura, e o RPS é do PlugNotas) e os códigos de produto e
 * serviço (lib/cadastros/codigos), que não são documentos.
 */
export const TIPOS_NUMERACAO = [
  "orcamento", "os", "chamado", "contrato", "medicao", "pedido_compra", "conta_receber", "conta_pagar", "relatorio_os", "qrcode",
] as const;
export type TipoNumeracao = (typeof TIPOS_NUMERACAO)[number];

export interface DefNumeracao {
  rotulo: string;
  prefixo: string;
  /** Zeros à esquerda (o número cresce além deles sem cortar) */
  digitos: number;
  /** Onde os números já usados estão (para o "maior já usado") */
  tabela: string;
  coluna: string;
  dica: string;
}

export const NUMERACOES: Record<TipoNumeracao, DefNumeracao> = {
  orcamento: { rotulo: "Orçamento", prefixo: "ORC", digitos: 4, tabela: "orcamentos", coluna: "codigo", dica: "Orçamentos e propostas de contrato (ORC-ANO-NÚMERO)." },
  os: { rotulo: "Ordem de serviço", prefixo: "OS", digitos: 4, tabela: "ordens_servico", coluna: "numero", dica: "Toda OS, inclusive as geradas por orçamento, contrato e recorrência." },
  chamado: { rotulo: "Chamado (portal e QR)", prefixo: "CHM", digitos: 4, tabela: "ordens_servico", coluna: "chamado_numero", dica: "Número que o cliente vê ao abrir um chamado pelo portal ou pelo QR do equipamento." },
  contrato: { rotulo: "Contrato", prefixo: "CT", digitos: 3, tabela: "contratos", coluna: "numero", dica: "Sugestão do botão “Gerar número” e contratos gerados de orçamento." },
  medicao: { rotulo: "Medição / Fatura", prefixo: "MED", digitos: 4, tabela: "medicoes", coluna: "numero", dica: "Medições de contrato, medições manuais e faturas avulsas (a fatura mostra só ANO-NÚMERO)." },
  pedido_compra: { rotulo: "Pedido de compra", prefixo: "PCI", digitos: 4, tabela: "pedidos_compra_interno", coluna: "numero", dica: "Pedidos de compra internos (inclusive em cotação)." },
  conta_receber: { rotulo: "Conta a receber", prefixo: "CR", digitos: 4, tabela: "contas_receber", coluna: "numero", dica: "Cobranças avulsas, de medição, de orçamento e renegociações. As de contrato usam o número do contrato." },
  conta_pagar: { rotulo: "Conta a pagar", prefixo: "CP", digitos: 4, tabela: "contas_pagar", coluna: "numero", dica: "Contas manuais e as lançadas a partir de NF de compra." },
  relatorio_os: { rotulo: "Relatório da OS", prefixo: "REL", digitos: 4, tabela: "relatorios_os", coluna: "numero", dica: "Relatórios de atividade da OS." },
  qrcode: { rotulo: "QR Code", prefixo: "QR", digitos: 4, tabela: "qrcodes", coluna: "codigo", dica: "Etiquetas QR dos equipamentos (avulsas e em lote)." },
};

/** Maior sequencial aceito (cabe num INTEGER com folga) */
export const NUMERO_MAXIMO = 999_999_999;

/** O número como vai gravado: PREFIXO-ANO-SEQUENCIAL (o ano é rótulo; a sequência é contínua) */
export function formatarNumero(tipo: TipoNumeracao, seq: number, ano: number): string {
  const d = NUMERACOES[tipo];
  return `${d.prefixo}-${ano}-${String(seq).padStart(d.digitos, "0")}`;
}

/** Regex (texto, para o SQL e para o parse) dos números gravados deste tipo; aceita o sufixo "/n" das parcelas */
export const regexNumero = (tipo: TipoNumeracao) => `^${NUMERACOES[tipo].prefixo}-[0-9]{4}-[0-9]{1,9}(/[0-9]+)?$`;

/** O sequencial de um número já gravado ("ORC-2026-0147" → 147; "CR-2026-0042/3" → 42); fora do padrão = null */
export function sequencialDe(tipo: TipoNumeracao, numero: string | null | undefined): number | null {
  if (!numero) return null;
  const m = new RegExp(regexNumero(tipo)).exec(numero);
  if (!m) return null;
  return Number(numero.split("/")[0].split("-")[2]);
}

/** O menor "próximo número" que a tela aceita: nunca igual ou abaixo do maior já usado */
export const minimoPermitido = (maiorUsado: number) => maiorUsado + 1;

export function mensagemMinimo(tipo: TipoNumeracao, maiorUsado: number): string {
  const d = NUMERACOES[tipo];
  return maiorUsado > 0
    ? `O próximo número de ${d.rotulo.toLowerCase()} precisa ser pelo menos ${minimoPermitido(maiorUsado)}: o maior já usado é ${maiorUsado}.`
    : `O próximo número de ${d.rotulo.toLowerCase()} precisa ser pelo menos 1.`;
}

/** O que a tela manda: um tipo e o próximo número dele */
export const proximoNumeroSchema = z.object({
  tipo: z.enum(TIPOS_NUMERACAO),
  proximo: z.number().int().min(1).max(NUMERO_MAXIMO),
}).strict();

/** O que a tela recebe por tipo */
export interface NumeracaoTela {
  tipo: TipoNumeracao;
  rotulo: string;
  prefixo: string;
  dica: string;
  /** O maior sequencial já gravado (0 = nenhum documento ainda) */
  maiorUsado: number;
  /** O próximo que será gerado (o contador configurado ou, sem contador, maiorUsado + 1) */
  proximo: number;
  /** Se há um contador gravado (false = ainda no automático) */
  configurado: boolean;
  /** Exemplo do próximo número como vai sair */
  exemplo: string;
}
