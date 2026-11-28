/**
 * CHAT-1 no APP DO TÉCNICO — regras PURAS da tela Chat (o aparelho e os testes). O técnico tem UMA conversa, com o
 * "Escritório" (qualquer pessoa do escritório com permissão lê e responde; o balão diz quem). Cada mensagem leva a OS
 * dela (ou nenhuma): a etiqueta discreta mostra a OS quando ela muda; o seletor de 1 toque escolhe a OS da próxima.
 * As regras do chat em si (estado do balão, junção com a fila, etiqueta, OS padrão) moram em lib/chat/regras; aqui fica
 * só o que é do aparelho:
 *  - as mensagens que ainda estão na FILA (escritas aqui, sem confirmação do servidor) viram balões, com a OS certa;
 *  - qual OS o seletor mostra e por qual atividade a mensagem sobe (sem OS: SEM_OS);
 *  - quando o tempo real pede recarregar a conversa;
 *  - o contador da barra inferior.
 */
import { marcaValida, type OsDoDia } from "@/lib/chat/regras";
import { SEM_OS } from "@/lib/tecnico/despesas";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";

/** GET /api/tecnico/conversas */
export interface RespostaConversa { mensagens: ComentarioTela[]; osDoDia: OsDoDia[]; osPadrao: string | null }
/** A OS como a etiqueta mostra */
export type OsEtiqueta = NonNullable<ComentarioTela["os"]>;

export const URL_CONVERSA_APP = "/api/tecnico/conversas";
/** A foto inteira (ao ampliar) */
export const urlFotoApp = (fotoId: string) => `${URL_CONVERSA_APP}/fotos/${encodeURIComponent(fotoId)}`;

/** A chave no banco do aparelho (`dados`): a conversa guardada para ler sem sinal */
export const CHAVE_CONVERSA = "conversas" as const;

export const MSG_CONVERSA_SEM_SINAL = "Sem sinal e a conversa ainda não foi aberta neste aparelho. As mensagens anteriores aparecem quando o sinal voltar.";

/** A resposta é a da conversa (e não um erro, ou a lista do desenho antigo guardada com a mesma chave)? */
export function conversaValida(x: unknown): x is RespostaConversa {
  const r = x as RespostaConversa;
  return !!r && typeof r === "object" && Array.isArray(r.mensagens) && Array.isArray(r.osDoDia);
}

/** Sem "Exibir dados do cliente" (config do app), o nome do cliente não aparece (a guardada de antes também não). */
export function semCliente(r: RespostaConversa, exibir: boolean): RespostaConversa {
  if (exibir) return r;
  return {
    ...r,
    mensagens: r.mensagens.map((m) => (m.os?.cliente ? { ...m, os: { ...m.os, cliente: "" } } : m)),
    osDoDia: r.osDoDia.map((o) => (o.cliente ? { ...o, cliente: "" } : o)),
  };
}

/**
 * De que OS é cada atividade do técnico (a fila do aparelho é por atividade): as OS do dia e os retratos guardados
 * no aparelho (a mensagem escrita dentro de uma OS de outro dia). SEM_OS não entra: é "sem OS".
 */
export function mapaDeAtividades(osDoDia: readonly OsDoDia[], retratos: readonly { atividadeId: string; osId: string; osNumero: string; cliente: string }[] = []): Map<string, OsEtiqueta> {
  const m = new Map<string, OsEtiqueta>();
  for (const r of retratos) m.set(r.atividadeId, { id: r.osId, numero: r.osNumero, cliente: r.cliente });
  for (const o of osDoDia) if (o.atividadeId) m.set(o.atividadeId, { id: o.osId, numero: o.numero, cliente: o.cliente });
  return m;
}

/** A atividade dele numa OS (abrir a execução pela etiqueta): a do dia primeiro; senão a de um retrato guardado. */
export function atividadeDaOs(osId: string, osDoDia: readonly OsDoDia[], atividades: ReadonlyMap<string, OsEtiqueta> = new Map()): string | null {
  const doDia = osDoDia.find((o) => o.osId === osId)?.atividadeId;
  if (doDia) return doDia;
  for (const [a, os] of atividades) if (os.id === osId) return a;
  return null;
}

/**
 * As mensagens que ainda estão na fila do aparelho (toda operação "comentario": da tela Chat, de dentro da OS, com ou
 * sem OS): pendente = "Enviando…"; recusada pelo servidor = "Não enviada", com o motivo. A etiqueta da OS vem da
 * atividade (SEM_OS = sem OS). A já confirmada (estado "enviada") continua como pendente até a conversa do servidor
 * trazê-la — `juntarComFila` tira a repetida.
 */
export function mensagensDaFila(fila: OperacaoFila[], atividades: ReadonlyMap<string, OsEtiqueta>, autor: string): ComentarioTela[] {
  return fila.flatMap((o): ComentarioTela[] => {
    if (o.tipo !== "comentario") return [];
    const d = o.dados;
    const falhou = o.estado === "erro" ? (o.erro || "Recusada pelo servidor.") : null;
    return [{
      id: null, clientId: d.clientId, texto: (d.texto ?? "").trim(), autor, origem: "APP", criadoEm: o.criadoEm, meu: true,
      pendente: !falhou, falhou, os: o.atividadeId === SEM_OS ? null : atividades.get(o.atividadeId) ?? null,
      ...(d.miniatura && { foto: { id: null, miniatura: d.miniatura } }),
    }];
  });
}

/** clientIds que o servidor já confirmou (estado "enviada") e a conversa baixada ainda não tem: hora de recarregar. */
export function confirmadasForaDaConversa(fila: OperacaoFila[], servidor: ComentarioTela[]): string[] {
  const ja = new Set(servidor.map((m) => m.clientId).filter(Boolean));
  return fila.flatMap((o) => (o.tipo === "comentario" && o.estado === "enviada" && !ja.has(o.dados.clientId) ? [o.dados.clientId] : []));
}

/**
 * As mensagens que estavam na fila e saíram dela sem a conversa baixada ainda tê-las: o servidor confirmou e a fila as
 * tirou (com OS, o retrato novo da atividade; sem OS, na hora), ou o técnico descartou a recusada. Pede recarregar a
 * conversa; até lá, a que estava "Enviando…" segue na tela (a recusada que saiu não: pode ter sido descartada).
 */
export function mensagensSumidas(antes: ComentarioTela[], agora: ComentarioTela[], servidor: ComentarioTela[]): ComentarioTela[] {
  const ficam = new Set([...agora, ...servidor].map((m) => m.clientId).filter(Boolean));
  return antes.filter((m) => !!m.clientId && !ficam.has(m.clientId));
}

/**
 * A OS que o seletor mostra: a escolha do técnico (fica depois de enviar); sem escolha, a OS padrão do servidor. Só
 * vale OS do dia (é por ela que a mensagem sobe); fora disso, "Sem OS" (null).
 */
export function osDoSeletor(escolha: string | null | undefined, osPadrao: string | null | undefined, osDoDia: readonly OsDoDia[]): string | null {
  const v = escolha === undefined ? osPadrao ?? null : escolha;
  return v && osDoDia.some((o) => o.osId === v && o.atividadeId) ? v : null;
}

/** Por qual atividade a mensagem sobe na fila: a da OS escolhida; "Sem OS" = SEM_OS. */
export function atividadeDoEnvio(osId: string | null, osDoDia: readonly OsDoDia[]): string {
  return (osId && osDoDia.find((o) => o.osId === osId)?.atividadeId) || SEM_OS;
}

/**
 * O tempo real pede recarregar a conversa? Só quando chegou mensagem ou alguém leu pela 1ª vez (as duas primeiras
 * partes da marca). A 3ª parte é a leitura do próprio técnico — que a própria recarga muda: recarregar por ela seria
 * um laço sem fim. Marca fora do formato: recarrega se mudou.
 */
export function precisaRecarregar(antes: string | null | undefined, depois: string): boolean {
  if (!antes || antes === depois) return false;
  if (!marcaValida(antes) || !marcaValida(depois)) return true;
  const [a1, a2] = antes.split(".");
  const [d1, d2] = depois.split(".");
  return a1 !== d1 || a2 !== d2;
}

/** O contador da barra: nada com zero; acima de 99, "99+". */
export const rotuloNaoLidas = (n: number) => (n <= 0 ? "" : n > 99 ? "99+" : String(n));
/** O nome acessível do contador */
export const dicaNaoLidas = (n: number) => (n === 1 ? "1 mensagem não lida" : `${n} mensagens não lidas`);
