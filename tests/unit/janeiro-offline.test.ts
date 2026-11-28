// @vitest-environment happy-dom
/**
 * "App pronto pra janeiro" — a fila do app do técnico (IndexedDB de verdade, motor de verdade, servidor fingido):
 *  - sessão vencida: a API que ainda REDIRECIONA para o /login (HTML 200) vira "Entre de novo" — sem estourar o
 *    JSON, sem perder a fila e sem passar por "sem sinal";
 *  - resposta que não é a do sync (portal de Wi-Fi, proxy): tenta de novo mais tarde, sem estourar;
 *  - QR recusado (equipamento de outro cliente) NÃO trava o resto do serviço da OS; outra recusa continua travando;
 *  - OS cancelada com trabalho feito sem sinal: "descartar todas desta OS" leva a recusada e as que esperavam
 *    (o que já subiu e o que é de outra OS ficam).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync, sessaoAcabou, travaAtividade } from "@/lib/tecnico/offline/motor";
import type { NovaOperacao } from "@/lib/tecnico/offline/tipos";

type Modo = "normal" | "login" | "html";
function servidor() {
  const s = {
    online: true,
    modo: "normal" as Modo,
    aplicadas: [] as { tipo: string; atividadeId: string }[],
    recusar: new Map<string, { status: number; erro: string }>(),
    fetch: (async (url: string, init?: RequestInit) => {
      if (!s.online) throw new TypeError("Failed to fetch");
      if (s.modo === "login") {
        // O que o navegador entrega depois de seguir o redirecionamento do middleware antigo
        const r = new Response("<!DOCTYPE html><html><body>Entrar</body></html>", { status: 200, headers: { "content-type": "text/html" } });
        Object.defineProperty(r, "redirected", { value: true });
        Object.defineProperty(r, "url", { value: "http://localhost/login?callbackUrl=%2Fapi%2Ftecnico%2Fsync" });
        return r;
      }
      if (s.modo === "html") return new Response("<html>Conecte-se ao Wi-Fi</html>", { status: 200, headers: { "content-type": "text/html" } });
      if (url.startsWith("/api/tecnico/atividades/")) return new Response("{}", { status: 404 });
      if (url === "/api/tecnico/sync") {
        const { operacoes } = JSON.parse(String(init!.body));
        const travadas = new Set<string>();
        const resultados = operacoes.map((o: any) => {
          if (travadas.has(o.atividadeId)) return { id: o.id, ok: false, status: 0, adiada: true };
          const rec = s.recusar.get(o.tipo);
          if (rec) { if (o.tipo !== "scan") travadas.add(o.atividadeId); return { id: o.id, ok: false, ...rec }; }
          s.aplicadas.push({ tipo: o.tipo, atividadeId: o.atividadeId });
          return { id: o.id, ok: true, status: 200 };
        });
        return new Response(JSON.stringify({ resultados }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch,
  };
  return s;
}

let banco: BancoTecnico;
let s: ReturnType<typeof servidor>;
let motor: MotorSync;
let relogio = 1_000;
const rejeicoes: unknown[] = [];
const naoTratada = (e: PromiseRejectionEvent | any) => rejeicoes.push(e?.reason ?? e);
const resposta = (atividadeId: string, itemId: string): NovaOperacao => ({ tipo: "resposta", atividadeId, equipamentoId: "eqA", itemId, dados: { status: "OK" } } as NovaOperacao);
/** A fila sem o que já subiu (a "enviada" fica até chegar o retrato novo, que este servidor não manda) */
const naoSubiu = async () => (await banco.fila()).filter((o) => o.estado !== "enviada");
const scan = (atividadeId: string): NovaOperacao => ({ tipo: "scan", atividadeId, valor: "QR-DE-OUTRO-CLIENTE" } as NovaOperacao);

beforeEach(async () => {
  (globalThis as any).indexedDB = new IDBFactory();
  banco = await BancoTecnico.abrir("uJan");
  s = servidor();
  relogio = 1_000;
  motor = new MotorSync(banco, { fetch: s.fetch, online: () => s.online, agora: () => (relogio += 10) });
  rejeicoes.length = 0;
  process.on("unhandledRejection", naoTratada);
});
afterEach(() => { motor.parar(); process.off("unhandledRejection", naoTratada); });

describe("sessão vencida com a fila cheia", () => {
  it("a API que redireciona para o /login vira 'Entre de novo': nada estoura, nada some, não passa por 'Offline'", async () => {
    s.modo = "login";
    await motor.registrar([resposta("aA", "i1"), resposta("aA", "i2")]);
    await motor.aguardar();
    expect(motor.atual.situacao).toBe("sessao");
    expect((await banco.fila()).map((o) => o.estado)).toEqual(["pendente", "pendente"]);
    expect(rejeicoes).toEqual([]);
    // entrou de novo: sobe tudo
    s.modo = "normal";
    await motor.tentarDeNovo();
    expect(s.aplicadas.map((a) => a.tipo)).toEqual(["resposta", "resposta"]);
    expect(await naoSubiu()).toEqual([]);
  });

  it("a leitura do retrato e das listas também entende o /login (antes: JSON quebrado)", async () => {
    s.modo = "login";
    expect(await motor.baixarRetrato("aA")).toBeNull();
    expect(motor.atual.situacao).toBe("sessao");
    const r = await motor.baixarLista("meuDia", "/api/tecnico/meu-dia");
    expect(r).toMatchObject({ dados: null, doAparelho: true });
    expect(rejeicoes).toEqual([]);
  });

  it("resposta que não é a do sync (portal de Wi-Fi): fica no aparelho e tenta depois, sem estourar", async () => {
    s.modo = "html";
    await motor.registrar([resposta("aA", "i1")]);
    await motor.aguardar();
    expect(motor.atual.situacao).toBe("offline");
    expect((await banco.fila()).map((o) => o.estado)).toEqual(["pendente"]);
    expect(rejeicoes).toEqual([]);
  });

  it("sessaoAcabou: 401, ou redirecionado para o /login — mais nada", () => {
    const r = (status: number, redirected = false, url = "") => ({ status, redirected, url });
    expect(sessaoAcabou(r(401))).toBe(true);
    expect(sessaoAcabou(r(200, true, "http://x/login?callbackUrl=%2Ftecnico"))).toBe(true);
    expect(sessaoAcabou(r(200, true, "/login"))).toBe(true);
    expect(sessaoAcabou(r(200, true, "http://x/tecnico"))).toBe(false); // redirecionou, mas não para o login
    expect(sessaoAcabou(r(200, true, "http://x/login-antigo"))).toBe(false);
    expect(sessaoAcabou(r(200, false, "http://x/login"))).toBe(false); // não redirecionou
    expect(sessaoAcabou(r(403))).toBe(false);
  });
});

describe("QR recusado não trava o serviço", () => {
  it("QR de equipamento de outro cliente recusado: as respostas que vieram depois, da mesma OS, sobem", async () => {
    s.recusar.set("scan", { status: 409, erro: "O Split salão é de outro cliente: não entra nesta OS." });
    await motor.registrar([scan("aA")]);
    await motor.aguardar();
    await motor.registrar([resposta("aA", "i1"), resposta("aA", "i2")]);
    await motor.aguardar();
    expect(s.aplicadas).toEqual([{ tipo: "resposta", atividadeId: "aA" }, { tipo: "resposta", atividadeId: "aA" }]);
    const fila = await naoSubiu();
    expect(fila.map((o) => [o.tipo, o.estado])).toEqual([["scan", "erro"]]);
    expect(fila[0].erro).toContain("outro cliente");
    expect(motor.atual.situacao).toBe("erro"); // o cabeçalho ainda avisa a recusa
  });

  it("outra recusa (ex.: concluir) continua travando as seguintes da mesma OS — e não as de outra OS", async () => {
    s.recusar.set("concluir", { status: 422, erro: "Falta o resumo." });
    await motor.registrar([{ tipo: "concluir", atividadeId: "aA", dados: {} } as NovaOperacao]);
    await motor.aguardar();
    await motor.registrar([resposta("aA", "i1"), resposta("aB", "i1")]);
    await motor.aguardar();
    expect(s.aplicadas).toEqual([{ tipo: "resposta", atividadeId: "aB" }]);
    expect((await naoSubiu()).map((o) => [o.tipo, o.atividadeId, o.estado])).toEqual([["concluir", "aA", "erro"], ["resposta", "aA", "pendente"]]);
  });

  it("travaAtividade: só a recusa que não é de QR", () => {
    expect(travaAtividade({ estado: "erro", tipo: "scan" } as any)).toBe(false);
    expect(travaAtividade({ estado: "erro", tipo: "resposta" } as any)).toBe(true);
    expect(travaAtividade({ estado: "pendente", tipo: "resposta" } as any)).toBe(false);
    expect(travaAtividade({ estado: "enviada", tipo: "concluir" } as any)).toBe(false);
  });
});

describe("OS cancelada com trabalho feito sem sinal", () => {
  it("'descartar todas desta OS' leva a recusada e as que esperavam; o que subiu e a outra OS ficam", async () => {
    s.online = false;
    await motor.registrar([{ tipo: "iniciar", atividadeId: "aA" } as NovaOperacao, resposta("aA", "i1"), resposta("aA", "i2"), resposta("aB", "i9")]);
    await motor.aguardar();
    // o escritório cancelou a aA; a aB segue
    s.recusar.set("iniciar", { status: 409, erro: "Atividade cancelada: a execução não pode ser alterada." });
    s.online = true;
    await motor.sincronizar(true);
    expect((await naoSubiu()).map((o) => [o.tipo, o.atividadeId, o.estado])).toEqual([["iniciar", "aA", "erro"], ["resposta", "aA", "pendente"], ["resposta", "aA", "pendente"]]);
    expect(await motor.descartarDaAtividade("aA")).toBe(3);
    expect(await naoSubiu()).toEqual([]);
    expect((await banco.fila()).map((o) => [o.atividadeId, o.estado])).toEqual([["aB", "enviada"]]); // a outra OS subiu e fica até o retrato
    expect(motor.atual).toMatchObject({ pendentes: 0, erros: 0 });
    expect(s.aplicadas).toEqual([{ tipo: "resposta", atividadeId: "aB" }]);
    expect(await motor.descartarDaAtividade("aA")).toBe(0); // nada mais
  });

  it("não leva o que já subiu (enviada) nem o de outra OS", async () => {
    await motor.registrar([resposta("aA", "i1")]);
    await motor.aguardar(); // subiu (fica 'enviada' até chegar o retrato novo)
    s.online = false;
    await motor.registrar([resposta("aA", "i2"), resposta("aB", "i1")]);
    await motor.aguardar();
    expect((await banco.fila()).map((o) => [o.atividadeId, o.estado])).toEqual([["aA", "enviada"], ["aA", "pendente"], ["aB", "pendente"]]);
    expect(await motor.descartarDaAtividade("aA")).toBe(1); // só a que não subiu
    expect((await banco.fila()).map((o) => [o.atividadeId, o.estado])).toEqual([["aA", "enviada"], ["aB", "pendente"]]);
  });
});
