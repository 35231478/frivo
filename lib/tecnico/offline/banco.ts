/**
 * Banco do APARELHO (IndexedDB) do app do técnico — um por usuário (dois técnicos no mesmo celular
 * não se misturam). Guarda:
 *  - `retratos`: o último retrato de cada atividade (para abrir sem sinal);
 *  - `fila`: as operações (respostas, fotos comprimidas, áudios, adicionais…) até o servidor confirmar;
 *  - `dados`: Meu dia, Agenda e marcas de sincronização.
 * Nada sai da fila sem confirmação do servidor E um retrato mais novo que já reflita a operação.
 */
import type { OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

const VERSAO = 1;

const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, falha) => { r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error); });
const fim = (t: IDBTransaction) => new Promise<void>((ok, falha) => { t.oncomplete = () => ok(); t.onerror = () => falha(t.error); t.onabort = () => falha(t.error); });

export interface RetratoGuardado { atividadeId: string; retrato: RetratoAtividade; salvoEm: number }

export class BancoTecnico {
  private constructor(private db: IDBDatabase) {}

  static async abrir(usuarioId: string, fabrica: IDBFactory = indexedDB): Promise<BancoTecnico> {
    const pedido = fabrica.open(`frivo-tecnico-${usuarioId}`, VERSAO);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains("retratos")) db.createObjectStore("retratos", { keyPath: "atividadeId" });
      if (!db.objectStoreNames.contains("fila")) {
        const fila = db.createObjectStore("fila", { keyPath: "seq", autoIncrement: true });
        fila.createIndex("id", "id", { unique: true });
        fila.createIndex("atividadeId", "atividadeId");
      }
      if (!db.objectStoreNames.contains("dados")) db.createObjectStore("dados");
    };
    return new BancoTecnico(await req(pedido));
  }

  fechar() { this.db.close(); }

  /* ── retratos ── */
  async retrato(atividadeId: string): Promise<RetratoGuardado | null> {
    return (await req(this.db.transaction("retratos").objectStore("retratos").get(atividadeId))) ?? null;
  }
  async retratos(): Promise<RetratoGuardado[]> {
    return req(this.db.transaction("retratos").objectStore("retratos").getAll());
  }
  /**
   * Guarda um retrato novo e, na MESMA transação, tira da fila as operações desta atividade já
   * confirmadas antes de o retrato ser pedido (`pedidoEm`) — elas já estão nele.
   */
  async guardarRetrato(retrato: RetratoAtividade, pedidoEm: number): Promise<void> {
    const t = this.db.transaction(["retratos", "fila"], "readwrite");
    const atividadeId = retrato.execucao.atividade.id;
    t.objectStore("retratos").put({ atividadeId, retrato, salvoEm: Date.now() } satisfies RetratoGuardado);
    const fila = t.objectStore("fila");
    const ops: OperacaoFila[] = await req(fila.index("atividadeId").getAll(atividadeId));
    for (const op of ops) if (op.estado === "enviada" && (op.enviadaEm ?? Infinity) <= pedidoEm) fila.delete(op.seq!);
    await fim(t);
  }
  async apagarRetrato(atividadeId: string) {
    const t = this.db.transaction("retratos", "readwrite");
    t.objectStore("retratos").delete(atividadeId);
    await fim(t);
  }

  /* ── fila ── */
  async fila(): Promise<OperacaoFila[]> {
    return req(this.db.transaction("fila").objectStore("fila").getAll());
  }
  async filaDaAtividade(atividadeId: string): Promise<OperacaoFila[]> {
    return req(this.db.transaction("fila").objectStore("fila").index("atividadeId").getAll(atividadeId));
  }
  async enfileirar(op: OperacaoFila): Promise<OperacaoFila> {
    const t = this.db.transaction("fila", "readwrite");
    const seq = await req(t.objectStore("fila").add(op));
    await fim(t);
    return { ...op, seq: seq as number };
  }
  /** Atualiza várias operações (estado, erro, tentativas) de uma vez. */
  async atualizar(ops: OperacaoFila[]): Promise<void> {
    if (!ops.length) return;
    const t = this.db.transaction("fila", "readwrite");
    for (const op of ops) t.objectStore("fila").put(op);
    await fim(t);
  }
  /** Tira operações da fila (só por decisão explícita do técnico — "descartar" — ou depois de refletidas). */
  async remover(seqs: number[]): Promise<void> {
    if (!seqs.length) return;
    const t = this.db.transaction("fila", "readwrite");
    for (const s of seqs) t.objectStore("fila").delete(s);
    await fim(t);
  }

  /* ── dados soltos (Meu dia, Agenda, marcas) ── */
  async ler<T>(chave: string): Promise<T | null> {
    return (await req(this.db.transaction("dados").objectStore("dados").get(chave))) ?? null;
  }
  async gravar(chave: string, valor: unknown): Promise<void> {
    const t = this.db.transaction("dados", "readwrite");
    t.objectStore("dados").put(valor, chave);
    await fim(t);
  }
}
