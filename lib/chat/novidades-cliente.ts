/**
 * CHAT-1 — o tempo real no navegador (escritório e app): UM laço de long-polling por endereço e por aba, que todos os
 * que querem saber de mensagem nova assinam (o ícone do topo, a lista e a conversa aberta não abrem três conexões).
 *
 *  - pergunta "mudou algo desde <marca>?"; o servidor segura até 8 s e responde na hora da mudança;
 *  - aba escondida: para (sem custo); ao voltar, pergunta na hora;
 *  - erro de rede: espera crescente (2 s, 4 s, 8 s… até 30 s);
 *  - `avisar()` força uma pergunta agora (ex.: a notificação push chegou, ou a pessoa acabou de enviar).
 */
import { esperaDepoisDeErro } from "@/lib/chat/regras";

export interface RespostaNovidades { marca: string; mudou: boolean; naoLidas?: number }
type Ouvinte = (r: RespostaNovidades) => void;

export interface AmbienteLaco {
  fetch: typeof fetch;
  escondida: () => boolean;
  /** Avisa quando a aba volta a aparecer (devolve como parar de ouvir) */
  aoAparecer: (cb: () => void) => () => void;
  dormir: (ms: number) => Promise<void>;
}

const ambientePadrao = (): AmbienteLaco => ({
  fetch: (...a) => fetch(...a),
  escondida: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  aoAparecer: (cb) => {
    const f = () => { if (document.visibilityState === "visible") cb(); };
    document.addEventListener("visibilitychange", f);
    window.addEventListener("focus", cb);
    return () => { document.removeEventListener("visibilitychange", f); window.removeEventListener("focus", cb); };
  },
  dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
});

export class LacoNovidades {
  private ouvintes = new Set<Ouvinte>();
  private marca: string | null = null;
  private ultima: RespostaNovidades | null = null;
  private rodando = false;
  /** Cada `rodar()` tem a sua vez: parar e assinar de novo no mesmo instante não deixa dois laços vivos */
  private geracao = 0;
  private controle: AbortController | null = null;
  private acordar: (() => void) | null = null;
  private pararDeOuvir: (() => void) | null = null;
  falhas = 0;

  constructor(readonly url: string, private amb: AmbienteLaco = ambientePadrao()) {}

  assinar(o: Ouvinte): () => void {
    this.ouvintes.add(o);
    if (this.ultima) o(this.ultima);
    if (!this.rodando) void this.rodar();
    return () => {
      this.ouvintes.delete(o);
      if (!this.ouvintes.size) this.parar();
    };
  }

  /** Pergunta agora (corta a espera em curso). */
  avisar() {
    this.controle?.abort();
    this.acordar?.();
  }

  parar() {
    this.geracao += 1;
    this.rodando = false;
    this.controle?.abort();
    this.acordar?.();
    this.pararDeOuvir?.();
    this.pararDeOuvir = null;
  }

  private esperarAparecer(): Promise<void> {
    return new Promise((r) => { this.acordar = () => { this.acordar = null; r(); }; });
  }

  private async rodar() {
    const vez = ++this.geracao;
    const minha = () => this.geracao === vez;
    this.rodando = true;
    this.pararDeOuvir = this.amb.aoAparecer(() => this.avisar());
    while (minha() && this.ouvintes.size) {
      if (this.amb.escondida()) { await this.esperarAparecer(); continue; }
      this.controle = new AbortController();
      try {
        const q = this.marca ? `${this.url.includes("?") ? "&" : "?"}desde=${encodeURIComponent(this.marca)}` : "";
        const res = await this.amb.fetch(`${this.url}${q}`, { signal: this.controle.signal, cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const r = (await res.json()) as RespostaNovidades;
        const primeira = this.marca === null;
        this.marca = r.marca;
        this.falhas = 0;
        if (r.mudou || primeira || r.naoLidas !== this.ultima?.naoLidas) {
          this.ultima = r;
          for (const o of [...this.ouvintes]) o(r);
        }
      } catch {
        if (!minha()) break;
        if (this.controle?.signal.aborted) continue; // `avisar()`: pergunta de novo na hora
        this.falhas += 1;
        await Promise.race([this.amb.dormir(esperaDepoisDeErro(this.falhas)), this.esperarAparecer()]);
      }
    }
    if (minha()) this.rodando = false;
  }
}

const lacos = new Map<string, LacoNovidades>();
/** O laço da aba para este endereço (criado na 1ª assinatura). */
export function lacoDe(url: string): LacoNovidades {
  let l = lacos.get(url);
  if (!l) { l = new LacoNovidades(url); lacos.set(url, l); }
  return l;
}

export const URL_NOVIDADES_ESCRITORIO = "/api/conversas/novidades";
export const URL_NOVIDADES_APP = "/api/tecnico/conversas/novidades";
