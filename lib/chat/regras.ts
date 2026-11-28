/**
 * CHAT-1 — o chat interno estilo WhatsApp: regras PURAS (aparelho, escritório, servidor e testes).
 *
 * Não é outro sistema: cada conversa é a conversa de UMA OS, feita das mensagens de `os_comentarios` (as mesmas regras
 * de lib/tecnico/comentarios: idempotentes pelo clientId, nada se edita nem se apaga, o cliente nunca vê). Este módulo
 * acrescenta o que o chat precisa por cima: o resumo de cada conversa (a lista), o estado de cada mensagem (✓/✓✓), a
 * busca, quem escreve em OS cancelada, os limites da foto e o ritmo do tempo real.
 */
import { partesBR } from "@/lib/fuso";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";

export { FOTO_TAMANHO_MAX, MINIATURA_TAMANHO_MAX, MSG_FOTO_GRANDE, MSG_MENSAGEM_VAZIA, TEXTO_MAX } from "@/lib/tecnico/comentarios";

// ── A conversa (um item da lista) ───────────────────────────────────────────────────────────

export interface ConversaResumo {
  osId: string;
  osNumero: string;
  cliente: string;
  /** Situação da OS (CANCELADA = só leitura) */
  status: string;
  /** Os técnicos da OS (das atividades), em ordem alfabética */
  tecnicos: string[];
  ultima: { texto: string; autor: string; criadoEm: string; minha: boolean; foto: boolean } | null;
  /** Mensagens de outras pessoas depois da última leitura de quem está vendo */
  naoLidas: number;
  /** App do técnico: a atividade dele nesta OS por onde a mensagem sobe na fila (a mais recente) */
  atividadeId?: string | null;
  /** App do técnico: todas as atividades dele nesta OS (a fila do aparelho é por atividade) */
  atividadeIds?: string[];
}

export const MSG_OS_CANCELADA = "OS cancelada: a conversa fica só para leitura.";
export const MSG_SEM_CONVERSA = "Conversa não encontrada.";
/** A conversa de OS CANCELADA fica só para leitura; a CONCLUÍDA segue aberta (vira histórico e pode continuar). */
export const somenteLeitura = (status: string | null | undefined) => status === "CANCELADA";

/** O que a lista mostra da última mensagem: a 1ª linha do texto; só foto vira "Foto". */
export function textoDaUltima(u: ConversaResumo["ultima"], max = 80): string {
  if (!u) return "Sem mensagens ainda.";
  const linha = u.texto.trim().split("\n")[0] ?? "";
  const t = linha.length > max ? `${linha.slice(0, max - 1).trimEnd()}…` : linha;
  if (u.foto) return t ? `Foto · ${t}` : "Foto";
  return t;
}

/** Normaliza para a busca (sem acento, sem caixa). */
const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** A busca da lista: nº da OS, cliente, técnico ou o texto da última mensagem; "Não lidas" deixa só as com contador. */
export function filtrarConversas(lista: ConversaResumo[], busca: string, soNaoLidas: boolean): ConversaResumo[] {
  const q = normal(busca);
  return lista.filter((c) => (!soNaoLidas || c.naoLidas > 0)
    && (!q || [c.osNumero, c.cliente, ...c.tecnicos, c.ultima?.texto ?? ""].some((x) => normal(x).includes(q))));
}

/** Mais recente primeiro; sem mensagem vai para o fim (por número). */
export function ordenarConversas(lista: ConversaResumo[]): ConversaResumo[] {
  return [...lista].sort((a, b) => (b.ultima?.criadoEm ?? "").localeCompare(a.ultima?.criadoEm ?? "") || a.osNumero.localeCompare(b.osNumero));
}

export const totalNaoLidas = (lista: ConversaResumo[]) => lista.reduce((n, c) => n + c.naoLidas, 0);

// ── A conversa com uma PESSOA (o desenho principal) ─────────────────────────────────────────

/**
 * A lista do escritório é POR PESSOA (a gente pensa "preciso falar com o João", não "OS 1.234"); o REGISTRO continua
 * na OS: cada mensagem leva a OS dela (ou nenhuma), e dentro da OS aparecem só as daquela OS — a mesma mensagem,
 * filtrada, nada duplicado.
 */
export interface PessoaResumo {
  /** O usuário do técnico (a chave da conversa) */
  usuarioId: string;
  tecnicoId: string;
  nome: string;
  avatar: string | null;
  ultima: { texto: string; autor: string; criadoEm: string; minha: boolean; foto: boolean; osNumero: string | null } | null;
  /** O que o técnico mandou depois da última leitura de quem vê */
  naoLidas: number;
}

/** Não lidas primeiro; depois a mais recente; quem nunca conversou, pelo nome. */
export function ordenarPessoas(lista: PessoaResumo[]): PessoaResumo[] {
  return [...lista].sort((a, b) => Number(b.naoLidas > 0) - Number(a.naoLidas > 0)
    || (b.ultima?.criadoEm ?? "").localeCompare(a.ultima?.criadoEm ?? "")
    || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** As iniciais (sem foto): "Carlos Oliveira" → "CO". */
export function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
}

/** Uma OS que a pessoa tem no dia (o seletor de 1 toque acima do campo de texto). */
export interface OsDoDia { osId: string; numero: string; cliente: string; emAndamento: boolean; atividadeId?: string | null }

/**
 * A OS que a mensagem leva SOZINHA: a da atividade em andamento do técnico; senão a última OS usada na conversa HOJE;
 * senão nenhuma ("Sem OS"). A pessoa troca com um toque.
 */
export function osPadraoDaMensagem(a: { osDoDia: OsDoDia[]; mensagens: Pick<ComentarioTela, "os" | "criadoEm">[]; agora?: Date }): string | null {
  const emAndamento = a.osDoDia.find((o) => o.emAndamento);
  if (emAndamento) return emAndamento.osId;
  const hoje = rotuloDoDia((a.agora ?? new Date()).toISOString(), a.agora);
  const ultimaHoje = [...a.mensagens].reverse().find((m) => m.os && rotuloDoDia(m.criadoEm, a.agora) === hoje);
  return ultimaHoje?.os?.id ?? null;
}

/** Na conversa da pessoa, a etiqueta da OS só aparece quando a OS muda (ou o dia): mensagens seguidas agrupam. */
export function mostraEtiquetaOs(m: Pick<ComentarioTela, "os" | "criadoEm">, anterior: Pick<ComentarioTela, "os" | "criadoEm"> | undefined, agora?: Date): boolean {
  if (!anterior) return true;
  if (rotuloDoDia(m.criadoEm, agora) !== rotuloDoDia(anterior.criadoEm, agora)) return true;
  return (m.os?.id ?? null) !== (anterior.os?.id ?? null);
}

export const ROTULO_SEM_OS = "Sem OS";

/** Mensagens do mesmo autor mais próximas que isto formam uma SEQUÊNCIA (o nome só na 1ª) */
export const SEQUENCIA_MS = 5 * 60_000;

/**
 * O balão RECEBIDO mostra quem escreveu (e de onde)? Sempre — só não repete numa sequência IMEDIATA do mesmo autor: a
 * anterior é dele, do mesmo lado, do mesmo dia, sem a etiqueta de outra OS no meio e a menos de 5 minutos. (Antes, a
 * etiqueta da OS e as horas de intervalo escondiam o nome de quem respondeu.)
 */
export function mostraAutor(m: Pick<ComentarioTela, "autor" | "meu" | "origem" | "criadoEm" | "os">, anterior: Pick<ComentarioTela, "autor" | "meu" | "origem" | "criadoEm" | "os"> | undefined, op: { comEtiquetaOs?: boolean; agora?: Date } = {}): boolean {
  if (m.meu) return false;
  if (!anterior || anterior.meu || anterior.autor !== m.autor || anterior.origem !== m.origem) return true;
  if (rotuloDoDia(m.criadoEm, op.agora) !== rotuloDoDia(anterior.criadoEm, op.agora)) return true;
  if (op.comEtiquetaOs && mostraEtiquetaOs(m, anterior, op.agora)) return true;
  return Date.parse(m.criadoEm) - Date.parse(anterior.criadoEm) > SEQUENCIA_MS;
}
export const MSG_SEM_PERMISSAO_CONVERSAS = "Sem permissão para Conversas. Peça ao administrador (Configurações › Perfis de acesso).";

// ── A mensagem (um balão) ───────────────────────────────────────────────────────────────────

export type EstadoMensagem = "falhou" | "enviando" | "enviada" | "lida";

/** O estado de uma mensagem MINHA: falhou (a fila recusou) · enviando (no aparelho) · enviada ✓ · lida ✓✓. */
export function estadoDaMensagem(m: Pick<ComentarioTela, "pendente" | "falhou" | "lida">): EstadoMensagem {
  if (m.falhou) return "falhou";
  if (m.pendente) return "enviando";
  return m.lida ? "lida" : "enviada";
}

export const ROTULO_ESTADO: Record<EstadoMensagem, string> = {
  falhou: "Não enviada", enviando: "Enviando…", enviada: "Enviada", lida: "Lida",
};

/**
 * Junta as mensagens do servidor com as que ainda estão no aparelho (fila): a do aparelho que o servidor já tem (mesmo
 * clientId) sai; as outras vão por último, na ordem em que foram escritas.
 */
export function juntarComFila(servidor: ComentarioTela[], fila: ComentarioTela[]): ComentarioTela[] {
  const ja = new Set(servidor.map((m) => m.clientId).filter(Boolean));
  const doAparelho = fila.filter((m) => !m.clientId || !ja.has(m.clientId)).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  return [...servidor, ...doAparelho];
}

/** Separadores de dia da conversa: "Hoje", "Ontem" ou a data (dia de Brasília). */
export function rotuloDoDia(iso: string, agora: Date = new Date()): string {
  const d = partesBR(iso);
  const h = partesBR(agora);
  const ontem = partesBR(new Date(agora.getTime() - 86_400_000));
  if (d.ano === h.ano && d.mes === h.mes && d.dia === h.dia) return "Hoje";
  if (d.ano === ontem.ano && d.mes === ontem.mes && d.dia === ontem.dia) return "Ontem";
  return `${String(d.dia).padStart(2, "0")}/${String(d.mes + 1).padStart(2, "0")}/${d.ano}`;
}

/** A hora da lista: hoje → "14:05"; ontem → "Ontem"; antes → "12/11". */
export function horaDaLista(iso: string, agora: Date = new Date()): string {
  const r = rotuloDoDia(iso, agora);
  const d = partesBR(iso);
  if (r === "Hoje") return `${String(d.hora).padStart(2, "0")}:${String(d.minuto).padStart(2, "0")}`;
  if (r === "Ontem") return r;
  return r.slice(0, 5);
}

// ── A foto ──────────────────────────────────────────────────────────────────────────────────

/** O aparelho reduz a foto antes de enviar: o lado maior até FOTO_LADO_MAX, JPEG; a miniatura do balão, MINIATURA_LADO. */
export const FOTO_LADO_MAX = 1600;
export const FOTO_QUALIDADE = 0.8;
export const MINIATURA_LADO = 320;
export const MINIATURA_QUALIDADE = 0.7;

// ── Tempo real ──────────────────────────────────────────────────────────────────────────────

/**
 * Long-polling curto (cabe na Vercel, sem websocket próprio): o aparelho pergunta "mudou algo desde <marca>?" e o
 * servidor segura a resposta até ESPERA_NOVIDADES_MS, olhando o banco a cada PASSO_NOVIDADES_MS; responde na hora em
 * que algo muda. Com a aba escondida, para; ao voltar, pergunta na hora. Erro de rede: espera crescente.
 */
export const ESPERA_NOVIDADES_MS = 8_000;
export const PASSO_NOVIDADES_MS = 2_000;
export const ESPERA_ERRO_MAX_MS = 30_000;

/**
 * A marca do "estado" das conversas para quem pergunta: a mensagem mais nova, a 1ª leitura mais nova (o ✓✓ também é
 * novidade) e a leitura mais nova DESTA pessoa (ler uma conversa que outro já tinha lido muda o contador dela).
 */
export function marcaNovidades(ultimaMensagem: Date | null | undefined, ultimaLeitura: Date | null | undefined, minhaLeitura?: Date | null): string {
  return `${ultimaMensagem?.getTime() ?? 0}.${ultimaLeitura?.getTime() ?? 0}.${minhaLeitura?.getTime() ?? 0}`;
}
/** Uma marca que veio de fora tem o formato certo? */
export const marcaValida = (m: unknown): m is string => typeof m === "string" && /^\d{1,16}(\.\d{1,16}){1,2}$/.test(m);

/** Espera antes de tentar de novo depois de `falhas` erros seguidos (2 s, 4 s, 8 s… até 30 s). */
export const esperaDepoisDeErro = (falhas: number) => Math.min(ESPERA_ERRO_MAX_MS, 2_000 * 2 ** Math.max(0, falhas - 1));

// ── Endereços ───────────────────────────────────────────────────────────────────────────────

export const urlConversaEscritorio = (osId?: string | null) => (osId ? `/conversas?os=${encodeURIComponent(osId)}` : "/conversas");
/** A conversa com uma pessoa no escritório (o padrão da tela Conversas) */
export const urlConversaPessoa = (usuarioId?: string | null) => (usuarioId ? `/conversas?pessoa=${encodeURIComponent(usuarioId)}` : "/conversas");
export const urlConversaApp = (osId?: string | null) => (osId ? `/tecnico?ver=chat&os=${encodeURIComponent(osId)}` : "/tecnico?ver=chat");
