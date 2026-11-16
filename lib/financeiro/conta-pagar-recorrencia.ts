/**
 * DESPESA RECORRENTE (contas a pagar) — regras PURAS (sem banco), usadas pela tela, pela geração e
 * pela edição com escopo. O motor de datas é o MESMO do contrato recorrente
 * (lib/financeiro/contrato-previsao.ts): mesma soma de meses, mesmo "dia do mês" que respeita o fim
 * do mês e mesmo ajuste de fim de semana.
 *
 * Regras do módulo:
 *  - o valor é o de CADA ocorrência e NÃO multiplica (trimestral de R$ 900 = R$ 900 a cada 3 meses);
 *  - uma ocorrência por competência (mês/ano) — é o que o índice único do banco cobra;
 *  - término por competência final, por número de ocorrências, ou indefinido (horizonte rolante);
 *  - regra pausada ou encerrada não gera; a conta já gerada é independente e continua como está.
 */
import { ajustarFimDeSemana, diaDoMes, somarMeses } from "./contrato-previsao";

/* ───────── frequência ───────── */

export const FREQUENCIAS = [
  { id: "MENSAL", passo: 1, rotulo: "Mensal" },
  { id: "BIMESTRAL", passo: 2, rotulo: "Bimestral (a cada 2 meses)" },
  { id: "TRIMESTRAL", passo: 3, rotulo: "Trimestral (a cada 3 meses)" },
  { id: "QUADRIMESTRAL", passo: 4, rotulo: "Quadrimestral (a cada 4 meses)" },
  { id: "SEMESTRAL", passo: 6, rotulo: "Semestral (a cada 6 meses)" },
  { id: "ANUAL", passo: 12, rotulo: "Anual" },
] as const;
export type FrequenciaId = (typeof FREQUENCIAS)[number]["id"] | "CUSTOM";

/** Quantos meses no máximo entre uma ocorrência e a seguinte (5 anos) */
export const PASSO_MAX = 60;
export const passoValido = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= PASSO_MAX;

export const passoDaFrequencia = (id: string, custom?: number | null) =>
  FREQUENCIAS.find((f) => f.id === id)?.passo ?? Math.max(1, Math.min(PASSO_MAX, Math.floor(Number(custom ?? 1)) || 1));

/** A frequência que o passo representa — "CUSTOM" quando não é nenhuma das nomeadas */
export const frequenciaDoPasso = (passo: number): FrequenciaId => FREQUENCIAS.find((f) => f.passo === passo)?.id ?? "CUSTOM";

/** "Todo mês" · "A cada 3 meses" · "Todo ano" */
export function textoFrequencia(passo: number): string {
  if (passo <= 1) return "Todo mês";
  if (passo === 12) return "Todo ano";
  return `A cada ${passo} meses`;
}

/* ───────── a regra ───────── */

export const SITUACOES = ["ATIVA", "PAUSADA", "ENCERRADA"] as const;
export type SituacaoRecorrencia = (typeof SITUACOES)[number];
export const ROTULO_SITUACAO: Record<SituacaoRecorrencia, string> = {
  ATIVA: "Ativa", PAUSADA: "Pausada", ENCERRADA: "Encerrada",
};

export interface Competencia { ano: number; mes: number }

export interface RegraRecorrencia {
  passoMeses: number;
  diaVencimento: number;
  /** ADIANTAR | POSTERGAR | MANTER — o mesmo vocabulário do contrato */
  ajusteDiaNaoUtil?: string | null;
  inicioAno: number;
  inicioMes: number;
  /** Término por competência final (inclusive) */
  fimAno?: number | null;
  fimMes?: number | null;
  /** Término por número de ocorrências (conta a partir do início) */
  ocorrencias?: number | null;
  situacao?: string | null;
}

export const MIN_DIA = 1;
export const MAX_DIA = 31;
export const diaValido = (n: unknown) => Number.isInteger(n) && (n as number) >= MIN_DIA && (n as number) <= MAX_DIA;

const chave = (c: Competencia) => c.ano * 12 + (c.mes - 1);
export const competenciaAntes = (a: Competencia, b: Competencia) => chave(a) < chave(b);
export const mesmaCompetencia = (a: Competencia, b: Competencia) => chave(a) === chave(b);

/** "jan/2026" — o sufixo que cada conta gerada leva na descrição */
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloCompetencia = (ano: number, mes: number) => `${MESES_CURTOS[mes - 1]}/${ano}`;

/** "Aluguel do galpão" + jan/2026 → "Aluguel do galpão — jan/2026" */
export const descricaoDaOcorrencia = (descricao: string, ano: number, mes: number) =>
  `${descricao.trim()} — ${rotuloCompetencia(ano, mes)}`;

/**
 * Onde a regra começa: no mês corrente, se o dia de vencimento ainda não passou; no mês seguinte,
 * se já passou. (É a sugestão da tela; a pessoa pode escolher outro início.)
 */
export function inicioSugerido(hoje: { ano: number; mes: number; dia: number }, diaVencimento: number): Competencia {
  const atual = { ano: hoje.ano, mes: hoje.mes };
  return diaVencimento >= hoje.dia ? atual : somarMeses(atual.ano, atual.mes, 1);
}

/** O fim do horizonte rolante para uma regra sem término: hoje + `meses` (12 por padrão) */
export const horizonteRolante = (hoje: Competencia, meses = 12): Competencia => somarMeses(hoje.ano, hoje.mes, meses);

/**
 * As competências que a regra gera até `ate` (inclusive). Respeita o término por competência final
 * e por número de ocorrências — o que vier primeiro. Regra encerrada ou pausada não gera nada.
 */
export function competenciasDaRegra(regra: RegraRecorrencia, ate: Competencia): Competencia[] {
  if (regra.situacao === "ENCERRADA" || regra.situacao === "PAUSADA") return [];
  const passo = Math.max(1, Math.floor(regra.passoMeses || 1));
  const inicio: Competencia = { ano: regra.inicioAno, mes: regra.inicioMes };
  const limite = regra.fimAno && regra.fimMes ? { ano: regra.fimAno, mes: regra.fimMes } : null;
  const maximo = regra.ocorrencias && regra.ocorrencias > 0 ? Math.floor(regra.ocorrencias) : null;

  const lista: Competencia[] = [];
  let atual = inicio;
  // o teto de segurança (nunca gera mais que 5 anos de uma vez) protege de passo inválido
  for (let i = 0; i < 61; i++) {
    if (maximo != null && lista.length >= maximo) break;
    if (limite && competenciaAntes(limite, atual)) break;
    if (competenciaAntes(ate, atual)) break;
    lista.push(atual);
    atual = somarMeses(atual.ano, atual.mes, passo);
  }
  return lista;
}

/** Quantas ocorrências a regra ainda tem depois de `depois` (null = indefinido) */
export function ocorrenciasRestantes(regra: RegraRecorrencia, depois: Competencia): number | null {
  if (!regra.ocorrencias && !(regra.fimAno && regra.fimMes)) return null;
  const longe = somarMeses(depois.ano, depois.mes, PASSO_MAX * 12);
  return competenciasDaRegra(regra, longe).filter((c) => competenciaAntes(depois, c)).length;
}

/** O vencimento da ocorrência: o dia da regra no mês, já ajustado quando cai em fim de semana. */
export function vencimentoDaOcorrencia(regra: Pick<RegraRecorrencia, "diaVencimento" | "ajusteDiaNaoUtil">, ano: number, mes: number): Date {
  const dia = diaDoMes(ano, mes - 1, Math.max(MIN_DIA, Math.min(MAX_DIA, regra.diaVencimento)));
  return ajustarFimDeSemana(dia, regra.ajusteDiaNaoUtil ?? "MANTER");
}

/** "Todo mês, dia 10 · R$ 2.500,00 · até dez/2027" — o resumo que a tela mostra */
export function resumoDaRegra(regra: RegraRecorrencia & { valor?: number | null; valorEstimado?: boolean }, formatarMoeda: (v: number) => string): string {
  const partes = [`${textoFrequencia(regra.passoMeses)}, dia ${regra.diaVencimento}`];
  if (regra.valor != null) partes.push(`${formatarMoeda(Number(regra.valor))}${regra.valorEstimado ? " (estimado)" : ""}`);
  if (regra.fimAno && regra.fimMes) partes.push(`até ${rotuloCompetencia(regra.fimAno, regra.fimMes)}`);
  else if (regra.ocorrencias) partes.push(regra.ocorrencias === 1 ? "1 ocorrência" : `${regra.ocorrencias} ocorrências`);
  else partes.push("sem data para terminar");
  return partes.join(" · ");
}

/* ───────── o formulário da tela ───────── */

export const TERMINOS = ["INDEFINIDO", "DATA", "OCORRENCIAS"] as const;
export type TerminoId = (typeof TERMINOS)[number];
export const ROTULO_TERMINO: Record<TerminoId, string> = {
  INDEFINIDO: "Sem data para terminar",
  DATA: "Até um mês",
  OCORRENCIAS: "Depois de N ocorrências",
};
export const AJUDA_TERMINO = "Sem data para terminar, o sistema mantém sempre uns 12 meses de contas geradas à frente e vai empurrando esse horizonte sozinho.";

/** O formulário guarda texto (é o que o <input> devolve); `corpoDaRecorrencia` converte. */
export interface FormRecorrencia {
  /** meses entre uma ocorrência e a próxima (1 = todo mês) — é ele que manda */
  passoMeses: string;
  diaVencimento: string;
  ajusteDiaNaoUtil: string;
  inicioAno: string;
  inicioMes: string;
  termino: TerminoId;
  fimAno: string;
  fimMes: string;
  ocorrencias: string;
  valorEstimado: boolean;
}

/** O formulário como a tela abre: mensal, dia do vencimento escolhido (ou hoje) e início sugerido. */
export function formRecorrenciaInicial(hoje: { ano: number; mes: number; dia: number }, diaVencimento?: number | null): FormRecorrencia {
  const dia = diaValido(diaVencimento) ? (diaVencimento as number) : hoje.dia;
  const inicio = inicioSugerido(hoje, dia);
  return {
    passoMeses: "1", diaVencimento: String(dia), ajusteDiaNaoUtil: "MANTER",
    inicioAno: String(inicio.ano), inicioMes: String(inicio.mes),
    termino: "INDEFINIDO", fimAno: "", fimMes: "", ocorrencias: "", valorEstimado: false,
  };
}

/** O formulário preenchido com uma regra que já existe (para editar). */
export function formDaRegra(r: RegraRecorrencia & { valorEstimado?: boolean | null }): FormRecorrencia {
  const passo = Math.max(1, Math.floor(r.passoMeses || 1));
  return {
    passoMeses: String(passo),
    diaVencimento: String(r.diaVencimento), ajusteDiaNaoUtil: r.ajusteDiaNaoUtil || "MANTER",
    inicioAno: String(r.inicioAno), inicioMes: String(r.inicioMes),
    termino: r.fimAno && r.fimMes ? "DATA" : r.ocorrencias ? "OCORRENCIAS" : "INDEFINIDO",
    fimAno: r.fimAno ? String(r.fimAno) : "", fimMes: r.fimMes ? String(r.fimMes) : "",
    ocorrencias: r.ocorrencias ? String(r.ocorrencias) : "", valorEstimado: !!r.valorEstimado,
  };
}

const inteiro = (v: string) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : NaN; };

/**
 * O que a tela manda para a API. O término escolhido manda nos campos: "até um mês" leva só a
 * competência final, "N ocorrências" leva só o número, "sem data" não leva nenhum dos dois (é o que
 * o servidor cobra em `validarRegra`: os dois juntos são recusados).
 */
export function corpoDaRecorrencia(f: FormRecorrencia) {
  return {
    passoMeses: inteiro(f.passoMeses),
    diaVencimento: inteiro(f.diaVencimento),
    ajusteDiaNaoUtil: f.ajusteDiaNaoUtil || "MANTER",
    inicioAno: inteiro(f.inicioAno),
    inicioMes: inteiro(f.inicioMes),
    fimAno: f.termino === "DATA" && f.fimAno ? inteiro(f.fimAno) : null,
    fimMes: f.termino === "DATA" && f.fimMes ? inteiro(f.fimMes) : null,
    ocorrencias: f.termino === "OCORRENCIAS" && f.ocorrencias ? inteiro(f.ocorrencias) : null,
    valorEstimado: !!f.valorEstimado,
  };
}

/** Os anos que o seletor de competência oferece: do ano corrente até 5 à frente. */
export const anosDoSeletor = (ano: number) => Array.from({ length: 6 }, (_, i) => ano + i);

/* ───────── atalhos de repetição e prévia ───────── */

/**
 * Os atalhos do seletor "Configurações de repetição" — o que quase todo mundo escolhe, sem abrir
 * o "Personalizar…". Cada um é a regra inteira (passo + término), como o rótulo diz.
 */
export const ATALHOS_REPETICAO = [
  { id: "MENSAL_SEM_FIM", passoMeses: 1, ocorrencias: null, rotulo: "Mensal: todo mês, sem data para terminar" },
  { id: "MENSAL_12", passoMeses: 1, ocorrencias: 12, rotulo: "Mensal: todo mês, 12 vezes" },
  { id: "MENSAL_24", passoMeses: 1, ocorrencias: 24, rotulo: "Mensal: todo mês, 24 vezes" },
  { id: "TRIMESTRAL_SEM_FIM", passoMeses: 3, ocorrencias: null, rotulo: "Trimestral: a cada 3 meses, sem data para terminar" },
  { id: "ANUAL_SEM_FIM", passoMeses: 12, ocorrencias: null, rotulo: "Anual: todo ano, sem data para terminar" },
] as const;
export type AtalhoId = (typeof ATALHOS_REPETICAO)[number]["id"] | "CUSTOM";
export const PERSONALIZAR = "CUSTOM";

/** O atalho que uma regra representa, ou "CUSTOM" quando ela não é nenhum deles. */
export function atalhoDaRegra(r: { passoMeses: number; ocorrencias?: number | null; fimAno?: number | null; fimMes?: number | null }): AtalhoId {
  if (r.fimAno && r.fimMes) return PERSONALIZAR;
  const a = ATALHOS_REPETICAO.find((x) => x.passoMeses === r.passoMeses && (x.ocorrencias ?? null) === (r.ocorrencias ?? null));
  return a?.id ?? PERSONALIZAR;
}

/** Como o seletor resume a regra quando ela não é um atalho: "A cada 2 meses, 18 vezes". */
export function textoRepeticao(r: { passoMeses: number; ocorrencias?: number | null; fimAno?: number | null; fimMes?: number | null }): string {
  const base = textoFrequencia(r.passoMeses);
  if (r.fimAno && r.fimMes) return `${base}, até ${rotuloCompetencia(r.fimAno, r.fimMes)}`;
  if (r.ocorrencias) return `${base}, ${r.ocorrencias} ${r.ocorrencias === 1 ? "vez" : "vezes"}`;
  return `${base}, sem data para terminar`;
}

/** Uma linha da prévia "Recorrências previstas" (o que a pessoa vê ANTES de salvar). */
export interface PreviaOcorrencia { ano: number; mes: number; vencimento: Date; descricao: string; valor: number }

/**
 * A prévia das contas que a regra vai abrir. Com término (data ou número) mostra TODAS; sem
 * término, os meses do horizonte rolante — que é exatamente o que o sistema gera de uma vez.
 */
export function previaDaRegra(
  regra: RegraRecorrencia & { descricao?: string; valor?: number | null },
  hoje: Competencia,
  meses = 12,
): PreviaOcorrencia[] {
  const limite = regra.fimAno && regra.fimMes ? { ano: regra.fimAno, mes: regra.fimMes } : horizonteRolante(hoje, meses);
  return competenciasDaRegra({ ...regra, situacao: "ATIVA" }, limite)
    .filter((c) => !competenciaAntes(c, hoje))
    .map((c) => ({
      ano: c.ano, mes: c.mes,
      vencimento: vencimentoDaOcorrencia(regra, c.ano, c.mes),
      descricao: descricaoDaOcorrencia(regra.descricao ?? "", c.ano, c.mes),
      valor: Number(regra.valor ?? 0),
    }));
}

/* ───────── editar com escopo ───────── */

export const ESCOPOS = ["ESTA", "ESTA_E_PROXIMAS"] as const;
export type EscopoEdicao = (typeof ESCOPOS)[number];
export const ROTULO_ESCOPO: Record<EscopoEdicao, string> = {
  ESTA: "Só esta ocorrência",
  ESTA_E_PROXIMAS: "Esta e as próximas em aberto",
};
export const AJUDA_ESCOPO: Record<EscopoEdicao, string> = {
  ESTA: "O ajuste vale só para este mês. A regra continua como está.",
  ESTA_E_PROXIMAS: "Muda a regra daqui para a frente e as contas futuras que ainda não foram pagas. As já pagas não mudam.",
};

/** Uma ocorrência já gerada, do ponto de vista da edição */
export interface OcorrenciaGerada {
  id: string;
  refAno: number | null;
  refMes: number | null;
  status: string;
  valorPago?: number | null;
}

/** Conta paga (total ou parcial) nunca muda por edição de regra — nem conta cancelada. */
export const ocorrenciaEditavel = (c: OcorrenciaGerada) =>
  c.status !== "PAGO_TOTAL" && c.status !== "PAGO_PARCIAL" && c.status !== "CANCELADO" && !(Number(c.valorPago ?? 0) > 0);

/**
 * Quais ocorrências a edição alcança. "ESTA": só a que a pessoa abriu. "ESTA_E_PROXIMAS": ela e as
 * de competência posterior — sempre apenas as que ainda dá para mexer (nunca as pagas).
 */
export function ocorrenciasDoEscopo(contas: OcorrenciaGerada[], alvo: OcorrenciaGerada, escopo: EscopoEdicao): OcorrenciaGerada[] {
  if (escopo === "ESTA") return ocorrenciaEditavel(alvo) ? [alvo] : [];
  const refAlvo = alvo.refAno && alvo.refMes ? { ano: alvo.refAno, mes: alvo.refMes } : null;
  return contas.filter((c) => {
    if (!ocorrenciaEditavel(c)) return false;
    if (c.id === alvo.id) return true;
    if (!refAlvo || !c.refAno || !c.refMes) return false;
    return competenciaAntes(refAlvo, { ano: c.refAno, mes: c.refMes });
  });
}

/** O que muda na REGRA quando o escopo é "esta e as próximas": a regra passa a valer do alvo em diante. */
export function regraDoEscopo(regra: RegraRecorrencia, alvo: Competencia, mudancas: Partial<RegraRecorrencia> & { valor?: number }): Partial<RegraRecorrencia> & { valor?: number } {
  // o início da regra só anda para a frente: competência anterior à atual não é reescrita
  const inicio = competenciaAntes({ ano: regra.inicioAno, mes: regra.inicioMes }, alvo) ? alvo : { ano: regra.inicioAno, mes: regra.inicioMes };
  return { ...mudancas, inicioAno: inicio.ano, inicioMes: inicio.mes };
}

/* ───────── mensagens ───────── */

export const MSG_SEM_PERMISSAO = "Sem permissão para esta ação";
export const MSG_DIA_INVALIDO = "Dia de vencimento: de 1 a 31.";
export const MSG_PASSO_INVALIDO = `Repetir a cada: de 1 a ${PASSO_MAX} meses.`;
export const MSG_VALOR_INVALIDO = "Informe o valor de cada ocorrência.";
export const MSG_TERMINO_INVALIDO = "Término: escolha uma data final, um número de ocorrências, ou deixe indefinido.";
export const MSG_FIM_ANTES_DO_INICIO = "O término não pode ser antes do início.";
export const MSG_ENCERRADA = "Esta despesa recorrente já foi encerrada.";
export const MSG_JA_RECORRENTE = "Esta conta já faz parte de uma despesa recorrente.";
export const MSG_CONTA_PAGA = "Conta já paga não muda: lance um estorno ou um ajuste.";

/** Valida a regra inteira; devolve a primeira mensagem de erro, ou null quando está boa. */
export function validarRegra(r: Partial<RegraRecorrencia> & { valor?: unknown; descricao?: string }): string | null {
  if (!r.descricao?.trim()) return "Descreva a despesa (ex.: Aluguel do galpão).";
  if (!diaValido(r.diaVencimento)) return MSG_DIA_INVALIDO;
  if (!passoValido(r.passoMeses)) return MSG_PASSO_INVALIDO;
  const valor = Number(r.valor);
  if (!Number.isFinite(valor) || valor <= 0) return MSG_VALOR_INVALIDO;
  if (!Number.isInteger(r.inicioAno) || !Number.isInteger(r.inicioMes) || (r.inicioMes as number) < 1 || (r.inicioMes as number) > 12) return "Início inválido.";
  if (r.ocorrencias != null && (!Number.isInteger(r.ocorrencias) || r.ocorrencias < 1)) return MSG_TERMINO_INVALIDO;
  if ((r.fimAno == null) !== (r.fimMes == null)) return MSG_TERMINO_INVALIDO;
  if (r.fimAno != null && r.ocorrencias != null) return MSG_TERMINO_INVALIDO;
  if (r.fimAno != null && r.fimMes != null && competenciaAntes({ ano: r.fimAno, mes: r.fimMes }, { ano: r.inicioAno as number, mes: r.inicioMes as number })) return MSG_FIM_ANTES_DO_INICIO;
  return null;
}
