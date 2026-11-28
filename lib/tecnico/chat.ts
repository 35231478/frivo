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
import { refParaCitacao, type ComentarioTela } from "@/lib/tecnico/comentarios";
import { acharCitada } from "@/lib/chat/regras";
import type { EquipamentoFotoTela } from "@/lib/chat/equipamento-foto";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";

/** GET /api/tecnico/conversas */
export interface RespostaConversa {
  mensagens: ComentarioTela[]; osDoDia: OsDoDia[]; osPadrao: string | null;
  /** A atividade do técnico nas OS da conversa que não são do dia (responder herda a OS da citada) */
  atividadesDasOs?: OsDoDia[];
  /** CHAT-1.1: por OS, os equipamentos (a foto se vincula a um deles) e o da atividade em andamento dele */
  equipamentosDasOs?: EquipamentosDasOsTela;
}
export type EquipamentosDasOsTela = Record<string, { equipamentos: EquipamentoFotoTela[]; emAndamento: string | null }>;
/** A OS como a etiqueta mostra */
export type OsEtiqueta = NonNullable<ComentarioTela["os"]>;

export const URL_CONVERSA_APP = "/api/tecnico/conversas";
/** A conversa desde uma mensagem antiga (a citada que o técnico quer ver) */
export const urlConversaAte = (id: string | null) => (id ? `${URL_CONVERSA_APP}?ate=${encodeURIComponent(id)}` : URL_CONVERSA_APP);
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
    ...(r.atividadesDasOs && { atividadesDasOs: r.atividadesDasOs.map((o) => (o.cliente ? { ...o, cliente: "" } : o)) }),
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
export function mensagensDaFila(fila: OperacaoFila[], atividades: ReadonlyMap<string, OsEtiqueta>, autor: string, equipamentos: EquipamentosDasOsTela = {}): ComentarioTela[] {
  return fila.flatMap((o): ComentarioTela[] => {
    if (o.tipo !== "comentario") return [];
    const d = o.dados;
    const falhou = o.estado === "erro" ? (o.erro || "Recusada pelo servidor.") : null;
    const os = o.atividadeId === SEM_OS ? null : atividades.get(o.atividadeId) ?? null;
    // O equipamento que o técnico escolheu para a foto aparece já (o automático, quando o servidor confirmar)
    const escolhido = d.equipamentoId && os ? equipamentos[os.id]?.equipamentos.find((e) => e.id === d.equipamentoId) ?? null : null;
    return [{
      id: null, clientId: d.clientId, texto: (d.texto ?? "").trim(), autor, origem: "APP", criadoEm: o.criadoEm, meu: true,
      pendente: !falhou, falhou, os,
      ...(d.miniatura && { foto: { id: null, miniatura: d.miniatura, equipamento: escolhido, origemEquipamento: escolhido ? "ESCOLHA" as const : null } }),
      ...(d.respostaA && { respostaA: refParaCitacao(d.respostaA) }),
    }];
  });
}

/**
 * CHAT-1.1: as correções do equipamento da foto que ainda estão na fila valem na tela já (a última de cada foto). A
 * recusada não vale: a foto fica como o servidor tem.
 */
export function aplicarCorrecoesDaFila(mensagens: ComentarioTela[], fila: OperacaoFila[], equipamentos: EquipamentosDasOsTela = {}): ComentarioTela[] {
  const correcoes = fila.filter((o) => o.tipo === "fotoChatEquipamento" && o.estado !== "erro");
  if (!correcoes.length) return mensagens;
  return mensagens.map((m) => {
    if (!m.foto || !m.os) return m;
    const c = [...correcoes].reverse().find((o) => o.tipo === "fotoChatEquipamento" && !!acharCitada([m], { id: o.dados.comentario.id ?? null, clientId: o.dados.comentario.clientId ?? null }));
    if (!c || c.tipo !== "fotoChatEquipamento") return m;
    const equipamento = c.dados.equipamentoId ? equipamentos[m.os.id]?.equipamentos.find((e) => e.id === c.dados.equipamentoId) ?? null : null;
    return { ...m, foto: { ...m.foto, equipamento, origemEquipamento: "CORRIGIDO" } };
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

/**
 * As opções do seletor: as OS do dia e, respondendo uma mensagem de OUTRA OS, a dela (a resposta herda a OS da citada)
 * — quando o técnico tem atividade nela (a do dia, a guardada no aparelho ou a que veio com a conversa). Sem atividade
 * dele naquela OS, a resposta vai sem OS (a fila sobe pela atividade).
 */
export function opcoesDoSeletor(osDoDia: readonly OsDoDia[], herdada: OsEtiqueta | null | undefined, atividades: ReadonlyMap<string, OsEtiqueta>): OsDoDia[] {
  if (!herdada || osDoDia.some((o) => o.osId === herdada.id)) return [...osDoDia];
  const atividadeId = atividadeDaOs(herdada.id, osDoDia, atividades);
  return atividadeId ? [...osDoDia, { osId: herdada.id, numero: herdada.numero, cliente: herdada.cliente, emAndamento: false, atividadeId }] : [...osDoDia];
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
