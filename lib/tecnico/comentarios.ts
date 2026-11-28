/**
 * COMENTÁRIOS NA OS entre o técnico (app) e o escritório — regras PURAS (aparelho, servidor e testes).
 *
 * Conversa INTERNA da OS: o cliente nunca vê. O técnico escreve pelo app com ou sem sinal (o `clientId` gerado no
 * aparelho faz o comentário reenviado não duplicar) e lê os das OS em que tem atividade; o escritório lê e responde
 * pela OS. Nada se edita nem se apaga. "Novos" no app = escritos por OUTRA pessoa depois da última vez que o técnico
 * abriu a OS neste aparelho; no escritório, o sino conta os do campo depois da última leitura de cada pessoa.
 */
import { z } from "zod";

export const TEXTO_MAX = 2000;
export type OrigemComentario = "APP" | "ESCRITORIO";

const id = z.string().min(1).max(64);
export const comentarioSchema = z.object({
  clientId: id,
  texto: z.string().trim().min(1, "Escreva o comentário.").max(TEXTO_MAX, `No máximo ${TEXTO_MAX.toLocaleString("pt-BR")} caracteres.`),
}).strict();
export type DadosComentario = z.infer<typeof comentarioSchema>;

/** Como o comentário aparece no app e no escritório (sem nada além de quem, quando e o texto). */
export interface ComentarioTela {
  id: string | null; clientId: string | null; texto: string; autor: string; origem: OrigemComentario; criadoEm: string;
  /** Escrito por quem está com o aparelho (ou pela pessoa logada, no escritório) */
  meu: boolean;
  /** Gravado no aparelho, ainda não confirmado */
  pendente?: boolean;
  /** Hotfix: a atividade de onde o técnico escreveu (o escritório vê a marca); vazio = escritório */
  atividade?: string | null;
  /** Hotfix: chegou depois da última leitura desta pessoa (o escritório destaca) */
  novo?: boolean;
}

/** Em ordem de criação (mais antigo primeiro); o que ainda está no aparelho vai por último. */
export function ordenarComentarios(lista: ComentarioTela[]): ComentarioTela[] {
  return [...lista].sort((a, b) => Number(!!a.pendente) - Number(!!b.pendente) || a.criadoEm.localeCompare(b.criadoEm));
}

/** O comentário vale na tela na hora (sem sinal também); o mesmo clientId não entra duas vezes. */
export function aplicarComentario(lista: ComentarioTela[], d: DadosComentario, quando: string, autor = "Você"): ComentarioTela[] {
  if (lista.some((c) => c.clientId === d.clientId)) return lista;
  return [...lista, { id: null, clientId: d.clientId, texto: d.texto.trim(), autor, origem: "APP", criadoEm: quando, meu: true, pendente: true }];
}

/** Quantos comentários de OUTRAS pessoas chegaram depois de `vistoEm` (null = nunca abriu: todos os dos outros). */
export function novosComentarios(lista: ComentarioTela[] | null | undefined, vistoEm: string | null | undefined): number {
  return (lista ?? []).filter((c) => !c.meu && (!vistoEm || c.criadoEm > vistoEm)).length;
}

/** O que o sino do escritório conta: OS com comentário do CAMPO depois da última leitura da pessoa. */
export function osComNovidade(ultimoDoCampo: Map<string, Date>, lidos: Map<string, Date>): string[] {
  return [...ultimoDoCampo].filter(([osId, ultimo]) => { const l = lidos.get(osId); return !l || ultimo > l; })
    .sort((a, b) => b[1].getTime() - a[1].getTime()).map(([osId]) => osId);
}

/** A chave do "visto" no banco do aparelho (por OS) */
export const chaveVisto = (osId: string) => `comentariosVistos:${osId}`;
/** Quantos dias o sino olha para trás (comentário mais antigo que isso não acende o sino) */
export const DIAS_SINO_COMENTARIOS = 30;
export const MSG_COMENTARIO_DUPLICADO = "Identificador de comentário já usado em outra OS.";
