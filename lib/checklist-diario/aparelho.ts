/**
 * Checklist obrigatório no app — a FILA NO APARELHO (como a fila curta da localização): o checklist feito (ou o "não
 * vou usar") é guardado no aparelho e LIBERA o app na hora; o envio sobe sozinho quando há sinal.
 *
 * - Nunca prende o técnico: o registro local vale para o porteiro do dia, mesmo antes de subir.
 * - Reenviar não duplica (client_id). Recusa do servidor (dado inválido, sem permissão): o envio sai da fila e o
 *   aviso fica para o Perfil — não adianta repetir e não volta a travar o app.
 * - Sem sinal ou erro do servidor: fica na fila e tenta de novo depois.
 */
import type { EnvioDiario } from "@/lib/checklist-diario/envio";
import type { SituacaoDiario } from "@/lib/checklist-diario/regras";

export interface RegistroLocal { dia: string; situacao: SituacaoDiario }
/** D13 — o checklist feito (o último, do dia): as respostas para corrigir até o fim do dia. A foto só "tem" (não pesa). */
export interface FeitoLocal { dia: string; itens: { itemTemplateId: string; valor: string | null; temFoto: boolean }[]; observacaoGeral: string | null }
export interface Guardado {
  /** O que ainda não subiu, na ordem do toque */
  pendentes: EnvioDiario[];
  /** O que o aparelho já registrou (subido ou não) — o porteiro usa para liberar o dia */
  registros: RegistroLocal[];
  /** Último envio recusado pelo servidor (mostrado no Perfil) */
  erro: string | null;
  /** D13 — o último checklist feito neste aparelho (as respostas, sem as fotos); ausente em guardados antigos */
  feito?: FeitoLocal | null;
}

export const GUARDADO_VAZIO: Guardado = { pendentes: [], registros: [], erro: null };
/** Quantos dias de registro o aparelho guarda (o porteiro só olha hoje) */
export const DIAS_GUARDADOS = 14;
const CHAVE = "porteiro:diario";

/** Registra um envio: entra na fila e marca o dia (o "feito" vale sobre o "não vou usar" do mesmo dia) */
export function comEnvio(g: Guardado, envio: EnvioDiario): Guardado {
  const outros = g.registros.filter((r) => r.dia !== envio.dia);
  const anterior = g.registros.find((r) => r.dia === envio.dia);
  const situacao: SituacaoDiario = anterior?.situacao === "FEITO" ? "FEITO" : envio.situacao;
  const registros = [...outros, { dia: envio.dia, situacao }].sort((a, b) => (a.dia < b.dia ? 1 : -1)).slice(0, DIAS_GUARDADOS);
  return { ...g, pendentes: [...g.pendentes.filter((p) => p.clientId !== envio.clientId), envio], registros, feito: feitoDoEnvio(g.feito ?? null, envio) };
}

/**
 * D13 — as respostas que ficam para corrigir: o checklist feito (ou a correção) passa a ser "o feito do dia". Na
 * correção, o item sem foto nova continua "com foto" se já tinha.
 */
export function feitoDoEnvio(anterior: FeitoLocal | null, envio: EnvioDiario): FeitoLocal | null {
  if (envio.situacao !== "FEITO") return anterior;
  const tinha = new Set(envio.correcao && anterior?.dia === envio.dia ? anterior.itens.filter((i) => i.temFoto).map((i) => i.itemTemplateId) : []);
  return {
    dia: envio.dia,
    itens: envio.itens.map((i) => ({ itemTemplateId: i.itemTemplateId, valor: i.valor ?? null, temFoto: !!i.foto || tinha.has(i.itemTemplateId) })),
    observacaoGeral: envio.observacaoGeral ?? null,
  };
}

/**
 * D13 — o checklist de HOJE que dá para corrigir: o do aparelho (o mais novo, também sem sinal) ou o que o servidor
 * mandou na página. Outro dia: nenhum (a correção vale só até o fim do dia).
 */
export function feitoParaCorrigir(g: Guardado | null, servidor: FeitoLocal | null | undefined, hoje: string): FeitoLocal | null {
  if (g?.feito?.dia === hoje) return g.feito;
  return servidor?.dia === hoje ? servidor : null;
}

/** Situação registrada no aparelho para o dia (null = nada) */
export const situacaoLocal = (g: Guardado, dia: string): SituacaoDiario | null => g.registros.find((r) => r.dia === dia)?.situacao ?? null;

/** O que fazer com a resposta do servidor para um envio */
export type DestinoEnvio = "enviado" | "descartar" | "tentarDepois";
export function destinoDaResposta(status: number | null): DestinoEnvio {
  if (status === null) return "tentarDepois"; // sem rede
  if (status >= 200 && status < 300) return "enviado";
  if (status === 401 || status === 408 || status === 429 || status >= 500) return "tentarDepois"; // sessão/servidor: de novo depois
  return "descartar"; // 400/403/404/409…: repetir não adianta
}

export interface Armazem { ler(): Promise<Guardado>; gravar(g: Guardado): Promise<void> }

/** No banco do aparelho (IndexedDB do app, um por usuário) */
export function armazemDoBanco(banco: { ler<T>(c: string): Promise<T | null>; gravar(c: string, v: unknown): Promise<void> }): Armazem {
  return {
    ler: async () => ({ ...GUARDADO_VAZIO, ...((await banco.ler<Guardado>(CHAVE)) ?? {}) }),
    gravar: (g) => banco.gravar(CHAVE, g),
  };
}

/** Sem banco no aparelho (aba anônima antiga): só na memória — some ao fechar, mas não trava nada */
export function armazemNaMemoria(): Armazem {
  let g: Guardado = { ...GUARDADO_VAZIO };
  return { ler: async () => g, gravar: async (n) => { g = n; } };
}

export interface OpcoesFila { fetch?: typeof fetch; url?: string }

export class FilaDiario {
  private enviando: Promise<void> | null = null;
  private fetch: typeof fetch;
  private url: string;
  constructor(private armazem: Armazem, opcoes: OpcoesFila = {}) {
    this.fetch = opcoes.fetch ?? ((...a) => fetch(...a));
    this.url = opcoes.url ?? "/api/tecnico/checklist-diario";
  }

  ler(): Promise<Guardado> { return this.armazem.ler(); }

  /** Guarda (libera o dia na hora) e tenta subir em seguida, sem esperar */
  async registrar(envio: EnvioDiario): Promise<Guardado> {
    const g = comEnvio(await this.armazem.ler(), envio);
    await this.armazem.gravar(g);
    void this.enviar();
    return g;
  }

  /** Sobe o que estiver na fila, na ordem; para no primeiro "tente depois" (sem sinal) */
  enviar(): Promise<void> {
    if (this.enviando) return this.enviando;
    this.enviando = (async () => {
      try {
        for (;;) {
          const g = await this.armazem.ler();
          const envio = g.pendentes[0];
          if (!envio) return;
          let status: number | null = null;
          let erro: string | null = null;
          try {
            const r = await this.fetch(this.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(envio), cache: "no-store" });
            status = r.status;
            if (!r.ok) erro = ((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "O checklist do veículo não pôde ser enviado.";
          } catch { status = null; }
          const destino = destinoDaResposta(status);
          if (destino === "tentarDepois") return;
          const atual = await this.armazem.ler();
          await this.armazem.gravar({ ...atual, pendentes: atual.pendentes.filter((p) => p.clientId !== envio.clientId), erro: destino === "descartar" ? erro : atual.erro });
        }
      } finally { this.enviando = null; }
    })();
    return this.enviando;
  }
}
