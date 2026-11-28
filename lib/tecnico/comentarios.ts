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
/** CHAT-1: a foto vai já reduzida no aparelho (data URL), com a miniatura do balão; os limites moram em lib/chat/regras */
const imagem = (max: number, msg: string) => z.string().startsWith("data:image/", "Envie uma foto (JPG, PNG ou WEBP).").max(Math.ceil(max * 4 / 3) + 64, msg);
export const FOTO_TAMANHO_MAX = 1_500_000;
export const MINIATURA_TAMANHO_MAX = 150_000;
export const MSG_FOTO_GRANDE = `A foto passa de ${(FOTO_TAMANHO_MAX / 1_000_000).toLocaleString("pt-BR")} MB mesmo reduzida. Tire outra ou escolha uma menor.`;
export const MSG_MENSAGEM_VAZIA = "Escreva a mensagem ou anexe uma foto.";
/** Uma mensagem da conversa da OS (o técnico pela fila do app; o escritório pela tela): texto, foto ou os dois */
export const comentarioSchema = z.object({
  clientId: id,
  texto: z.string().trim().max(TEXTO_MAX, `No máximo ${TEXTO_MAX.toLocaleString("pt-BR")} caracteres.`),
  foto: imagem(FOTO_TAMANHO_MAX, MSG_FOTO_GRANDE).optional(),
  miniatura: imagem(MINIATURA_TAMANHO_MAX, MSG_FOTO_GRANDE).optional(),
}).strict()
  .refine((d) => !!d.texto || !!d.foto, { message: MSG_MENSAGEM_VAZIA, path: ["texto"] })
  .refine((d) => !d.foto === !d.miniatura, { message: "A foto vai com a miniatura.", path: ["miniatura"] });
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
  /** CHAT-1: a foto da mensagem (a miniatura vai no balão; a inteira se pede pelo id ao ampliar) */
  foto?: { id: string | null; miniatura: string } | null;
  /** CHAT-1: lida pela 1ª vez por alguém que não o autor (o ✓✓) */
  lida?: { por: string; em: string } | null;
  /** CHAT-1: a fila do aparelho recusou o envio (fica com o motivo até tentar de novo) */
  falhou?: string | null;
  /** CHAT-1 (conversa por pessoa): a OS da mensagem (vazio = sem OS) — a etiqueta discreta que abre a OS */
  os?: { id: string; numero: string; cliente: string } | null;
  /** CHAT-1: o escritório escreveu para UMA pessoa (o nome); vazio = para todos os técnicos da OS */
  para?: string | null;
}

/** Em ordem de criação (mais antigo primeiro); o que ainda está no aparelho vai por último. */
export function ordenarComentarios(lista: ComentarioTela[]): ComentarioTela[] {
  return [...lista].sort((a, b) => Number(!!a.pendente) - Number(!!b.pendente) || a.criadoEm.localeCompare(b.criadoEm));
}

/** O comentário vale na tela na hora (sem sinal também); o mesmo clientId não entra duas vezes. */
export function aplicarComentario(lista: ComentarioTela[], d: DadosComentario, quando: string, autor = "Você"): ComentarioTela[] {
  if (lista.some((c) => c.clientId === d.clientId)) return lista;
  return [...lista, { id: null, clientId: d.clientId, texto: d.texto.trim(), autor, origem: "APP", criadoEm: quando, meu: true, pendente: true,
    ...(d.miniatura && { foto: { id: null, miniatura: d.miniatura } }) }];
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
