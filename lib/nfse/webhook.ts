/**
 * NFS-e PR3 (B) — regras puras do aviso automático (webhook) do PlugNotas e da reconciliação.
 *
 * O webhook é só um AVISO: o corpo que chega nunca muda a nota. Ele diz QUAIS notas olhar (pelo
 * id do PlugNotas ou pelo nosso idIntegracao) e o servidor consulta a situação real no PlugNotas
 * (o mesmo padrão do webhook do Inter). A URL leva um segredo próprio da empresa (nunca o token do
 * PlugNotas); no banco fica só o hash dele.
 *
 * Reconciliação: nota que ficou esperando (ENVIANDO/PROCESSANDO) sem aviso é consultada de tempos
 * em tempos, cada vez mais espaçado conforme envelhece.
 */
import { createHash, randomBytes } from "node:crypto";
import { aguardandoResposta } from "@/lib/nfse/nota";

/** Segredo novo da URL do webhook: 32 bytes aleatórios em hex (64 caracteres) */
export const gerarSegredoWebhook = () => randomBytes(32).toString("hex");
/** O que fica no banco: só o SHA-256 do segredo (quem lê o banco não monta a URL) */
export const hashSegredo = (segredo: string) => createHash("sha256").update(segredo, "utf8").digest("hex");
const FORMATO_SEGREDO = /^[a-f0-9]{64}$/;

export const CAMINHO_WEBHOOK = "/api/webhooks/plugnotas";
export function urlWebhook(base: string, segredo: string) {
  return `${base.replace(/\/+$/, "")}${CAMINHO_WEBHOOK}?token=${segredo}`;
}

/**
 * O segredo que veio na chamada: na URL (?token=) ou no cabeçalho (Authorization: Bearer / x-webhook-token).
 * Fora do formato = null (nem chega a consultar o banco).
 */
export function segredoDaChamada(token: string | null, headers: { get(nome: string): string | null }): string | null {
  const auth = headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  for (const c of [token, auth, headers.get("x-webhook-token")]) {
    const v = c?.trim().toLowerCase();
    if (v && FORMATO_SEGREDO.test(v)) return v;
  }
  return null;
}

/* ───────── O que o aviso aponta ───────── */
export interface RefAviso { id: string | null; idIntegracao: string | null }
/** Máximo de notas que um aviso manda consultar (o resto espera a reconciliação) */
export const MAX_REFS_AVISO = 20;
const FORMATO_ID = /^[\w.:-]{1,100}$/;
const texto = (v: unknown) => (typeof v === "string" && FORMATO_ID.test(v.trim()) ? v.trim() : null);

/**
 * Lê do corpo do aviso as notas a consultar, aceitando as variações de formato (o corpo é uma nota,
 * uma lista, ou vem dentro de `documents`/`data`/`nfse`/`documento`). Só ids no formato; sem repetidos.
 */
export function referenciasDoAviso(corpo: unknown): RefAviso[] {
  const refs: RefAviso[] = [];
  const vistos = new Set<string>();
  const visitar = (v: unknown, nivel: number) => {
    if (refs.length >= MAX_REFS_AVISO || nivel > 3 || v == null || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v.slice(0, MAX_REFS_AVISO * 2)) visitar(x, nivel + 1); return; }
    const o = v as Record<string, unknown>;
    const id = texto(o.id) ?? texto(o._id) ?? texto(o.idNota) ?? texto(o.idNfse);
    const idIntegracao = texto(o.idIntegracao);
    if (id || idIntegracao) {
      const chave = `${id ?? ""}|${idIntegracao ?? ""}`;
      if (!vistos.has(chave)) { vistos.add(chave); refs.push({ id, idIntegracao }); }
      return;
    }
    for (const k of ["documents", "documentos", "data", "nfse", "documento", "nota"]) visitar(o[k], nivel + 1);
  };
  visitar(corpo, 0);
  return refs;
}

/* ───────── Reconciliação ───────── */
const MIN = 60_000;
/** Antes disto a tela (que consulta sozinha) e o aviso cuidam da nota */
export const IDADE_MIN_RECONCILIAR_MS = 2 * MIN;
/** Esperando há mais que isto: aparece no sino como "aguardando a prefeitura" */
export const ATRASO_AVISO_MS = 30 * MIN;
/** Notas consultadas por rodada de reconciliação (por empresa) */
export const LOTE_RECONCILIAR = 10;

/** De quanto em quanto tempo consultar uma nota parada, conforme a idade dela */
export function intervaloReconciliacao(idadeMs: number) {
  if (idadeMs < 30 * MIN) return MIN;
  if (idadeMs < 6 * 60 * MIN) return 10 * MIN;
  return 60 * MIN;
}

export interface NotaParada { status: string; criadoEm: Date; ultimaConsultaEm: Date | null }

/** A nota está esperando resposta, já passou do tempo da tela e a última consulta é antiga o bastante */
export function precisaReconciliar(n: NotaParada, agora: Date) {
  if (!aguardandoResposta(n.status)) return false;
  const idade = agora.getTime() - n.criadoEm.getTime();
  if (idade < IDADE_MIN_RECONCILIAR_MS) return false;
  if (!n.ultimaConsultaEm) return true;
  return agora.getTime() - n.ultimaConsultaEm.getTime() >= intervaloReconciliacao(idade);
}

/** Esperando a prefeitura há tempo demais (sino) */
export const notaAtrasada = (n: { status: string; criadoEm: Date }, agora: Date) =>
  aguardandoResposta(n.status) && agora.getTime() - n.criadoEm.getTime() >= ATRASO_AVISO_MS;

/** Resultado que o sino avisa até alguém ver: autorizada ou não aceita */
export const STATUS_AVISO_OK = ["CONCLUIDO"] as const;
export const STATUS_AVISO_PROBLEMA = ["REJEITADO", "INTERROMPIDO"] as const;
export const STATUS_FINAIS = ["CONCLUIDO", "REJEITADO", "CANCELADO", "INTERROMPIDO"] as const;
