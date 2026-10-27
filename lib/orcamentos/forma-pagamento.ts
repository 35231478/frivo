/**
 * Forma de pagamento do orçamento: uma opção da lista (climatização / corporativo) ou "Outro" com
 * texto livre. O que vai para o banco e para o documento é o TEXTO (campo `formaPagamento`, o mesmo
 * de sempre): orçamento antigo com texto livre abre como "Outro", com o texto dele.
 */

export interface OpcaoPagamento {
  valor: string;
  rotulo: string;
  /** Pede o número de parcelas (2x a 12x) */
  parcelas?: boolean;
}

export const FORMAS_PAGAMENTO: readonly OpcaoPagamento[] = [
  { valor: "A_VISTA", rotulo: "À vista" },
  { valor: "PIX", rotulo: "PIX" },
  { valor: "BOLETO_A_VISTA", rotulo: "Boleto à vista" },
  { valor: "TRANSFERENCIA", rotulo: "Transferência / TED" },
  { valor: "CARTAO_CREDITO", rotulo: "Cartão de crédito" },
  { valor: "CARTAO_PARCELADO", rotulo: "Cartão de crédito parcelado", parcelas: true },
  { valor: "PARCELADO_BOLETO", rotulo: "Parcelado no boleto", parcelas: true },
  { valor: "ENTRADA_SALDO", rotulo: "Entrada + saldo na entrega/conclusão" },
  { valor: "FATURADO_30", rotulo: "Faturado 30 dias" },
  { valor: "PRAZO_30_60_90", rotulo: "30/60/90 dias" },
  { valor: "CONFORME_CONTRATO", rotulo: "Conforme contrato" },
];

export const OPCAO_OUTRO = "OUTRO";
export const PARCELAS_MIN = 2;
export const PARCELAS_MAX = 12;
export const PARCELAS_PADRAO = 3;
export const FORMA_PAGAMENTO_MAX = 200;

export interface EscolhaPagamento {
  /** "" = não informado; um valor de FORMAS_PAGAMENTO; ou OPCAO_OUTRO */
  opcao: string;
  parcelas: number;
  outro: string;
}

const parcelasValidas = (n: unknown) => {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) ? Math.min(PARCELAS_MAX, Math.max(PARCELAS_MIN, v)) : PARCELAS_PADRAO;
};

/** O texto que vai para o banco/documento ("" = não informado). */
export function textoFormaPagamento(e: EscolhaPagamento): string {
  if (!e.opcao) return "";
  if (e.opcao === OPCAO_OUTRO) return e.outro.replace(/\s+/g, " ").trim().slice(0, FORMA_PAGAMENTO_MAX);
  const op = FORMAS_PAGAMENTO.find((o) => o.valor === e.opcao);
  if (!op) return "";
  return op.parcelas ? `${op.rotulo} em ${parcelasValidas(e.parcelas)}x` : op.rotulo;
}

/** Lê o texto gravado de volta para a escolha (o contrário de textoFormaPagamento). */
export function lerFormaPagamento(texto: string | null | undefined): EscolhaPagamento {
  const t = (texto ?? "").trim();
  if (!t) return { opcao: "", parcelas: PARCELAS_PADRAO, outro: "" };
  const chave = t.toLocaleLowerCase("pt-BR");
  for (const op of FORMAS_PAGAMENTO) {
    const rotulo = op.rotulo.toLocaleLowerCase("pt-BR");
    if (!op.parcelas && chave === rotulo) return { opcao: op.valor, parcelas: PARCELAS_PADRAO, outro: "" };
    if (op.parcelas) {
      const m = new RegExp(`^${rotulo.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} em (\\d{1,2})x$`).exec(chave);
      if (m && Number(m[1]) >= PARCELAS_MIN && Number(m[1]) <= PARCELAS_MAX) return { opcao: op.valor, parcelas: Number(m[1]), outro: "" };
    }
  }
  // Texto livre (de antes da lista, ou digitado em "Outro")
  return { opcao: OPCAO_OUTRO, parcelas: PARCELAS_PADRAO, outro: t };
}
