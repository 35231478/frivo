/**
 * EDITAR NO CONTEXTO — as regras puras (tela e testes usam as mesmas).
 *
 * Editar sem sair da tela só é seguro se a interface disser, sempre, O QUE está sendo editado:
 *
 *  - REFERÊNCIA (o cadastro-mãe): muda em todo lugar. Editar o telefone do cliente dentro do orçamento
 *    altera o cadastro do cliente de verdade. Rótulo: "Editando o cadastro do cliente".
 *  - USO (a linha da transação): muda só ali. Editar quantidade, preço ou descrição de um item da OS
 *    não altera o serviço no catálogo. Rótulo: "Editando este item da OS".
 *
 * E registro FECHADO não se edita: faturado, OS assinada pelo cliente, orçamento aprovado pelo cliente,
 * nota emitida. A trava vale para o USO (a linha do registro fechado); o cadastro-mãe continua sendo
 * editado no cadastro dele.
 *
 * OS só "concluída" NÃO é registro fechado: o escritório ainda ajusta os itens antes de faturar. A trava
 * começa na assinatura do cliente, na fatura ou na nota.
 */

export type EscopoEdicao = "referencia" | "uso";

/**
 * O rótulo obrigatório do que está sendo editado.
 *  - referência: `alvo` é de quem é o cadastro, com a preposição — "do cliente", "da unidade";
 *  - uso: `alvo` é a linha, com o demonstrativo — "este item da OS", "esta linha do orçamento".
 */
export function rotuloDaEdicao(escopo: EscopoEdicao, alvo: string): string {
  const a = alvo.trim();
  return escopo === "referencia" ? `Editando o cadastro ${a}` : `Editando ${a}`;
}

/** Até onde a mudança chega: a frase que acompanha o rótulo. */
export function alcanceDaEdicao(escopo: EscopoEdicao): string {
  return escopo === "referencia"
    ? "Vale em todo lugar onde este cadastro é usado."
    : "Vale só aqui. O cadastro não muda.";
}

/** O que a tela sabe do registro em que a linha está (só o que se aplica; o resto fica de fora). */
export interface SituacaoDoRegistro {
  /** Nota fiscal já emitida para este registro */
  notaEmitida?: boolean;
  /** Já faturado (fatura/medição com cobrança ou nota gerada) */
  faturado?: boolean;
  /** Situação do aceite do cliente na OS ("CONFIRMADO" = assinada) */
  aceite?: string | null;
  /** Status do orçamento ("APROVADO" ou "CONVERTIDA" = aprovado pelo cliente) */
  statusOrcamento?: string | null;
}

export const TRAVA_NOTA = "Nota fiscal emitida: este registro não pode mais ser editado.";
export const TRAVA_FATURADO = "Já faturado: este registro não pode mais ser editado.";
export const TRAVA_ASSINADA = "OS assinada pelo cliente: este registro não pode mais ser editado.";
export const TRAVA_APROVADO = "Orçamento aprovado pelo cliente: este registro não pode mais ser editado.";

/**
 * Por que o registro está travado para edição — ou null, se dá para editar. Quando mais de um motivo
 * vale, fica o mais definitivo (nota > faturado > assinada > orçamento aprovado).
 */
export function motivoDaTrava(r: SituacaoDoRegistro | null | undefined): string | null {
  if (!r) return null;
  if (r.notaEmitida) return TRAVA_NOTA;
  if (r.faturado) return TRAVA_FATURADO;
  if (r.aceite === "CONFIRMADO") return TRAVA_ASSINADA;
  if (r.statusOrcamento === "APROVADO" || r.statusOrcamento === "CONVERTIDA") return TRAVA_APROVADO;
  return null;
}

/** Os campos que mudaram (o que vai para o servidor): compara aparado, e vazio conta como mudança para vazio. */
export function camposAlterados(antes: Record<string, string | null | undefined>, depois: Record<string, string | null | undefined>, campos: readonly string[]): string[] {
  const limpo = (v: string | null | undefined) => (v ?? "").trim();
  return campos.filter((c) => limpo(antes[c]) !== limpo(depois[c]));
}

/* ───────── Leva 2: a trava nas telas de OS e de orçamento ───────── */

/** Linha que não se edita por um motivo dela mesma (o documento pode estar aberto). */
export const TRAVA_LINHA_PECA = "Peça de um serviço: muda pelos materiais do serviço.";
export const TRAVA_LINHA_DO_ORCAMENTO = "Veio do orçamento aprovado: este item segue o orçamento.";
export const TRAVA_LINHA_EXECUTADA = "Item já executado: não pode mais ser editado.";
export const TRAVA_LINHA_SEPARADA = "Há material separado ou consumido para este item: desfaça a separação antes de editar.";

/** Orçamento que só se edita em rascunho (regra que o servidor já tinha). */
export const TRAVA_ORCAMENTO_ENVIADO = "Orçamento enviado ao cliente: volte para rascunho para editar.";
export const TRAVA_ORCAMENTO_REPROVADO = "Orçamento reprovado: só o rascunho pode ser editado.";
export const TRAVA_ORCAMENTO_CANCELADO = "Orçamento cancelado: reative para editar.";

/**
 * O que a OS sabe dela mesma → a situação que `motivoDaTrava` entende. O status não entra: OS concluída
 * sem assinatura, fatura nem nota continua editável.
 */
export function situacaoDaOs(os: {
  aceite?: { situacao?: string | null } | null;
  /** Já entrou numa fatura/medição viva */
  faturada?: boolean;
  notaEmitida?: boolean;
}): SituacaoDoRegistro {
  return { aceite: os.aceite?.situacao ?? null, faturado: !!os.faturada, notaEmitida: !!os.notaEmitida };
}

/** A linha da OS como a trava a enxerga (só o que decide). */
export interface LinhaDaOs {
  /** Peça derivada de um material do serviço */
  materialId?: string | null;
  /** Item copiado do orçamento aprovado */
  orcamentoServicoId?: string | null;
  executado?: boolean | null;
  /** Algum material desta linha já foi separado, consumido ou devolvido */
  materialMovimentado?: boolean;
}

/**
 * Por que ESTA linha da OS não pode ser editada — ou null. O documento fechado vem primeiro (vale para
 * todas as linhas); depois, o motivo da própria linha.
 */
export function motivoDaLinhaDaOs(linha: LinhaDaOs, situacao: SituacaoDoRegistro | null | undefined): string | null {
  const fechado = motivoDaTrava(situacao);
  if (fechado) return fechado;
  if (linha.materialId) return TRAVA_LINHA_PECA;
  if (linha.orcamentoServicoId) return TRAVA_LINHA_DO_ORCAMENTO;
  if (linha.executado) return TRAVA_LINHA_EXECUTADA;
  if (linha.materialMovimentado) return TRAVA_LINHA_SEPARADA;
  return null;
}

/** Algum material da linha já saiu do estoque para ela (separado, consumido ou devolvido)? */
export function temMaterialMovimentado(materiais: readonly { quantidadeSeparada?: unknown; quantidadeConsumida?: unknown; quantidadeDevolvida?: unknown }[] | null | undefined): boolean {
  return (materiais ?? []).some((m) => Number(m.quantidadeSeparada ?? 0) > 0 || Number(m.quantidadeConsumida ?? 0) > 0 || Number(m.quantidadeDevolvida ?? 0) > 0);
}

/**
 * Por que ESTA linha do orçamento não pode ser editada — ou null. Aprovado, faturado e nota emitida são
 * registro fechado; enviado, reprovado e cancelado seguem a regra de sempre (só rascunho se edita).
 */
export function motivoDaLinhaDoOrcamento(
  linha: { materialId?: string | null },
  orcamento: { status?: string | null; faturado?: boolean; notaEmitida?: boolean },
): string | null {
  const fechado = motivoDaTrava({ statusOrcamento: orcamento.status ?? null, faturado: !!orcamento.faturado, notaEmitida: !!orcamento.notaEmitida });
  if (fechado) return fechado;
  if (orcamento.status === "ENVIADO") return TRAVA_ORCAMENTO_ENVIADO;
  if (orcamento.status === "REPROVADO") return TRAVA_ORCAMENTO_REPROVADO;
  if (orcamento.status === "CANCELADO") return TRAVA_ORCAMENTO_CANCELADO;
  if (linha.materialId) return TRAVA_LINHA_PECA;
  return null;
}

/**
 * O número que a pessoa digitou num campo de texto do painel ("1.250,50", "2,5", "3") — ou null quando não
 * é um número (nada de gravar zero por causa de um erro de digitação).
 */
export function numeroDoCampo(texto: string | null | undefined): number | null {
  const t = (texto ?? "").trim().replace(/^R\$\s*/, "");
  // À brasileira: ponto de milhar ("1.250" = mil duzentos e cinquenta) e vírgula decimal
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  // Sem milhar: vírgula ou ponto como decimal ("2,5" ou "2.5")
  if (/^\d+([.,]\d+)?$/.test(t)) return Number(t.replace(",", "."));
  return null;
}

/** O número como o campo de texto do painel mostra (vírgula decimal; `casas` fixa os centavos). */
export const numeroParaCampo = (n: number, casas?: number) => (casas == null ? String(n) : n.toFixed(casas)).replace(".", ",");
