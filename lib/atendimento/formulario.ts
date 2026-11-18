/**
 * PRAZO DE ATENDIMENTO no formulário do contrato — do que está gravado para o que a tela mostra, e
 * de volta. Sem banco e sem tela.
 *
 * A tela começa simples: UM prazo para todo chamado (comparecer em X h, resolver em Y h). Quem
 * precisa de prazos diferentes por prioridade abre "Definir por prioridade". No banco é sempre uma
 * linha por prioridade; o modo simples grava as cinco iguais.
 */
import { PRIORIDADES, type PrioridadeOs, type RegraAtendimento } from "./prazo";

export interface HorasDigitadas { comparecer: string; resolver: string }
export interface PrazosDoFormulario {
  /** false = um prazo para todo chamado; true = um por prioridade */
  porPrioridade: boolean;
  geral: HorasDigitadas;
  linhas: Record<PrioridadeOs, HorasDigitadas>;
  soHorarioComercial: boolean;
}

const EM_BRANCO: HorasDigitadas = { comparecer: "", resolver: "" };
const digitado = (h: number | null) => (h == null ? "" : String(h));
const linhasEmBranco = () => Object.fromEntries(PRIORIDADES.map((p) => [p, { ...EM_BRANCO }])) as Record<PrioridadeOs, HorasDigitadas>;

export const PRAZOS_EM_BRANCO = (): PrazosDoFormulario => ({ porPrioridade: false, geral: { ...EM_BRANCO }, linhas: linhasEmBranco(), soHorarioComercial: false });

/**
 * Do que o contrato tem gravado para a tela. Abre no modo simples quando não há nada ou quando as
 * cinco prioridades prometem a mesma coisa; qualquer diferença abre "por prioridade", para nada
 * ficar escondido.
 */
export function prazosParaOFormulario(regras: RegraAtendimento[] | null | undefined): PrazosDoFormulario {
  const lista = regras ?? [];
  if (!lista.length) return PRAZOS_EM_BRANCO();
  const linhas = linhasEmBranco();
  for (const r of lista) if ((PRIORIDADES as readonly string[]).includes(r.prioridade)) linhas[r.prioridade as PrioridadeOs] = { comparecer: digitado(r.comparecerHoras), resolver: digitado(r.resolverHoras) };
  const primeira = linhas[PRIORIDADES[0]];
  const todasIguais = PRIORIDADES.every((p) => linhas[p].comparecer === primeira.comparecer && linhas[p].resolver === primeira.resolver);
  return {
    porPrioridade: !todasIguais,
    geral: todasIguais ? { ...primeira } : { ...EM_BRANCO },
    linhas,
    // O marcador vale para o contrato inteiro na tela (marcado se qualquer linha contar só o expediente)
    soHorarioComercial: lista.some((r) => r.soHorarioComercial),
  };
}

/** "" → sem prazo; número inteiro → o número; qualquer outra coisa segue como veio (a validação recusa com a mensagem certa) */
const horas = (texto: string): number | null | string => {
  const t = texto.trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : t;
};

/**
 * Da tela para o que o servidor recebe (`prazosAtendimento`): uma linha por prioridade que promete
 * alguma coisa. Prioridade com os dois campos em branco não entra — o contrato não promete nada para
 * ela. No modo simples, as cinco prioridades recebem o mesmo prazo.
 */
export function prazosDoFormulario(f: PrazosDoFormulario): { prioridade: PrioridadeOs; comparecerHoras: unknown; resolverHoras: unknown; soHorarioComercial: boolean }[] {
  return PRIORIDADES.flatMap((prioridade) => {
    const h = f.porPrioridade ? f.linhas[prioridade] : f.geral;
    const comparecerHoras = horas(h.comparecer), resolverHoras = horas(h.resolver);
    if (comparecerHoras === null && resolverHoras === null) return [];
    return [{ prioridade, comparecerHoras, resolverHoras, soHorarioComercial: f.soHorarioComercial }];
  });
}

/** Passar de "um prazo para todos" a "por prioridade" leva o prazo geral para as cinco linhas (nada se perde na troca). */
export function abrirPorPrioridade(f: PrazosDoFormulario): PrazosDoFormulario {
  if (f.porPrioridade) return f;
  return { ...f, porPrioridade: true, linhas: Object.fromEntries(PRIORIDADES.map((p) => [p, { ...f.geral }])) as Record<PrioridadeOs, HorasDigitadas> };
}

/** Voltar ao prazo único: vale o da prioridade Normal (a mais comum), e as cinco passam a ser iguais. */
export function voltarAoPrazoUnico(f: PrazosDoFormulario): PrazosDoFormulario {
  if (!f.porPrioridade) return f;
  return { ...f, porPrioridade: false, geral: { ...f.linhas.NORMAL } };
}
