/**
 * RASTREIO do app do técnico: lê a localização do aparelho nos momentos-chave e envia ao servidor
 * (Operações › Mapa). Só existe com "Rastrear localização dos técnicos" ligado na empresa — desligado,
 * este objeto nem é criado, e o que sobrou no aparelho é apagado.
 *
 * App web (PWA): a leitura só acontece com o app ABERTO, na frente — ao abrir, ao tocar "Cheguei", ao
 * iniciar e concluir a execução, ao sincronizar e a cada poucos minutos. Com o app fechado ou em
 * segundo plano o navegador não deixa ler; isso é do app nativo, que enviará para o MESMO endpoint.
 *
 * Offline: cada leitura entra numa fila curta no aparelho e sobe quando há sinal (o servidor fica com
 * a mais nova). Fechar e reabrir o app não perde a fila. Nunca trava o técnico: sem permissão, sem GPS
 * ou sem rede, o app segue — só não há posição nova.
 */
import type { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { nivelBateria, permissaoLocalizacao, posicaoAtual, type Bateria, type Coordenadas } from "@/lib/tecnico/geo";
import type { Leitura, MotivoPosicao } from "@/lib/tecnico/posicao";

const CHAVE_FILA = "rastreio:fila";
/** Leituras guardadas no aparelho à espera de sinal (as mais antigas saem; o servidor só quer a última) */
export const MAX_FILA_POSICOES = 20;
/** De quanto em quanto tempo o app lê a posição sozinho, enquanto está aberto na frente */
export const INTERVALO_PERIODICO_MS = 5 * 60_000;
/** Menor espaço entre leituras que não são momentos-chave (abrir, sincronizar, periódica) */
export const INTERVALO_MINIMO_MS = 60_000;
/** Momentos-chave: sempre leem, sem esperar o intervalo mínimo */
const MOMENTOS_CHAVE: readonly MotivoPosicao[] = ["CHEGUEI", "INICIO", "CONCLUSAO"];

export interface EstadoRastreio {
  /** Como foi a última tentativa de ler a posição */
  leitura: "nunca" | "ok" | "sem-permissao" | "sem-gps";
  ultimaLeituraEm: number | null;
  ultimoEnvioEm: number | null;
  /** Leituras no aparelho à espera de sinal */
  aEnviar: number;
  /** A empresa desligou o rastreamento (o servidor avisou): o app parou de ler */
  desligado: boolean;
}

export interface OpcoesRastreio {
  fetch?: typeof fetch;
  online?: () => boolean;
  agora?: () => number;
  ler?: () => Promise<Coordenadas | null>;
  bateria?: () => Promise<Bateria | null>;
  permissao?: () => Promise<PermissionState | "indisponivel">;
  visivel?: () => boolean;
}

export class Rastreio {
  private ouvintes = new Set<(e: EstadoRastreio) => void>();
  private estado: EstadoRastreio = { leitura: "nunca", ultimaLeituraEm: null, ultimoEnvioEm: null, aEnviar: 0, desligado: false };
  private lendo: Promise<boolean> | null = null;
  private enviando: Promise<void> | null = null;
  private ultimaTentativa = -Infinity;
  private timer: ReturnType<typeof setInterval> | null = null;
  private desligar: (() => void) | null = null;
  private fetch: typeof fetch;
  private online: () => boolean;
  private agora: () => number;
  private ler: () => Promise<Coordenadas | null>;
  private bateria: () => Promise<Bateria | null>;
  private permissao: () => Promise<PermissionState | "indisponivel">;
  private visivel: () => boolean;

  constructor(private banco: BancoTecnico, op: OpcoesRastreio = {}) {
    this.fetch = op.fetch ?? ((...a) => globalThis.fetch(...a));
    this.online = op.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
    this.agora = op.agora ?? Date.now;
    this.ler = op.ler ?? (() => posicaoAtual());
    this.bateria = op.bateria ?? nivelBateria;
    this.permissao = op.permissao ?? permissaoLocalizacao;
    this.visivel = op.visivel ?? (() => typeof document === "undefined" || document.visibilityState === "visible");
  }

  /** O que sobrou no aparelho de quando o rastreamento estava ligado: apaga (a empresa desligou). */
  static async esquecer(banco: BancoTecnico): Promise<void> {
    await banco.apagar([CHAVE_FILA]).catch(() => undefined);
  }

  get atual() { return this.estado; }
  assinar(fn: (e: EstadoRastreio) => void) { this.ouvintes.add(fn); fn(this.estado); return () => { this.ouvintes.delete(fn); }; }
  private publicar(parcial: Partial<EstadoRastreio>) {
    this.estado = { ...this.estado, ...parcial };
    for (const f of this.ouvintes) f(this.estado);
  }
  private async fila(): Promise<Leitura[]> {
    return (await this.banco.ler<Leitura[]>(CHAVE_FILA).catch(() => null)) ?? [];
  }

  /**
   * Lê a posição agora e tenta enviar. Momentos-chave sempre leem; os outros respeitam o intervalo
   * mínimo. Devolve true quando houve leitura. Nunca lança.
   */
  capturar(motivo: MotivoPosicao): Promise<boolean> {
    if (this.estado.desligado) return Promise.resolve(false);
    const chave = MOMENTOS_CHAVE.includes(motivo);
    if (!chave && (this.lendo || this.agora() - this.ultimaTentativa < INTERVALO_MINIMO_MS)) return Promise.resolve(false);
    const antes = this.lendo ?? Promise.resolve(false);
    this.ultimaTentativa = this.agora();
    const minha: Promise<boolean> = antes.catch(() => false).then(() => this.lerEGuardar(motivo)).finally(() => { if (this.lendo === minha) this.lendo = null; });
    this.lendo = minha;
    return minha;
  }

  private async lerEGuardar(motivo: MotivoPosicao): Promise<boolean> {
    try {
      const [pos, bat] = await Promise.all([this.ler().catch(() => null), this.bateria().catch(() => null)]);
      if (this.estado.desligado) return false;
      if (!pos) {
        const p = await this.permissao().catch(() => "indisponivel" as const);
        this.publicar({ leitura: p === "denied" ? "sem-permissao" : "sem-gps" });
        void this.enviar(); // o que já estava na fila ainda pode subir
        return false;
      }
      const leitura: Leitura = {
        lat: pos.lat, lng: pos.lng, precisao: pos.precisao ?? null,
        bateria: bat?.nivel ?? null, carregando: bat ? bat.carregando : null,
        em: new Date(this.agora()).toISOString(), motivo,
      };
      const fila = [...await this.fila(), leitura].slice(-MAX_FILA_POSICOES);
      await this.banco.gravar(CHAVE_FILA, fila);
      this.publicar({ leitura: "ok", ultimaLeituraEm: this.agora(), aEnviar: fila.length });
      void this.enviar();
      return true;
    } catch {
      return false; // aparelho sem espaço etc.: o rastreio nunca atrapalha o trabalho
    }
  }

  /** Sobe a fila (se houver sinal). Uma rodada por vez; o que entrar no meio sobe na seguinte. */
  enviar(): Promise<void> {
    if (this.enviando) return this.enviando;
    const rodada: Promise<void> = this.rodar().catch(() => undefined).finally(() => { if (this.enviando === rodada) this.enviando = null; });
    this.enviando = rodada;
    return rodada;
  }

  private async rodar(): Promise<void> {
    const fila = await this.fila();
    this.publicar({ aEnviar: fila.length });
    if (!fila.length || !this.online()) return;
    let res: Response;
    try {
      res = await this.fetch("/api/tecnico/posicao", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ posicoes: fila, agora: new Date(this.agora()).toISOString(), origem: "PWA" }),
      });
    } catch { return; } // sem rede: a fila fica
    // 4xx que não é sessão/limite = o servidor nunca vai aceitar este lote: não fica preso tentando
    const recusado = res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status);
    if (!res.ok && !recusado) return;
    const corpo = res.ok ? (await res.json().catch(() => null)) as { rastreio?: boolean } | null : null;
    // Tira da fila só o que foi neste envio (o que entrou durante o envio fica para o próximo)
    const enviadas = new Set(fila.map((l) => l.em));
    const resto = (await this.fila()).filter((l) => !enviadas.has(l.em));
    if (corpo && corpo.rastreio === false) {
      // A empresa desligou: para de ler e apaga o que estava guardado
      await Rastreio.esquecer(this.banco);
      this.publicar({ desligado: true, aEnviar: 0 });
      this.parar();
      return;
    }
    await this.banco.gravar(CHAVE_FILA, resto);
    this.publicar({ aEnviar: resto.length, ...(res.ok && { ultimoEnvioEm: this.agora() }) });
    if (resto.length) void Promise.resolve().then(() => this.enviar());
  }

  /* ── gatilhos do app aberto ── */
  ligar() {
    if (this.desligar || typeof window === "undefined") return;
    const aoVoltarSinal = () => { void this.enviar(); };
    const aoMostrar = () => { if (this.visivel()) void this.capturar("ABRIU_APP"); };
    window.addEventListener("online", aoVoltarSinal);
    document.addEventListener("visibilitychange", aoMostrar);
    // Só com o app na frente: em segundo plano o navegador não entrega a posição
    this.timer = setInterval(() => { if (this.visivel()) void this.capturar("PERIODICO"); }, INTERVALO_PERIODICO_MS);
    this.desligar = () => {
      window.removeEventListener("online", aoVoltarSinal);
      document.removeEventListener("visibilitychange", aoMostrar);
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
    void this.fila().then((f) => { this.publicar({ aEnviar: f.length }); void this.enviar(); });
    void this.capturar("ABRIU_APP");
  }
  parar() { this.desligar?.(); this.desligar = null; }
}

/** O momento-chave que uma gravação do técnico representa (null = não é um). */
export function motivoDaOperacao(op: { tipo: string; dados?: unknown }): MotivoPosicao | null {
  if (op.tipo === "concluir") return "CONCLUSAO";
  if (op.tipo === "iniciar") return "INICIO";
  if (op.tipo === "avisoCliente" && (op.dados as { evento?: string } | undefined)?.evento === "CHEGOU") return "CHEGUEI";
  return null;
}
