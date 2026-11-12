/**
 * PMOC — RENOVAÇÃO anual: regras puras (tela e servidor; sem banco).
 *
 * Renovar cria um plano NOVO, em rascunho, para a próxima vigência, já com o que dá trabalho remontar:
 * cliente, unidade, responsável técnico, texto técnico, os equipamentos ATIVOS e o CRONOGRAMA inteiro,
 * com o início de cada item deslocado para a nova vigência.
 *
 * Não vai: a ART (número e arquivo — cada ano tem a sua), o link público, o histórico, os avisos e as
 * OS já geradas. Item que apontava para um equipamento inativado também fica de fora.
 *
 * O deslocamento dos itens: o item que começava junto com o plano (ou antes) começa junto com o plano
 * novo; os demais andam o mesmo número de meses que o início do plano andou — numa renovação de um
 * ano, o mesmo dia e mês no ano seguinte. Nenhum item começa antes do plano novo.
 */
import { z } from "zod";
import { dataBR } from "@/lib/pmoc";
import type { FimSemana } from "@/lib/pmoc-cronograma";

/* ───────── datas ("AAAA-MM-DD", sem hora) ───────── */

const partes = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const montar = (d: Date) => d.toISOString().slice(0, 10);

export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = partes(iso);
  return montar(new Date(Date.UTC(a, m - 1, d + dias)));
}

/** Soma meses de calendário; dia que não existe no mês de chegada (31, 30, 29) vira o último dia dele */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = partes(iso);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12), mes = total - ano * 12;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return montar(new Date(Date.UTC(ano, mes, Math.min(d, ultimoDia))));
}

/** O último dia de uma vigência de um ano que começa em `iso` (12/11/2026 → 11/11/2027) */
export function umAnoDepois(iso: string): string {
  const [a, m, d] = partes(iso);
  return montar(new Date(Date.UTC(a + 1, m - 1, d - 1)));
}

export interface Vigencia { dataInicio: string; dataExpiracao: string }

/** A vigência proposta para a renovação: começa no dia seguinte à expiração atual e vale um ano */
export function vigenciaProposta(dataExpiracaoAtual: string): Vigencia {
  const dataInicio = somarDias(dataExpiracaoAtual, 1);
  return { dataInicio, dataExpiracao: umAnoDepois(dataInicio) };
}

/** Quantos meses o início do plano andou (só ano e mês contam) */
export function mesesDeDeslocamento(inicioAntigo: string, inicioNovo: string): number {
  const [aa, ma] = partes(inicioAntigo), [an, mn] = partes(inicioNovo);
  return an * 12 + mn - (aa * 12 + ma);
}

/** O início do item no plano novo (ver a regra no cabeçalho do arquivo) */
export function deslocarInicioDoItem(inicioDoItem: string, inicioAntigo: string, inicioNovo: string): string {
  if (inicioDoItem <= inicioAntigo) return inicioNovo;
  const deslocado = somarMeses(inicioDoItem, mesesDeDeslocamento(inicioAntigo, inicioNovo));
  return deslocado < inicioNovo ? inicioNovo : deslocado;
}

/* ───────── nome do plano novo ───────── */

const ano = (iso: string) => iso.slice(0, 4);
export const NOME_MAX = 150;

/**
 * O nome proposto: os anos da vigência antiga que aparecem no nome viram os da nova ("PMOC 2027 —
 * Hospital" → "PMOC 2028 — Hospital"). Nome sem ano ganha o ano da nova vigência no fim.
 */
export function nomeDaRenovacao(nome: string, antiga: Vigencia, nova: Vigencia): string {
  const troca = new Map([[ano(antiga.dataInicio), ano(nova.dataInicio)], [ano(antiga.dataExpiracao), ano(nova.dataExpiracao)]]);
  const trocado = nome.replace(/(?<!\d)\d{4}(?!\d)/g, (a) => troca.get(a) ?? a);
  if (trocado !== nome) return trocado.slice(0, NOME_MAX);
  const anos = ano(nova.dataInicio) === ano(nova.dataExpiracao) ? ano(nova.dataInicio) : `${ano(nova.dataInicio)}/${ano(nova.dataExpiracao)}`;
  const sufixo = ` — ${anos}`;
  return `${nome.trim().slice(0, NOME_MAX - sufixo.length)}${sufixo}`;
}

/* ───────── o que vai e o que não vai ───────── */

export interface ItemDeOrigem {
  id: string; ativo: boolean;
  tipoEquipamentoId: string | null; equipamentoId: string | null; tipoOsId: string;
  /** "AAAA-MM-DD" */
  dataInicio: string;
  intervaloMeses: number; diaExecucao: number; fimSemana: FimSemana;
  /** ISO: a ordem em que os itens foram criados é o desempate da substituição */
  criadoEm: string;
}
export interface OrigemRenovacao {
  pmoc: Vigencia;
  /** Os equipamentos cobertos pelo plano de origem */
  equipamentos: { id: string; ativo: boolean }[];
  itens: ItemDeOrigem[];
}

export type MotivoFora = "EQUIPAMENTO_INATIVO" | "DEPOIS_DA_EXPIRACAO";
export const TEXTO_MOTIVO_FORA: Record<MotivoFora, string> = {
  EQUIPAMENTO_INATIVO: "o equipamento está inativo",
  DEPOIS_DA_EXPIRACAO: "começaria depois da nova expiração",
};

export interface ItemRenovado {
  origemId: string;
  tipoEquipamentoId: string | null; equipamentoId: string | null; tipoOsId: string;
  dataInicio: string; intervaloMeses: number; diaExecucao: number; fimSemana: FimSemana;
}
export interface PlanoRenovacao {
  /** Equipamentos que vão: os ativos */
  equipamentoIds: string[];
  /** Equipamentos que ficam: os inativos */
  equipamentosFora: string[];
  /** Itens que vão, na ordem em que foram criados (a mesma ordem vale no plano novo) */
  itens: ItemRenovado[];
  itensFora: { id: string; motivo: MotivoFora }[];
}

/** Função pura: o que a renovação leva para a vigência `nova`. Item excluído (inativo) não conta. */
export function planejarRenovacao(origem: OrigemRenovacao, nova: Vigencia): PlanoRenovacao {
  const ativos = new Set(origem.equipamentos.filter((e) => e.ativo).map((e) => e.id));
  const plano: PlanoRenovacao = { equipamentoIds: [...ativos], equipamentosFora: origem.equipamentos.filter((e) => !e.ativo).map((e) => e.id), itens: [], itensFora: [] };
  const emOrdem = origem.itens.filter((i) => i.ativo).sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : a.criadoEm > b.criadoEm ? 1 : a.id < b.id ? -1 : 1));
  for (const i of emOrdem) {
    if (i.equipamentoId && !ativos.has(i.equipamentoId)) { plano.itensFora.push({ id: i.id, motivo: "EQUIPAMENTO_INATIVO" }); continue; }
    const dataInicio = deslocarInicioDoItem(i.dataInicio, origem.pmoc.dataInicio, nova.dataInicio);
    if (dataInicio > nova.dataExpiracao) { plano.itensFora.push({ id: i.id, motivo: "DEPOIS_DA_EXPIRACAO" }); continue; }
    plano.itens.push({
      origemId: i.id, tipoEquipamentoId: i.tipoEquipamentoId, equipamentoId: i.equipamentoId, tipoOsId: i.tipoOsId,
      dataInicio, intervaloMeses: i.intervaloMeses, diaExecucao: i.diaExecucao, fimSemana: i.fimSemana,
    });
  }
  return plano;
}

/** Observações sobre a vigência escolhida (não impedem renovar) */
export function avisosDaVigencia(antiga: Vigencia, nova: Vigencia, hoje: string): string[] {
  const avisos: string[] = [];
  if (nova.dataInicio <= antiga.dataExpiracao) avisos.push(`A nova vigência começa antes do fim da atual (${dataBR(antiga.dataExpiracao)}).`);
  if (nova.dataInicio < hoje) avisos.push("O início já passou: só as manutenções de hoje em diante geram OS.");
  return avisos;
}

/* ───────── pedido ───────── */

/** "AAAA-MM-DD" de um dia que existe (31/02 não passa) */
export const dataValida = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && somarDias(v, 0) === v;
const data = (msg: string) => z.string({ required_error: msg, invalid_type_error: msg }).refine(dataValida, msg);
const MSG_NOME = "Informe o nome do novo plano (mín. 3 caracteres).";
export const renovacaoSchema = z.object({
  nome: z.string({ required_error: MSG_NOME, invalid_type_error: MSG_NOME }).trim().min(3, MSG_NOME).max(NOME_MAX, `O nome vai até ${NOME_MAX} caracteres.`),
  dataInicio: data("Informe a data de início."),
  dataExpiracao: data("Informe a data de expiração."),
}).refine((d) => d.dataExpiracao > d.dataInicio, { message: "A data de expiração deve ser depois da data de início.", path: ["dataExpiracao"] });
export type RenovacaoInput = z.infer<typeof renovacaoSchema>;

/* ───────── histórico: a ligação entre os dois planos ───────── */

export const acaoRenovadoDe = (nomeAntigo: string) => `Renovado a partir de ${nomeAntigo}`;
export const PREFIXO_RENOVACAO_GERADA = "Renovação gerada: ";
export const acaoRenovacaoGerada = (nomeNovo: string) => `${PREFIXO_RENOVACAO_GERADA}${nomeNovo}`;

/**
 * A linha do histórico que aponta para OUTRO plano guarda o id dele na última linha dos detalhes
 * ("[pmoc:<id>]"). O servidor tira a marca antes de devolver e confere que o plano é da empresa.
 */
const MARCA = /(?:^|\n)\[pmoc:([A-Za-z0-9_-]{1,64})\]\s*$/;
export const comReferencia = (texto: string, pmocId: string) => `${texto}\n[pmoc:${pmocId}]`;
export function lerReferencia(detalhes: string | null): { texto: string | null; pmocId: string | null } {
  const m = detalhes ? MARCA.exec(detalhes) : null;
  if (!m) return { texto: detalhes, pmocId: null };
  return { texto: detalhes!.slice(0, m.index).trim() || null, pmocId: m[1] };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
/** O resumo do que foi levado, para o histórico do plano novo */
export function resumoDoQueFoi(p: PlanoRenovacao): string {
  const partesDoResumo = [plural(p.equipamentoIds.length, "equipamento", "equipamentos"), plural(p.itens.length, "item do cronograma", "itens do cronograma")];
  const fora = [
    p.equipamentosFora.length ? plural(p.equipamentosFora.length, "equipamento inativo", "equipamentos inativos") : "",
    p.itensFora.length ? plural(p.itensFora.length, "item do cronograma", "itens do cronograma") : "",
  ].filter(Boolean);
  return `Levou ${partesDoResumo.join(" e ")}.${fora.length ? ` Ficaram de fora: ${fora.join(" e ")}.` : ""} A ART não é levada.`;
}
