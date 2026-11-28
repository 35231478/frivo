/**
 * JORNADA DO COLABORADOR em FAIXAS (Leva J) — regra pura: ficha, contrato, documentos e testes usam as mesmas funções.
 *
 * Antes havia um conjunto de dias com UM horário (jornadaDias + jornadaEntrada/jornadaSaida). Agora a jornada é uma
 * lista de faixas, cada uma com os SEUS dias, a entrada, a saída e o intervalo (opcional):
 *   Seg–Qui 07:30–17:30 (intervalo 12:00–13:00) · Sex 07:30–16:30 (intervalo 12:00–13:00)
 * Um dia não pode estar em duas faixas. O contador soma as horas de cada dia (saída − entrada − intervalo) e a semana.
 *
 * Compatível com o que já está gravado: quem não tem faixas ganha UMA faixa com os dias e o horário antigos (sem
 * intervalo). Ao salvar, os campos antigos continuam preenchidos (os dias de todas as faixas e o horário da 1ª), para
 * quem ainda os lê.
 */

import { textoJornada } from "@/lib/admissao/admissao";

export const DIAS_SEMANA = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"] as const;
export type DiaSemana = (typeof DIAS_SEMANA)[number];
export const ROTULO_DIA: Record<DiaSemana, string> = { SEG: "Seg", TER: "Ter", QUA: "Qua", QUI: "Qui", SEX: "Sex", SAB: "Sáb", DOM: "Dom" };
export const ehDia = (v: unknown): v is DiaSemana => typeof v === "string" && (DIAS_SEMANA as readonly string[]).includes(v);

export interface FaixaJornada {
  dias: DiaSemana[];
  entrada: string;
  saida: string;
  /** Intervalo (almoço): os dois ou nenhum */
  intervaloInicio: string | null;
  intervaloFim: string | null;
}

export const FAIXAS_MAX = 7;

/** "07:30" → 450; inválido → null (só HH:MM de 00:00 a 23:59) */
export function minutosDaHora(h: string | null | undefined): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec((h ?? "").trim());
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  return hh <= 23 && mm <= 59 ? hh * 60 + mm : null;
}

/** Dias em ordem de semana, sem repetir */
export const ordenarDias = (dias: readonly string[]): DiaSemana[] => DIAS_SEMANA.filter((d) => dias.includes(d));

/** Os minutos trabalhados num dia desta faixa (saída − entrada − intervalo); null = faixa inválida */
export function minutosDaFaixa(f: FaixaJornada): number | null {
  const e = minutosDaHora(f.entrada), s = minutosDaHora(f.saida);
  if (e === null || s === null || s <= e) return null;
  const temIni = !!(f.intervaloInicio ?? "").trim(), temFim = !!(f.intervaloFim ?? "").trim();
  if (!temIni && !temFim) return s - e;
  const ii = minutosDaHora(f.intervaloInicio), fi = minutosDaHora(f.intervaloFim);
  if (ii === null || fi === null || fi <= ii || ii < e || fi > s) return null;
  return s - e - (fi - ii);
}

/** O que está errado em cada faixa (vazio = ok) e o dia repetido entre faixas */
export function problemasDaJornada(faixas: readonly FaixaJornada[]): { faixas: string[][]; geral: string[] } {
  const visto = new Map<DiaSemana, number>();
  const geral: string[] = [];
  if (faixas.length > FAIXAS_MAX) geral.push(`No máximo ${FAIXAS_MAX} faixas.`);
  const porFaixa = faixas.map((f, i) => {
    const p: string[] = [];
    if (!f.dias.length) p.push("Escolha os dias desta faixa.");
    const e = minutosDaHora(f.entrada), s = minutosDaHora(f.saida);
    if (e === null || s === null) p.push("Informe a entrada e a saída (hh:mm).");
    else if (s <= e) p.push("A saída tem de ser depois da entrada.");
    const temIni = !!(f.intervaloInicio ?? "").trim(), temFim = !!(f.intervaloFim ?? "").trim();
    if (temIni !== temFim) p.push("Informe o início e o fim do intervalo (ou deixe os dois em branco).");
    else if (temIni && e !== null && s !== null && s > e) {
      const ii = minutosDaHora(f.intervaloInicio), fi = minutosDaHora(f.intervaloFim);
      if (ii === null || fi === null) p.push("Intervalo inválido (hh:mm).");
      else if (fi <= ii) p.push("O fim do intervalo tem de ser depois do início.");
      else if (ii < e || fi > s) p.push("O intervalo tem de ficar dentro do horário.");
    }
    for (const d of f.dias) {
      const j = visto.get(d);
      if (j !== undefined) p.push(`${ROTULO_DIA[d]} já está na faixa ${j + 1}.`);
      else visto.set(d, i);
    }
    return p;
  });
  return { faixas: porFaixa, geral };
}

export const jornadaValida = (faixas: readonly FaixaJornada[]) => {
  const p = problemasDaJornada(faixas);
  return !p.geral.length && p.faixas.every((x) => !x.length);
};

/** As horas de cada dia e da semana (só as faixas válidas contam) */
export function horasDaJornada(faixas: readonly FaixaJornada[]): { porDia: Partial<Record<DiaSemana, number>>; semana: number } {
  const porDia: Partial<Record<DiaSemana, number>> = {};
  for (const f of faixas) {
    const m = minutosDaFaixa(f);
    if (m === null) continue;
    for (const d of f.dias) if (porDia[d] === undefined) porDia[d] = m;
  }
  return { porDia, semana: Object.values(porDia).reduce((s: number, m) => s + (m ?? 0), 0) };
}

/** 2640 → "44h"; 510 → "8h30"; 0 → "0h" */
export function textoHoras(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/* ───────── leitura do que está gravado (com o legado) e escrita ───────── */

function lerFaixa(v: unknown): FaixaJornada | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const dias = Array.isArray(o.dias) ? ordenarDias(o.dias.filter(ehDia)) : [];
  const hora = (x: unknown) => (typeof x === "string" && minutosDaHora(x) !== null ? x.trim() : "");
  return { dias, entrada: hora(o.entrada), saida: hora(o.saida), intervaloInicio: hora(o.intervaloInicio) || null, intervaloFim: hora(o.intervaloFim) || null };
}

/** A jornada do colaborador: as faixas gravadas ou, sem elas, a jornada antiga como UMA faixa (sem intervalo) */
export function faixasDoColaborador(c: { jornadaFaixas?: unknown; jornadaEntrada?: string | null; jornadaSaida?: string | null; jornadaDias?: readonly string[] | null }): FaixaJornada[] {
  if (Array.isArray(c.jornadaFaixas)) {
    const lidas = c.jornadaFaixas.map(lerFaixa).filter((f): f is FaixaJornada => !!f);
    if (lidas.length) return lidas;
  }
  const dias = ordenarDias(c.jornadaDias ?? []);
  if (!c.jornadaEntrada && !c.jornadaSaida && !dias.length) return [];
  return [{ dias, entrada: c.jornadaEntrada ?? "", saida: c.jornadaSaida ?? "", intervaloInicio: null, intervaloFim: null }];
}

/** O que vai para o banco: as faixas e os campos antigos (dias de todas; o horário da 1ª faixa) */
export function gravarJornada(faixas: readonly FaixaJornada[]) {
  const limpas = faixas.map((f) => ({
    dias: ordenarDias(f.dias), entrada: f.entrada.trim(), saida: f.saida.trim(),
    intervaloInicio: (f.intervaloInicio ?? "").trim() || null, intervaloFim: (f.intervaloFim ?? "").trim() || null,
  }));
  const primeira = limpas[0];
  return {
    jornadaFaixas: limpas.length ? limpas : null,
    jornadaDias: ordenarDias(limpas.flatMap((f) => f.dias)),
    jornadaEntrada: primeira?.entrada || null,
    jornadaSaida: primeira?.saida || null,
  };
}

/**
 * O texto do contrato e dos documentos. Cada faixa no MESMO formato de antes ("07:00 às 16:00, de segunda a sexta"),
 * com o intervalo quando há; as faixas separadas por ponto e vírgula. As horas da semana entram quando a jornada é
 * das novas (mais de uma faixa ou com intervalo): a jornada antiga, de uma faixa sem intervalo, sai exatamente como
 * saía — os modelos de contrato das empresas continuam lendo igual.
 *   "07:30 às 17:30, de segunda a quinta, com intervalo de 12:00 às 13:00; 07:30 às 16:30, sexta, com intervalo de
 *    12:00 às 13:00 — 44h semanais". Vazio quando não há jornada.
 */
export function textoDaJornada(faixas: readonly FaixaJornada[]): string {
  const validas = faixas.filter((f) => f.dias.length || (f.entrada && f.saida));
  const partes = validas.map((f) => {
    const intervalo = f.intervaloInicio && f.intervaloFim ? `com intervalo de ${f.intervaloInicio} às ${f.intervaloFim}` : "";
    return [textoJornada({ entrada: f.entrada, saida: f.saida, dias: f.dias }), intervalo].filter(Boolean).join(", ");
  }).filter(Boolean);
  if (!partes.length) return "";
  const nova = validas.length > 1 || validas.some((f) => f.intervaloInicio && f.intervaloFim);
  const { semana } = horasDaJornada(validas);
  return `${partes.join("; ")}${nova && semana > 0 ? ` — ${textoHoras(semana)} semanais` : ""}`;
}

/** Uma faixa nova: os dias que ainda estão livres (de segunda a sexta), no horário comercial */
export function faixaNova(existentes: readonly FaixaJornada[]): FaixaJornada {
  const usados = new Set(existentes.flatMap((f) => f.dias));
  const livres = (["SEG", "TER", "QUA", "QUI", "SEX"] as DiaSemana[]).filter((d) => !usados.has(d));
  return { dias: livres, entrada: "08:00", saida: "17:00", intervaloInicio: "12:00", intervaloFim: "13:00" };
}

/**
 * O que a rota grava a partir do corpo: com as faixas, elas mandam (e os campos antigos são refeitos delas); sem as
 * faixas (cliente antigo, importação), valem os campos antigos e as faixas saem — senão uma faixa velha passaria por
 * cima do horário que acabou de ser salvo.
 */
export function jornadaDoCorpo(d: { jornadaFaixas?: FaixaJornada[]; jornadaEntrada?: string; jornadaSaida?: string; jornadaDias?: string[] }) {
  if (d.jornadaFaixas) return gravarJornada(d.jornadaFaixas);
  return { jornadaFaixas: null, jornadaEntrada: d.jornadaEntrada || null, jornadaSaida: d.jornadaSaida || null, jornadaDias: ordenarDias(d.jornadaDias ?? []) };
}
