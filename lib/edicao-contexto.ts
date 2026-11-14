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
 * E registro FECHADO não se edita: faturado, OS concluída ou assinada pelo cliente, orçamento aprovado
 * pelo cliente, nota emitida. A trava vale para o USO (a linha do registro fechado); o cadastro-mãe
 * continua sendo editado no cadastro dele.
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
  /** Status da OS ("CONCLUIDA" = concluída) */
  statusOs?: string | null;
  /** Status do orçamento ("APROVADO" ou "CONVERTIDA" = aprovado pelo cliente) */
  statusOrcamento?: string | null;
}

export const TRAVA_NOTA = "Nota fiscal emitida: este registro não pode mais ser editado.";
export const TRAVA_FATURADO = "Já faturado: este registro não pode mais ser editado.";
export const TRAVA_ASSINADA = "OS assinada pelo cliente: este registro não pode mais ser editado.";
export const TRAVA_CONCLUIDA = "OS concluída: este registro não pode mais ser editado.";
export const TRAVA_APROVADO = "Orçamento aprovado pelo cliente: este registro não pode mais ser editado.";

/**
 * Por que o registro está travado para edição — ou null, se dá para editar. Quando mais de um motivo
 * vale, fica o mais definitivo (nota > faturado > assinada > concluída > orçamento aprovado).
 */
export function motivoDaTrava(r: SituacaoDoRegistro | null | undefined): string | null {
  if (!r) return null;
  if (r.notaEmitida) return TRAVA_NOTA;
  if (r.faturado) return TRAVA_FATURADO;
  if (r.aceite === "CONFIRMADO") return TRAVA_ASSINADA;
  if (r.statusOs === "CONCLUIDA") return TRAVA_CONCLUIDA;
  if (r.statusOrcamento === "APROVADO" || r.statusOrcamento === "CONVERTIDA") return TRAVA_APROVADO;
  return null;
}

/** Os campos que mudaram (o que vai para o servidor): compara aparado, e vazio conta como mudança para vazio. */
export function camposAlterados(antes: Record<string, string | null | undefined>, depois: Record<string, string | null | undefined>, campos: readonly string[]): string[] {
  const limpo = (v: string | null | undefined) => (v ?? "").trim();
  return campos.filter((c) => limpo(antes[c]) !== limpo(depois[c]));
}
