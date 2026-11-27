/**
 * NOTIFICAÇÕES PUSH (com o app fechado) — o catálogo e as regras PURAS (sem banco, sem Node): quem
 * pode receber cada tipo, a preferência de cada pessoa, os textos de cada notificação e o aparelho.
 * O servidor (lib/push/servidor) e as telas usam estas mesmas funções; os testes também.
 *
 * Dois públicos, como o sino (lib/alertas/sino):
 *  - TÉCNICO (modo técnico): só o que é DELE — as atividades em que está (responsável ou na composição);
 *  - ESCRITÓRIO: quem tem a permissão do destino, e nunca no modo técnico (nada da empresa inteira para
 *    o técnico).
 * Cada pessoa liga e desliga cada tipo (Perfil › Notificações). Sem preferência gravada, tudo ligado.
 */
import { pode, type Permissoes } from "@/lib/permissoes";
import { chaveDiaCivil, ehDiaCivil, horaBR } from "@/lib/fuso";
import { ehNotaBaixa } from "@/lib/alertas/sino";

export type TipoPush =
  | "OS_NOVA" | "OS_REAGENDADA" | "OS_CANCELADA" | "ATIVIDADE_ESQUECIDA" | "OS_COMENTARIO" | "ACEITE"
  | "DESPESA" | "SOLICITACAO_PORTAL" | "ORCAMENTO_RESPOSTA" | "ESTOQUE_NEGATIVO" | "TESTE";

export interface QuemRecebe {
  permissoes: Permissoes | null | undefined;
  role?: string | null;
  /** Modo técnico (lib/tecnico/modo › emModoTecnico): só o que é dele, nada da empresa inteira */
  restrito: boolean;
  /** Ligado a um técnico do cadastro (mesmo e-mail): pode ter atividades "para você" mesmo fora do modo técnico */
  temTecnico?: boolean;
}

export interface DefTipo {
  id: TipoPush;
  rotulo: string;
  /** O porquê, na ⓘ da preferência */
  dica: string;
  /** Pode receber este tipo? (permissão e escopo; o "é dele" de cada evento o servidor decide) */
  podeReceber: (q: QuemRecebe) => boolean;
}

const p = (q: QuemRecebe, modulo: string, acao: Parameters<typeof pode>[2]) => pode(q.permissoes, modulo, acao, q.role ?? undefined);
/** Tem atividades próprias (modo técnico, ou ligado a um técnico do cadastro) */
const tecnico = (q: QuemRecebe) => q.restrito || !!q.temTecnico;
const escritorio = (q: QuemRecebe) => !q.restrito;
const veOrdens = (q: QuemRecebe) => p(q, "ordens", "visualizar");

/** A ordem é a da tela de preferências. `TESTE` não aparece (é o botão "Enviar teste"). */
export const TIPOS_PUSH: DefTipo[] = [
  { id: "OS_NOVA", rotulo: "Nova OS para você", dica: "Uma atividade foi atribuída a você: cliente, data e hora. Tocar abre a OS no app.", podeReceber: tecnico },
  { id: "OS_REAGENDADA", rotulo: "OS reagendada", dica: "A data ou a hora de uma atividade sua mudou.", podeReceber: tecnico },
  { id: "OS_CANCELADA", rotulo: "OS cancelada", dica: "Uma OS em que você tem atividade foi cancelada.", podeReceber: tecnico },
  { id: "ATIVIDADE_ESQUECIDA", rotulo: "Atividade esquecida em andamento", dica: "Atividade em andamento além do limite da empresa ou desde outro dia. O técnico recebe a dele; o escritório, todas.", podeReceber: (q) => tecnico(q) || veOrdens(q) },
  { id: "OS_COMENTARIO", rotulo: "Comentário novo na OS", dica: "Alguém comentou numa OS sua (técnico) ou da empresa (escritório).", podeReceber: (q) => tecnico(q) || veOrdens(q) },
  { id: "ACEITE", rotulo: "Ressalva, comentário ou nota baixa no aceite", dica: "O cliente confirmou o serviço com ressalva, comentário ou nota de 1 ou 2 estrelas. O técnico recebe só o da OS dele.", podeReceber: (q) => tecnico(q) || veOrdens(q) },
  { id: "DESPESA", rotulo: "Despesas de campo", dica: "Despesa enviada (escritório, para aprovar) e aprovada ou recusada (quem enviou).", podeReceber: (q) => tecnico(q) || p(q, "financeiro", "fluxoCaixa") },
  { id: "SOLICITACAO_PORTAL", rotulo: "Chamado novo do portal", dica: "O cliente abriu um chamado pelo Portal do Cliente.", podeReceber: (q) => escritorio(q) && veOrdens(q) },
  { id: "ORCAMENTO_RESPOSTA", rotulo: "Orçamento aprovado ou recusado", dica: "O cliente respondeu um orçamento pelo link.", podeReceber: (q) => escritorio(q) && p(q, "orcamentos", "visualizar") },
  { id: "ESTOQUE_NEGATIVO", rotulo: "Saldo negativo por uso em campo", dica: "O material lançado em campo deixou um produto com saldo negativo.", podeReceber: (q) => escritorio(q) && p(q, "estoque", "visualizar") },
];

const PREVISTOS: TipoPush[] = [];
/** Tipos que já existem na lista, mas cujo evento ainda nasce em outra leva (hoje, nenhum). */
export const ehPrevisto = (t: TipoPush) => PREVISTOS.includes(t);

/** Os tipos que esta pessoa pode receber (a tela de preferências mostra só estes). */
export function tiposDoUsuario(q: QuemRecebe): DefTipo[] {
  return TIPOS_PUSH.filter((t) => t.podeReceber(q));
}

/* ───────── Preferência por tipo (preferencias_usuario, chave "push:tipos") ───────── */

export const CHAVE_PREFERENCIA_PUSH = "push:tipos";
export type PreferenciaPush = Partial<Record<TipoPush, boolean>>;

/** O que veio do banco ou do navegador, sem confiar: só tipos conhecidos, só booleanos. */
export function lerPreferenciaPush(valor: unknown): PreferenciaPush {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const conhecidos = new Set<string>(TIPOS_PUSH.map((t) => t.id));
  const out: PreferenciaPush = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) if (conhecidos.has(k) && typeof v === "boolean") out[k as TipoPush] = v;
  return out;
}

/** Ligado, a não ser que a pessoa tenha desligado. O teste sempre vai (é ela quem pede). */
export function tipoLigado(pref: PreferenciaPush, tipo: TipoPush): boolean {
  if (tipo === "TESTE") return true;
  return pref[tipo] !== false;
}

/** Recebe este tipo? A permissão/escopo E a preferência. */
export function deveReceber(q: QuemRecebe, pref: PreferenciaPush, tipo: TipoPush): boolean {
  if (tipo === "TESTE") return true;
  const def = TIPOS_PUSH.find((t) => t.id === tipo);
  return !!def && def.podeReceber(q) && tipoLigado(pref, tipo);
}

/* ───────── Os textos (curtos: título com o que é, corpo com o contexto) ───────── */

export interface MensagemPush {
  titulo: string;
  corpo: string;
  /** Para onde o toque leva (caminho interno) */
  url: string;
  /** Agrupa no aparelho: a notificação nova da mesma coisa substitui a anterior */
  tag: string;
  /** Rótulo da ação (botão da notificação, onde o sistema mostra) */
  acao?: string;
}

/**
 * "qui. 12/03 às 14:30" — o dia e a hora de Brasília. Data só de dia (gravada à meia-noite UTC, o dia
 * civil da casa — lib/fuso › chaveDiaCivil) é aquele dia, sem hora: nunca a véspera.
 */
export function quandoBR(d: Date | string | null | undefined, comHora = true): string {
  if (!d) return "sem data marcada";
  const x = new Date(d);
  const chave = chaveDiaCivil(x);
  const [, mes, dia] = chave.split("-");
  const semana = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(new Date(`${chave}T12:00:00Z`));
  return `${semana} ${dia}/${mes}${comHora && !ehDiaCivil(x) ? ` às ${horaBR(x)}` : ""}`;
}

/** A OS no app do técnico (a atividade dele) e no escritório */
export const urlAppAtividade = (atividadeId: string) => `/tecnico?ver=os&a=${encodeURIComponent(atividadeId)}`;
export const urlOs = (osId: string) => `/ordens/${encodeURIComponent(osId)}`;

const juntar = (...xs: (string | null | undefined)[]) => xs.filter((x) => x && x.trim()).join(" · ");
const curto = (s: string | null | undefined, n = 120) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export interface AtividadeResumo {
  atividadeId: string; osId: string; osNumero: string; cliente?: string | null; titulo?: string | null;
  quando?: Date | string | null; soDia?: boolean;
}

export function msgOsNova(a: AtividadeResumo): MensagemPush {
  return {
    titulo: `Nova OS para você: ${a.osNumero}`,
    corpo: juntar(a.cliente, quandoBR(a.quando, !a.soDia), a.titulo),
    url: urlAppAtividade(a.atividadeId), tag: `atividade-${a.atividadeId}`, acao: "Abrir OS",
  };
}

export function msgOsReagendada(a: AtividadeResumo & { antes?: Date | string | null }): MensagemPush {
  const de = a.antes ? `de ${quandoBR(a.antes, !a.soDia)} ` : "";
  return {
    titulo: `OS reagendada: ${a.osNumero}`,
    corpo: juntar(a.cliente, `${de}para ${quandoBR(a.quando, !a.soDia)}`),
    url: urlAppAtividade(a.atividadeId), tag: `atividade-${a.atividadeId}`, acao: "Abrir OS",
  };
}

export function msgOsCancelada(a: { osNumero: string; cliente?: string | null; atividadeId: string; motivo?: string | null }): MensagemPush {
  return {
    titulo: `OS cancelada: ${a.osNumero}`,
    corpo: juntar(a.cliente, a.motivo ? `Motivo: ${curto(a.motivo, 80)}` : "Não precisa mais ir."),
    url: urlAppAtividade(a.atividadeId), tag: `atividade-${a.atividadeId}`, acao: "Ver",
  };
}

export function msgEsquecida(a: { osNumero: string; cliente?: string | null; desde: Date | string; tecnico?: string | null }, paraTecnico: boolean, url: string): MensagemPush {
  return {
    titulo: paraTecnico ? `Atividade ainda em andamento: ${a.osNumero}` : `Atividade esquecida em andamento: ${a.osNumero}`,
    corpo: juntar(a.cliente, paraTecnico ? null : a.tecnico, `desde ${quandoBR(a.desde)}`, paraTecnico ? "Conclua ou pause no app." : null),
    url, tag: `esquecida-${a.osNumero}`, acao: "Abrir OS",
  };
}

export interface AceiteResumo {
  osNumero: string; cliente?: string | null; avaliacao?: number | null; ressalva?: string | null; comentario?: string | null;
}

/** O aceite merece aviso? Ressalva, comentário ou nota baixa (o aceite limpo não incomoda ninguém). */
export function aceiteMereceAviso(a: AceiteResumo): boolean {
  return !!(a.ressalva ?? "").trim() || !!(a.comentario ?? "").trim() || ehNotaBaixa(a.avaliacao);
}

export function msgAceite(a: AceiteResumo, url: string): MensagemPush {
  const nota = ehNotaBaixa(a.avaliacao) ? `Nota ${a.avaliacao} de 5` : null;
  const o_que = (a.ressalva ?? "").trim() ? "com ressalva" : nota ? "com nota baixa" : "com comentário";
  return {
    titulo: `Aceite ${o_que}: ${a.osNumero}`,
    corpo: juntar(a.cliente, nota, curto(a.ressalva || a.comentario, 100)),
    url, tag: `aceite-${a.osNumero}`, acao: "Abrir OS",
  };
}

export function msgComentario(a: { osNumero: string; cliente?: string | null; autor?: string | null; texto?: string | null }, url: string): MensagemPush {
  return {
    titulo: `Comentário novo na OS ${a.osNumero}`,
    corpo: juntar(a.autor, curto(a.texto, 110) || a.cliente),
    url, tag: `comentario-${a.osNumero}`, acao: "Abrir OS",
  };
}

export type SituacaoDespesa = "ENVIADA" | "APROVADA" | "RECUSADA";
export function msgDespesa(a: { situacao: SituacaoDespesa; descricao?: string | null; valor?: number | null; autor?: string | null; motivo?: string | null }, url: string): MensagemPush {
  const valor = a.valor != null ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(a.valor) : null;
  const titulo = a.situacao === "ENVIADA" ? "Despesa para aprovar" : a.situacao === "APROVADA" ? "Despesa aprovada" : "Despesa recusada";
  return {
    titulo,
    corpo: juntar(a.situacao === "ENVIADA" ? a.autor : null, curto(a.descricao, 60), valor, a.situacao === "RECUSADA" && a.motivo ? `Motivo: ${curto(a.motivo, 60)}` : null),
    url, tag: `despesa-${url}`, acao: "Ver",
  };
}

export function msgSolicitacaoPortal(a: { osId: string; osNumero: string; cliente?: string | null; descricao?: string | null }): MensagemPush {
  return { titulo: `Chamado novo do portal: ${a.osNumero}`, corpo: juntar(a.cliente, curto(a.descricao, 100)), url: urlOs(a.osId), tag: `os-${a.osId}`, acao: "Abrir" };
}

export function msgRespostaOrcamento(a: { id: string; codigo: string; cliente?: string | null; aprovado: boolean }): MensagemPush {
  return {
    titulo: `Orçamento ${a.aprovado ? "aprovado" : "recusado"}: ${a.codigo}`,
    corpo: juntar(a.cliente, a.aprovado ? "O cliente aprovou pelo link." : "O cliente recusou pelo link."),
    url: `/orcamentos/${encodeURIComponent(a.id)}`, tag: `orcamento-${a.id}`, acao: "Abrir",
  };
}

export function msgEstoqueNegativo(a: { produto: string; saldo: number; unidade?: string | null; osNumero?: string | null }): MensagemPush {
  const saldo = `${a.saldo.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}${a.unidade ? ` ${a.unidade}` : ""}`;
  return { titulo: "Saldo negativo por uso em campo", corpo: juntar(a.produto, `saldo ${saldo}`, a.osNumero ? `OS ${a.osNumero}` : null), url: "/estoque?situacao=negativo", tag: "estoque-negativo", acao: "Ver estoque" };
}

export const MSG_TESTE: MensagemPush = { titulo: "Notificações ligadas", corpo: "Este aparelho vai receber os avisos do Frivo, mesmo com o app fechado.", url: "/", tag: "teste" };

/* ───────── O aparelho ───────── */

/** "iPhone · Safari", "Android · Chrome", "Windows · Edge" — para a lista de aparelhos */
export function rotuloAparelho(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const so = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Aparelho";
  const nav = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  return nav ? `${so} · ${nav}` : so;
}

/**
 * O iPhone só recebe push do app INSTALADO na tela de início (iOS 16.4+): no Safari comum o navegador
 * não oferece. Nesse caso a tela mostra a orientação curta em vez do botão.
 */
export function precisaInstalarNoIphone(userAgent: string | null | undefined, instalado: boolean): boolean {
  return /iPhone|iPad|iPod/.test(userAgent ?? "") && !instalado;
}

/** O navegador recusou a inscrição de vez (expirou ou foi revogada): apagar. 404 e 410 são definitivos. */
export function inscricaoMorta(statusHttp: number | null | undefined): boolean {
  return statusHttp === 404 || statusHttp === 410;
}
