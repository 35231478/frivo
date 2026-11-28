/**
 * CHAT-1 no APP DO TÉCNICO — regras PURAS da tela Chat (o aparelho e os testes). As regras do chat em si (resumo,
 * estado do balão, junção com a fila, busca) moram em lib/chat/regras; aqui fica só o que é do aparelho:
 *  - as mensagens que ainda estão na FILA (escritas aqui, sem confirmação do servidor) viram balões;
 *  - o que se guarda no banco do aparelho (a lista e as últimas conversas abertas, para ler sem sinal);
 *  - o contador da barra inferior.
 */
import type { ConversaResumo } from "@/lib/chat/regras";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";

export interface RespostaConversas { conversas: ConversaResumo[]; naoLidas: number }
export interface RespostaConversa { conversa: ConversaResumo; mensagens: ComentarioTela[] }

export const URL_CONVERSAS_APP = "/api/tecnico/conversas";
export const urlConversaApi = (osId: string) => `${URL_CONVERSAS_APP}/${encodeURIComponent(osId)}`;
/** A foto inteira (ao ampliar) */
export const urlFotoApp = (fotoId: string) => `${URL_CONVERSAS_APP}/fotos/${encodeURIComponent(fotoId)}`;

/** Chaves no banco do aparelho (`dados`) */
export const CHAVE_CONVERSAS = "conversas" as const;
export const chaveConversa = (osId: string) => `conversa:${osId}` as const;
export const CHAVE_CONVERSAS_GUARDADAS = "conversasGuardadas";
/** Quantas conversas abertas ficam guardadas no aparelho (as mais recentes; as fotos pesam) */
export const MAX_CONVERSAS_GUARDADAS = 20;

export const MSG_CONVERSA_SEM_SINAL = "Sem sinal e esta conversa ainda não foi aberta neste aparelho.";
export const MSG_LISTA_SEM_SINAL = "Sem sinal e nenhuma conversa guardada ainda.";
export const MSG_SEM_ATIVIDADE = "Sem atividade nesta OS para enviar a mensagem.";

/** A resposta da lista é a do chat (e não um erro ou outra coisa guardada com a mesma chave)? */
export function listaValida(x: unknown): x is RespostaConversas {
  return !!x && typeof x === "object" && Array.isArray((x as RespostaConversas).conversas);
}
export function conversaValida(x: unknown): x is RespostaConversa {
  return !!x && typeof x === "object" && !!(x as RespostaConversa).conversa && Array.isArray((x as RespostaConversa).mensagens);
}

/**
 * As mensagens desta conversa que ainda estão na fila do aparelho (operações "comentario" de uma das atividades do
 * técnico nesta OS): pendente = "Enviando…"; recusada pelo servidor = "Não enviada", com o motivo. A já confirmada
 * (estado "enviada") continua como pendente até a conversa do servidor trazê-la — `juntarComFila` tira a repetida.
 */
export function mensagensDaFila(fila: OperacaoFila[], atividadeIds: readonly string[], autor: string): ComentarioTela[] {
  const ids = new Set(atividadeIds);
  return fila.flatMap((o): ComentarioTela[] => {
    if (o.tipo !== "comentario" || !ids.has(o.atividadeId)) return [];
    const d = o.dados;
    const falhou = o.estado === "erro" ? (o.erro || "Recusada pelo servidor.") : null;
    return [{
      id: null, clientId: d.clientId, texto: (d.texto ?? "").trim(), autor, origem: "APP", criadoEm: o.criadoEm, meu: true,
      pendente: !falhou, falhou, ...(d.miniatura && { foto: { id: null, miniatura: d.miniatura } }),
    }];
  });
}

/** clientIds que o servidor já confirmou (estado "enviada") e a conversa baixada ainda não tem: hora de recarregar. */
export function confirmadasForaDaConversa(fila: OperacaoFila[], atividadeIds: readonly string[], servidor: ComentarioTela[]): string[] {
  const ids = new Set(atividadeIds);
  const ja = new Set(servidor.map((m) => m.clientId).filter(Boolean));
  return fila.filter((o) => o.tipo === "comentario" && o.estado === "enviada" && ids.has(o.atividadeId) && !ja.has(o.dados.clientId))
    .map((o) => (o.tipo === "comentario" ? o.dados.clientId : ""));
}

/**
 * As mensagens que estavam na fila e saíram dela sem a conversa baixada ainda tê-las: o servidor confirmou e o retrato
 * novo da atividade as tirou da fila (ou o técnico descartou a recusada). Pede recarregar a conversa; até lá, a que
 * estava "Enviando…" segue na tela (a recusada que saiu não: pode ter sido descartada — a recarga diz).
 */
export function mensagensSumidas(antes: ComentarioTela[], agora: ComentarioTela[], servidor: ComentarioTela[]): ComentarioTela[] {
  const ficam = new Set([...agora, ...servidor].map((m) => m.clientId).filter(Boolean));
  return antes.filter((m) => !!m.clientId && !ficam.has(m.clientId));
}

/** O contador da barra: nada com zero; acima de 99, "99+". */
export const rotuloNaoLidas = (n: number) => (n <= 0 ? "" : n > 99 ? "99+" : String(n));
/** O nome acessível do contador */
export const dicaNaoLidas = (n: number) => (n === 1 ? "1 mensagem não lida" : `${n} mensagens não lidas`);

/**
 * As conversas guardadas no aparelho (a mais recente primeiro): a aberta agora vai para a frente e as que passam do
 * limite saem (`sair` = os osIds a apagar do banco do aparelho).
 */
export function lembrarConversa(guardadas: readonly string[] | null | undefined, osId: string, max = MAX_CONVERSAS_GUARDADAS): { lista: string[]; sair: string[] } {
  const todas = [osId, ...(guardadas ?? []).filter((x) => x !== osId)];
  return { lista: todas.slice(0, max), sair: todas.slice(max) };
}

/** Sem "Exibir dados do cliente" (config do app), o nome do cliente não aparece nem entra na busca. */
export const semCliente = (c: ConversaResumo, exibir: boolean): ConversaResumo => (exibir ? c : { ...c, cliente: "" });
