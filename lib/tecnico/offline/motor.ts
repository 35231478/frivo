/**
 * Motor de SINCRONIZAÇÃO do app do técnico. Cada gravação entra na fila do aparelho na hora (a tela
 * já mostra) e sobe sozinha quando dá: ao gravar com sinal, quando o sinal volta, quando o app volta
 * para a frente e a cada 30 s enquanto houver fila. Regras:
 *  - nunca perde: a operação só sai da fila depois que o servidor confirmou E chegou um retrato novo
 *    da atividade (que já a contém); recusa do servidor fica na fila, visível, com o motivo;
 *  - nunca duplica: cada operação tem id próprio e o servidor ignora o que já aplicou;
 *  - em ordem: lotes na ordem em que o técnico gravou (o servidor segura o resto da atividade se uma falhar);
 *  - lotes pequenos (o corpo da requisição tem limite): fotos já vão comprimidas.
 */
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import type { NovaOperacao, OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

export type Situacao = "offline" | "sincronizando" | "pendente" | "sincronizado" | "erro" | "sessao";
export interface EstadoSync {
  situacao: Situacao;
  /** Operações ainda não confirmadas pelo servidor */
  pendentes: number;
  /** Recusadas pelo servidor (ficam guardadas, com o motivo) */
  erros: number;
  ultimoSync: number | null;
  /** Muda a cada alteração da fila/retratos (a tela relê o banco) */
  versao: number;
}

export const LIMITE_LOTE_BYTES = 3_000_000;
export const MAX_LOTE = 40;
const INTERVALO_MS = 30_000;
const ESPERA_MAX_MS = 5 * 60_000;

export function novoId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = c?.getRandomValues ? c.getRandomValues(new Uint8Array(16)) : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Id curto gerado no aparelho para foto/áudio/adicional (o servidor usa para não duplicar). */
export const novoClientId = () => novoId().replace(/-/g, "");

/** Divide a fila em lotes (ordem mantida) que caibam no limite do corpo da requisição. */
export function emLotes<T>(ops: T[], tamanho: (o: T) => number = (o) => JSON.stringify(o).length): T[][] {
  const lotes: T[][] = [];
  let atual: T[] = [];
  let bytes = 0;
  for (const op of ops) {
    const n = tamanho(op);
    if (atual.length && (bytes + n > LIMITE_LOTE_BYTES || atual.length >= MAX_LOTE)) { lotes.push(atual); atual = []; bytes = 0; }
    atual.push(op); bytes += n;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

interface ResultadoServidor { id: string; ok: boolean; status: number; erro?: string; adiada?: boolean; repetida?: boolean }

/** Recusa definitiva (fica com erro até o técnico tentar de novo ou descartar)? 4xx menos sessão/limite. */
const definitiva = (status: number) => status >= 400 && status < 500 && ![401, 408, 429].includes(status);

export interface OpcoesMotor {
  fetch?: typeof fetch;
  online?: () => boolean;
  agora?: () => number;
}

export class MotorSync {
  private ouvintes = new Set<(e: EstadoSync) => void>();
  private estado: EstadoSync = { situacao: "sincronizado", pendentes: 0, erros: 0, ultimoSync: null, versao: 0 };
  private rodando: Promise<void> | null = null;
  private deNovo = false;
  private forcado = false;
  private semRede = false;
  private sessaoExpirada = false;
  private falhas = 0;
  private proximaTentativa = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private desligar: (() => void) | null = null;
  private fetch: typeof fetch;
  private online: () => boolean;
  private agora: () => number;

  constructor(readonly banco: BancoTecnico, op: OpcoesMotor = {}) {
    this.fetch = op.fetch ?? ((...a) => globalThis.fetch(...a));
    this.online = op.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
    this.agora = op.agora ?? Date.now;
  }

  /* ── estado observável ── */
  get atual() { return this.estado; }
  assinar(fn: (e: EstadoSync) => void) { this.ouvintes.add(fn); fn(this.estado); return () => { this.ouvintes.delete(fn); }; }
  private publicar(parcial: Partial<EstadoSync> = {}, mudouDados = false) {
    const base = { ...this.estado, ...parcial, versao: this.estado.versao + (mudouDados ? 1 : 0) };
    const situacao: Situacao = this.rodando ? "sincronizando"
      : this.sessaoExpirada ? "sessao"
        : !this.online() || this.semRede ? "offline"
          : base.erros ? "erro"
            : base.pendentes ? "pendente" : "sincronizado";
    this.estado = { ...base, situacao };
    for (const f of this.ouvintes) f(this.estado);
  }
  private async recontar(mudouDados = false) {
    const fila = await this.banco.fila();
    this.publicar({ pendentes: fila.filter((o) => o.estado !== "enviada").length, erros: fila.filter((o) => o.estado === "erro").length }, mudouDados);
  }

  /** Espera a rodada em andamento (se houver) terminar. */
  aguardar(): Promise<void> { return this.rodando ?? Promise.resolve(); }

  /* ── gravar ── */
  /** Põe operações na fila (a tela já mostra) e tenta subir logo. */
  async registrar(novas: NovaOperacao[]): Promise<OperacaoFila[]> {
    const feitas: OperacaoFila[] = [];
    for (const n of novas) {
      const op = { ...n, id: novoId(), em: new Date(this.agora()).toISOString(), criadoEm: new Date(this.agora()).toISOString(), estado: "pendente", tentativas: 0 } as OperacaoFila;
      feitas.push(await this.banco.enfileirar(op));
    }
    await this.recontar(true);
    void this.sincronizar();
    return feitas;
  }

  /** O técnico manda tentar de novo as recusadas (ex.: o escritório reabriu a atividade). */
  async tentarDeNovo() {
    const fila = await this.banco.fila();
    await this.banco.atualizar(fila.filter((o) => o.estado === "erro").map((o) => ({ ...o, estado: "pendente" as const })));
    this.sessaoExpirada = false; this.semRede = false; this.proximaTentativa = 0;
    await this.recontar(true);
    await this.sincronizar(true);
  }

  /** Descarta UMA operação recusada (decisão explícita do técnico). */
  async descartar(seq: number) {
    const op = (await this.banco.fila()).find((o) => o.seq === seq);
    if (!op || op.estado !== "erro") return false;
    await this.banco.remover([seq]);
    await this.recontar(true);
    return true;
  }

  /* ── baixar ── */
  async baixarRetrato(atividadeId: string): Promise<RetratoAtividade | null> {
    if (!this.online()) return null;
    const pedidoEm = this.agora();
    try {
      const r = await this.fetch(`/api/tecnico/atividades/${encodeURIComponent(atividadeId)}`, { cache: "no-store" });
      if (r.status === 401) { this.sessaoExpirada = true; this.publicar(); return null; }
      if (!r.ok) return null;
      const retrato: RetratoAtividade = await r.json();
      await this.banco.guardarRetrato(retrato, pedidoEm);
      this.semRede = false;
      await this.recontar(true);
      return retrato;
    } catch {
      this.semRede = true; this.publicar();
      return null;
    }
  }

  /** Baixa uma lista (Meu dia / Agenda), guarda no aparelho e devolve; sem sinal, devolve a guardada. */
  async baixarLista<T>(chave: "meuDia" | "agenda", url: string): Promise<{ dados: T | null; baixadoEm: number | null; doAparelho: boolean }> {
    const guardada = await this.banco.ler<{ dados: T; baixadoEm: number }>(chave);
    if (this.online()) {
      try {
        const r = await this.fetch(url, { cache: "no-store" });
        if (r.status === 401) { this.sessaoExpirada = true; this.publicar(); }
        else if (r.ok) {
          const dados: T = await r.json();
          const baixadoEm = this.agora();
          await this.banco.gravar(chave, { dados, baixadoEm });
          this.semRede = false; this.publicar();
          return { dados, baixadoEm, doAparelho: false };
        }
      } catch { this.semRede = true; this.publicar(); }
    }
    return { dados: guardada?.dados ?? null, baixadoEm: guardada?.baixadoEm ?? null, doAparelho: true };
  }

  /** Deixa no aparelho o retrato de cada atividade (para abrir sem sinal), 2 por vez. */
  async prepararSemSinal(atividadeIds: string[]) {
    const fila = [...new Set(atividadeIds)];
    const trabalhar = async () => { for (let id = fila.shift(); id; id = fila.shift()) await this.baixarRetrato(id); };
    await Promise.all([trabalhar(), trabalhar()]);
  }

  /* ── sincronizar ── */
  /** Sobe a fila. `forcar` ignora a espera entre tentativas (botão "Sincronizar agora"). */
  sincronizar(forcar = false): Promise<void> {
    // Já rodando: pede mais uma volta ao final (o que entrou na fila no meio também sobe)
    if (this.rodando) { this.deNovo = true; this.forcado ||= forcar; return this.rodando; }
    if (!forcar && this.agora() < this.proximaTentativa) return Promise.resolve();
    this.rodando = (async () => {
      try {
        do { this.deNovo = false; this.forcado = false; await this.rodar(); }
        while (this.deNovo && (this.forcado || (!this.semRede && !this.sessaoExpirada)));
      } finally {
        this.rodando = null;
        this.publicar();
      }
    })();
    this.publicar();
    return this.rodando;
  }

  private async rodar() {
    if (!this.online()) { await this.recontar(); return; }
    const toda = (await this.banco.fila()).sort((a, b) => a.seq! - b.seq!);
    // Em ordem POR ATIVIDADE: depois de uma recusada, as seguintes da mesma atividade esperam o técnico
    // resolver (tentar de novo ou descartar) — não se conclui por cima de uma resposta que não entrou
    const travada = new Map<string, number>();
    for (const o of toda) if (o.estado === "erro" && !travada.has(o.atividadeId)) travada.set(o.atividadeId, o.seq!);
    const fila = toda.filter((o) => o.estado === "pendente" && !(travada.has(o.atividadeId) && o.seq! > travada.get(o.atividadeId)!));
    const enviadas = new Set<string>();
    let falhouRede = false;
    for (const lote of emLotes(fila.map(({ seq: _s, criadoEm: _c, estado: _e, tentativas: _t, erro: _er, status: _st, enviadaEm: _en, ...op }) => op))) {
      let res: Response;
      try {
        res = await this.fetch("/api/tecnico/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operacoes: lote }), cache: "no-store" });
      } catch { falhouRede = true; break; }
      if (res.status === 401) { this.sessaoExpirada = true; break; }
      if (!res.ok) { falhouRede = true; break; }
      const { resultados } = (await res.json()) as { resultados: ResultadoServidor[] };
      const porId = new Map(resultados.map((r) => [r.id, r]));
      const mudadas: OperacaoFila[] = [];
      for (const op of fila.filter((o) => lote.some((l) => l.id === o.id))) {
        const r = porId.get(op.id);
        if (!r || r.adiada) continue;
        if (r.ok) { mudadas.push({ ...op, estado: "enviada", enviadaEm: this.agora(), erro: null, status: r.status }); enviadas.add(op.atividadeId); }
        else if (definitiva(r.status)) mudadas.push({ ...op, estado: "erro", erro: r.erro ?? "Recusada pelo servidor.", status: r.status, tentativas: op.tentativas + 1 });
        else mudadas.push({ ...op, erro: r.erro ?? null, status: r.status, tentativas: op.tentativas + 1 });
      }
      await this.banco.atualizar(mudadas);
    }
    this.semRede = falhouRede;
    if (falhouRede) {
      this.falhas += 1;
      this.proximaTentativa = this.agora() + Math.min(ESPERA_MAX_MS, 5_000 * 2 ** (this.falhas - 1));
    } else if (!this.sessaoExpirada) {
      this.falhas = 0; this.proximaTentativa = 0;
      this.estado = { ...this.estado, ultimoSync: this.agora() };
    }
    // Retrato novo de cada atividade que subiu: a tela passa a mostrar o que o servidor gravou
    for (const atividadeId of enviadas) await this.baixarRetrato(atividadeId);
    await this.recontar(true);
  }

  /* ── gatilhos ── */
  ligar() {
    if (this.desligar || typeof window === "undefined") return;
    const aoVoltar = () => { this.semRede = false; this.proximaTentativa = 0; void this.sincronizar(); };
    const aoCair = () => this.publicar();
    const aoMostrar = () => { if (document.visibilityState === "visible") void this.sincronizar(); };
    window.addEventListener("online", aoVoltar);
    window.addEventListener("offline", aoCair);
    document.addEventListener("visibilitychange", aoMostrar);
    this.timer = setInterval(() => { if (this.estado.pendentes) void this.sincronizar(); }, INTERVALO_MS);
    this.desligar = () => {
      window.removeEventListener("online", aoVoltar);
      window.removeEventListener("offline", aoCair);
      document.removeEventListener("visibilitychange", aoMostrar);
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
    void this.recontar().then(() => this.sincronizar());
  }
  parar() { this.desligar?.(); this.desligar = null; }
}
