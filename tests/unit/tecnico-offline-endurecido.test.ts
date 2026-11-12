// @vitest-environment happy-dom
/**
 * App do técnico — OFFLINE-FIRST endurecido (Etapa 2d). O que já existia (fila no IndexedDB,
 * idempotência, ordem por atividade, recusa com motivo) segue provado em app-tecnico-offline; aqui
 * ficam as garantias pedidas e os três endurecimentos:
 *  - indicador: cada estado tem rótulo e explicação próprios (offline · sincronizando · sincronizado…);
 *  - a fila sobe SOZINHA quando o sinal volta (evento do navegador, sem ninguém tocar em nada);
 *  - nada se perde ao fechar e reabrir sem sinal — inclusive as FOTOS, que sobem depois;
 *  - conflito não apaga dado do técnico: retrato novo não passa por cima do que está na fila, e a
 *    recusa fica guardada com o motivo;
 *  - [novo] requisição pendurada tem PRAZO: o app não fica preso em "Sincronizando…", a fila fica no
 *    aparelho e, depois da falha, sobe UMA gravação por vez (cada confirmação já garantida);
 *  - [novo] o app pede ao navegador para PROTEGER o armazenamento;
 *  - [novo] se o aparelho não consegue guardar (sem espaço), o técnico é avisado na hora.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync, PRAZO_ENVIO_MS, PRAZO_LEITURA_MS, emLotes, type EstadoSync, type Situacao } from "@/lib/tecnico/offline/motor";
import { estadoDaAtividade } from "@/lib/tecnico/offline/estado";
import { protegerArmazenamento, MSG_SEM_ESPACO } from "@/lib/tecnico/offline/armazenamento";
import { rotuloSync } from "@/components/tecnico/indicador-sync";
import type { NovaOperacao, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

const FOTO = `data:image/jpeg;base64,${"A".repeat(4000)}`;
const item = (id: string, texto: string, extra: Record<string, unknown> = {}) =>
  ({ id, texto, pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 1, tipoResposta: "OK_ATENCAO_NA" as const, unidade: null, ...extra });
const ITENS = [item("i1", "Limpeza dos filtros", { pedirFoto: true }), item("i2", "Dreno e bandeja")];
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };

/** O retrato que o "servidor" manda: `respostas` é o que o servidor tem gravado para o equipamento */
function retrato(atividadeId = "aA", respostas: Record<string, any> = {}): RetratoAtividade {
  return {
    cartao: { atividadeId, osId: "osA", osNumero: "OS-0001" } as any,
    execucao: {
      atividade: { id: atividadeId, titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null },
      os: { id: "osA", numero: "OS-0001", status: "EM_EXECUCAO", clienteId: "c1", unidadeId: "un1" },
      bloqueada: false,
      equipamentos: [{
        vinculoId: "v1", feito: false, observacao: null,
        equipamento: { id: "eqA", titulo: "Split", descricao: "Split", fabricante: "", tag: null, numeroSerie: null, local: null, unidade: null, ativo: true, tipo: { id: "te1", nome: "Split" } },
        itens: ITENS, respostas, fotos: [], formulario: null, faltas: vazio, completo: false,
      }],
      adicionais: [], fotosServico: [],
      conclusao: { ok: false, semEquipamento: true, dispensa: null, pendencias: [], atendidos: 0, naoAtendidos: 1, mensagem: null },
    },
    equipamentosUnidade: [], checklistsPorTipo: { te1: ITENS }, geradoEm: new Date().toISOString(),
  } as unknown as RetratoAtividade;
}

function servidor() {
  const s = {
    online: true,
    /** Operações que o servidor aplicou (por id) */
    aplicadas: new Map<string, any>(),
    lotes: [] as string[][],
    recusar: new Map<string, { status: number; erro: string }>(),
    /** Próximas N chamadas de sync ficam penduradas (nunca respondem) */
    pendurar: 0,
    penduradas: 0,
    /** O que o servidor tem gravado (o escritório pode ter mexido) */
    respostasNoServidor: {} as Record<string, any>,
    fetch: (async (url: string, init?: RequestInit) => {
      if (!s.online) throw new TypeError("Failed to fetch");
      if (url.startsWith("/api/tecnico/atividades/")) return new Response(JSON.stringify(retrato(decodeURIComponent(url.split("/").pop()!), s.respostasNoServidor)), { status: 200, headers: { "content-type": "application/json" } });
      if (url === "/api/tecnico/sync") {
        if (s.pendurar > 0) { s.pendurar -= 1; s.penduradas += 1; return new Promise<Response>(() => {}); }
        const { operacoes } = JSON.parse(String(init!.body));
        s.lotes.push(operacoes.map((o: any) => o.tipo));
        const travadas = new Set<string>();
        const resultados = operacoes.map((o: any) => {
          if (s.aplicadas.has(o.id)) return { id: o.id, ok: true, status: 200, repetida: true };
          if (travadas.has(o.atividadeId)) return { id: o.id, ok: false, status: 0, adiada: true };
          const rec = s.recusar.get(o.tipo);
          if (rec) { travadas.add(o.atividadeId); return { id: o.id, ok: false, ...rec }; }
          s.aplicadas.set(o.id, o);
          if (o.tipo === "resposta") s.respostasNoServidor[o.itemId] = { status: o.dados.status ?? null, observacao: o.dados.observacao ?? null, valor: null, unidade: null, audio: false };
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
const novoMotor = (b: BancoTecnico, extra: Record<string, unknown> = {}) => new MotorSync(b, { fetch: s.fetch, online: () => s.online, agora: () => (relogio += 10), ...extra });
const resposta = (itemId: string, dados: any): NovaOperacao => ({ tipo: "resposta", atividadeId: "aA", equipamentoId: "eqA", itemId, dados });
const foto = (clientId: string, extra: Record<string, unknown> = {}): NovaOperacao => ({ tipo: "foto", atividadeId: "aA", equipamentoId: "eqA", dados: { dataUrl: FOTO, clientId, ...extra } } as NovaOperacao);
const esperar = (ms = 15) => new Promise((r) => setTimeout(r, ms));
async function esperarAte(cond: () => boolean | Promise<boolean>, msg: string) {
  for (let i = 0; i < 200; i++) { if (await cond()) return; await esperar(5); }
  throw new Error(`não aconteceu: ${msg}`);
}

beforeEach(async () => {
  (globalThis as any).indexedDB = new IDBFactory();
  banco = await BancoTecnico.abrir("uT");
  s = servidor();
  relogio = 1_000;
  motor = novoMotor(banco);
});
afterEach(() => { motor.parar(); vi.restoreAllMocks(); });

describe("indicador de estado: o técnico sempre sabe onde está o que ele gravou", () => {
  const e = (situacao: Situacao, pendentes = 0, erros = 0): EstadoSync => ({ situacao, pendentes, erros, ultimoSync: null, versao: 0 });

  it("cada estado tem rótulo e explicação próprios — offline · sincronizando · sincronizado, e os que pedem ação", () => {
    expect(rotuloSync(e("offline"))).toMatchObject({ texto: "Offline", detalhe: "O que for gravado fica no aparelho" });
    expect(rotuloSync(e("offline", 3))).toMatchObject({ texto: "Offline · 3", detalhe: "3 gravações no aparelho — sobe quando o sinal voltar" });
    expect(rotuloSync(e("sincronizando", 2))).toMatchObject({ texto: "Sincronizando…", detalhe: "Enviando 2 gravações" });
    expect(rotuloSync(e("pendente", 1))).toMatchObject({ texto: "1 a enviar", detalhe: "Envia sozinho em instantes" });
    expect(rotuloSync(e("sincronizado"))).toMatchObject({ texto: "Sincronizado", detalhe: "Tudo enviado ao escritório" });
    expect(rotuloSync(e("erro", 2, 1))).toMatchObject({ texto: "1 recusada", detalhe: "Toque para ver o motivo" });
    expect(rotuloSync(e("sessao", 4))).toMatchObject({ texto: "Entre de novo", detalhe: "Sua sessão expirou — nada foi perdido" });
    // nenhum estado divide o visual com outro (a cor também informa)
    const classes = (["offline", "sincronizando", "pendente", "sincronizado", "erro"] as Situacao[]).map((x) => rotuloSync(e(x, 1, 1)).classe);
    expect(new Set(classes).size).toBe(5);
  });

  it("o indicador acompanha a vida real: offline com a contagem → sincronizando → sincronizado", async () => {
    const vistos: string[] = [];
    motor.assinar((x) => { const r = rotuloSync(x).texto; if (vistos.at(-1) !== r) vistos.push(r); });
    s.online = false;
    await motor.registrar([resposta("i1", { status: "OK" }), resposta("i2", { status: "OK" })]);
    await motor.aguardar();
    expect(vistos).toEqual(["Sincronizado", "Offline · 2"]); // sem sinal fica em Offline: não pisca "Sincronizando…" a cada toque
    await motor.registrar([resposta("i1", { status: "NAO_SE_APLICA" })]);
    await motor.aguardar();
    expect(vistos).toEqual(["Sincronizado", "Offline · 2", "Offline · 3"]);
    s.online = true;
    await motor.sincronizar(true);
    expect(vistos).toEqual(["Sincronizado", "Offline · 2", "Offline · 3", "Sincronizando…", "Sincronizado"]);
  });
});

describe("a fila sobe SOZINHA quando o sinal volta", () => {
  it("o navegador avisa que a rede voltou (evento online) e o app envia tudo, em ordem — sem toque nenhum", async () => {
    s.online = false;
    motor.ligar();
    await motor.registrar([{ tipo: "iniciar", atividadeId: "aA" }, resposta("i1", { status: "OK" }), foto("foto0000001")]);
    await motor.aguardar();
    expect(s.lotes).toEqual([]);
    expect(motor.atual).toMatchObject({ situacao: "offline", pendentes: 3 });
    s.online = true;
    window.dispatchEvent(new Event("online")); // só isto: ninguém chama sincronizar()
    await esperarAte(() => motor.atual.situacao === "sincronizado", "sincronizou sozinho");
    expect(s.lotes).toEqual([["iniciar", "resposta", "foto"]]);
    expect(await banco.fila()).toEqual([]);
  });

  it("voltar para o app (aba visível de novo) também dispara o envio", async () => {
    s.online = false;
    motor.ligar();
    await motor.registrar([resposta("i1", { status: "OK" })]);
    await motor.aguardar();
    s.online = true; // o sinal voltou com o app em segundo plano (sem o evento)
    document.dispatchEvent(new Event("visibilitychange"));
    await esperarAte(() => motor.atual.situacao === "sincronizado", "sincronizou ao voltar para o app");
    expect(s.aplicadas.size).toBe(1);
  });
});

describe("nada se perde ao fechar e reabrir sem sinal — inclusive as fotos", () => {
  it("respostas e FOTOS ficam no aparelho; o app fecha, reabre ainda sem sinal e a tela mostra tudo; o sinal volta e sobe (a foto inteira)", async () => {
    await motor.baixarRetrato("aA");
    s.online = false;
    await motor.registrar([{ tipo: "iniciar", atividadeId: "aA" }, resposta("i1", { status: "OK" }), foto("foto0000001", { itemId: "i1" }), foto("foto0000002", { momento: "ANTES" })]);
    await motor.aguardar();
    motor.parar(); banco.fechar(); // fecha o app

    // reabre (outro objeto, o MESMO armazenamento do aparelho), ainda sem sinal
    banco = await BancoTecnico.abrir("uT");
    motor = novoMotor(banco);
    const guardada = await banco.fila();
    expect(guardada.map((o) => [o.tipo, o.estado])).toEqual([["iniciar", "pendente"], ["resposta", "pendente"], ["foto", "pendente"], ["foto", "pendente"]]);
    expect(guardada.filter((o) => o.tipo === "foto").map((o: any) => o.dados.dataUrl)).toEqual([FOTO, FOTO]); // a imagem inteira, não um atalho
    const tela = estadoDaAtividade((await banco.retrato("aA"))!.retrato, guardada);
    expect(tela.equipamentos[0].respostas.i1.status).toBe("OK");
    expect(tela.equipamentos[0].fotos.map((f) => [f.itemId, f.momento, f.pendente])).toEqual([["i1", null, true], [null, "ANTES", true]]);
    expect(s.lotes).toEqual([]);

    s.online = true;
    await motor.sincronizar(true);
    expect([...s.aplicadas.values()].filter((o) => o.tipo === "foto").map((o) => o.dados.dataUrl.length)).toEqual([FOTO.length, FOTO.length]);
    expect(await banco.fila()).toEqual([]);
  });

  it("outro técnico no mesmo aparelho não vê nem envia a fila do primeiro", async () => {
    s.online = false;
    await motor.registrar([resposta("i1", { status: "OK" })]);
    const doOutro = await BancoTecnico.abrir("uOutro");
    expect(await doOutro.fila()).toEqual([]);
    doOutro.fechar();
    expect((await banco.fila()).length).toBe(1);
  });
});

describe("conflito de sincronização não apaga dado do técnico", () => {
  it("o escritório mexeu no mesmo item enquanto ele estava sem sinal: o retrato novo NÃO passa por cima do que está na fila; ao subir, vale a gravação dele", async () => {
    await motor.baixarRetrato("aA");
    s.online = false;
    await motor.registrar([resposta("i2", { status: "ATENCAO", observacao: "Bandeja com lodo" })]);
    await motor.aguardar();
    // enquanto isso o escritório grava OK no mesmo item
    s.respostasNoServidor.i2 = { status: "OK", observacao: null, valor: null, unidade: null, audio: false };
    // o sinal volta só para LER (retrato novo chega antes do envio)
    s.online = true;
    const novo = await new MotorSync(banco, { fetch: s.fetch, online: () => true, agora: () => (relogio += 10) }).baixarRetrato("aA");
    expect(novo!.execucao.equipamentos[0].respostas.i2.status).toBe("OK"); // o servidor diz OK…
    const tela = estadoDaAtividade((await banco.retrato("aA"))!.retrato, await banco.fila());
    expect(tela.equipamentos[0].respostas.i2).toMatchObject({ status: "ATENCAO", observacao: "Bandeja com lodo" }); // …a tela mantém o que ele gravou
    expect((await banco.fila()).map((o) => o.estado)).toEqual(["pendente"]); // e a gravação continua na fila
    await motor.sincronizar(true);
    expect(s.respostasNoServidor.i2).toMatchObject({ status: "ATENCAO", observacao: "Bandeja com lodo" });
  });

  it("gravação RECUSADA não some: fica no aparelho com o motivo, e só sai por decisão dele (descartar) — nunca sozinha", async () => {
    s.recusar.set("resposta", { status: 409, erro: "Atividade concluída: reabra a atividade para alterar a execução." });
    await motor.registrar([resposta("i1", { status: "OK" })]);
    await motor.aguardar();
    for (let i = 0; i < 3; i++) await motor.sincronizar(true); // várias rodadas: continua lá
    const [recusada] = await banco.fila();
    expect(recusada).toMatchObject({ estado: "erro", erro: "Atividade concluída: reabra a atividade para alterar a execução.", dados: { status: "OK" } });
    expect(rotuloSync(motor.atual).texto).toBe("1 recusada");
    expect(await motor.descartar(999)).toBe(false); // descartar outra coisa não tira nada
    expect((await banco.fila()).length).toBe(1);
    expect(await motor.descartar(recusada.seq!)).toBe(true);
    expect(await banco.fila()).toEqual([]);
  });
});

describe("[novo] requisição pendurada tem prazo — o app não fica preso em “Sincronizando…”", () => {
  it("os prazos de fábrica: 90 s para enviar um lote, 30 s para ler", () => {
    expect([PRAZO_ENVIO_MS, PRAZO_LEITURA_MS]).toEqual([90_000, 30_000]);
  });

  it("rede que pendura: passa do prazo, vira falha de rede (a fila fica no aparelho, intacta) e o envio seguinte dá certo", async () => {
    motor = novoMotor(banco, { prazoEnvioMs: 40 });
    s.pendurar = 1;
    await motor.registrar([resposta("i1", { status: "OK" }), resposta("i2", { status: "OK" })]);
    await motor.aguardar(); // termina sozinho, pelo prazo (antes ficava pendurado para sempre)
    expect(s.penduradas).toBe(1);
    expect(motor.atual).toMatchObject({ situacao: "offline", pendentes: 2 });
    expect((await banco.fila()).map((o) => [o.estado, o.tentativas])).toEqual([["pendente", 0], ["pendente", 0]]);
    await motor.sincronizar(true); // "Sincronizar agora" (ou a próxima volta do sinal)
    expect(motor.atual.situacao).toBe("sincronizado");
    expect(s.aplicadas.size).toBe(2);
  });

  it("depois de uma falha de rede sobe UMA gravação por vez (cada confirmação já fica garantida); voltou ao normal, volta aos lotes", async () => {
    motor = novoMotor(banco, { prazoEnvioMs: 40 });
    s.pendurar = 1;
    await motor.registrar([resposta("i1", { status: "OK" }), resposta("i2", { status: "OK" }), foto("foto0000003")]);
    await motor.aguardar();
    s.lotes.length = 0;
    await motor.sincronizar(true);
    expect(s.lotes).toEqual([["resposta"], ["resposta"], ["foto"]]); // uma por vez
    await motor.registrar([resposta("i1", { status: "NAO_SE_APLICA" }), resposta("i2", { status: "NAO_SE_APLICA" })]);
    await motor.aguardar();
    expect(s.lotes.at(-1)).toEqual(["resposta", "resposta"]); // rede boa de novo: lote
  });

  it("leitura pendurada (abrir a OS em rede ruim) também desiste no prazo e a tela segue com o que está no aparelho", async () => {
    await motor.baixarRetrato("aA");
    const lento = new MotorSync(banco, { fetch: (() => new Promise<Response>(() => {})) as unknown as typeof fetch, online: () => true, prazoLeituraMs: 30 });
    expect(await lento.baixarRetrato("aA")).toBeNull();
    expect(lento.atual.situacao).toBe("offline");
    expect((await banco.retrato("aA"))!.retrato.execucao.atividade.id).toBe("aA"); // o guardado continua lá
    expect((await lento.baixarLista("meuDia", "/api/tecnico/meu-dia")).doAparelho).toBe(true);
  });

  it("emLotes aceita o tamanho máximo do lote (1 = uma por vez) sem mudar a ordem", () => {
    expect(emLotes(["a", "b", "c"], () => 1, 1)).toEqual([["a"], ["b"], ["c"]]);
    expect(emLotes(["a", "b", "c"], () => 1)).toEqual([["a", "b", "c"]]);
  });
});

describe("[novo] armazenamento protegido e aviso quando o aparelho não guarda", () => {
  it("pede ao navegador para não limpar o que está guardado; diz se foi aceito, negado ou se o navegador não tem o recurso", async () => {
    const persist = vi.fn(async () => true);
    expect(await protegerArmazenamento({ storage: { persist, persisted: async () => false } as any })).toBe("protegido");
    expect(persist).toHaveBeenCalledTimes(1);
    const jaProtegido = vi.fn(async () => true);
    expect(await protegerArmazenamento({ storage: { persist: jaProtegido, persisted: async () => true } as any })).toBe("protegido");
    expect(jaProtegido).not.toHaveBeenCalled(); // já estava: não pede de novo
    expect(await protegerArmazenamento({ storage: { persist: async () => false, persisted: async () => false } as any })).toBe("comum");
    expect(await protegerArmazenamento({ storage: {} as any })).toBe("desconhecido");
    expect(await protegerArmazenamento(undefined)).toBe("desconhecido");
    expect(await protegerArmazenamento({ storage: { persist: async () => { throw new Error("bloqueado"); } } as any })).toBe("desconhecido"); // nunca lança
  });

  describe("na tela", () => {
    let root: Root; let caixa: HTMLDivElement;
    afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); });
    const montar = async (filho: any, m: MotorSync) => {
      const { ProvedorTecnico } = await import("@/components/tecnico/contexto");
      caixa = document.createElement("div"); document.body.appendChild(caixa);
      root = createRoot(caixa);
      await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: { id: "uT", nome: "João", email: "j@x.com", empresaNome: "Clima", podeGravar: true }, motorPronto: m, children: filho })); });
      for (let i = 0; i < 6; i++) await act(async () => { await esperar(5); });
    };

    it("o aparelho não conseguiu guardar (sem espaço): o técnico é avisado na hora e a tela NÃO finge que gravou", async () => {
      const avisos = await import("@/components/ui/avisos");
      const toast = vi.spyOn(avisos, "toast").mockImplementation(() => {});
      await motor.baixarRetrato("aA");
      vi.spyOn(banco, "enfileirar").mockRejectedValue(Object.assign(new Error("cheio"), { name: "QuotaExceededError" }));
      const { useAtividade } = await import("@/components/tecnico/contexto");
      let api: ReturnType<typeof useAtividade> | null = null;
      function Sonda() { api = useAtividade("aA"); return createElement("span", { "data-status": api.tela?.equipamentos[0].respostas.i1?.status ?? "vazio" }); }
      await montar(createElement(Sonda), motor);
      let falhou = false;
      await act(async () => { await api!.registrar([resposta("i1", { status: "OK" })]).catch(() => { falhou = true; }); });
      expect(falhou).toBe(true); // quem chamou sabe que não gravou (não fecha modal, não avança)
      expect(toast).toHaveBeenCalledWith(MSG_SEM_ESPACO, "erro");
      expect(caixa.querySelector("[data-status]")!.getAttribute("data-status")).toBe("vazio");
      expect(await banco.fila()).toEqual([]);
      expect(s.lotes).toEqual([]);
    });

    it("Perfil: com gravações no aparelho e o armazenamento NÃO protegido, mostra a dica de instalar o app; protegido (ou sem fila), não polui", async () => {
      vi.doMock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
      vi.doMock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
      const { PerfilTecnico } = await import("@/components/tecnico/perfil");
      const perfil = createElement(PerfilTecnico, { perfilInicial: { nome: "João", email: "j@x.com", avatar: null, empresaNome: "Clima", perfilNome: null, cargo: "Técnico" } as any });
      s.online = false;
      await motor.registrar([resposta("i1", { status: "OK" })]);
      await motor.aguardar();
      const armazenamento = (aceita: boolean) => Object.defineProperty(navigator, "storage", { configurable: true, value: { persist: async () => aceita, persisted: async () => false } });
      const dica = () => caixa.querySelector("[data-armazenamento-comum]");
      // o navegador NEGOU proteger e há gravação no aparelho: a dica aparece
      armazenamento(false);
      await montar(perfil, motor);
      expect(caixa.querySelector("[data-painel-sync]")!.textContent).toContain("1 gravação(ões) a enviar.");
      expect(dica()!.textContent).toContain("Instale o app na tela inicial");
      act(() => root.unmount()); caixa.remove();
      // o navegador ACEITOU proteger: sem dica
      armazenamento(true);
      await montar(perfil, motor);
      expect(dica()).toBeNull();
      act(() => root.unmount()); caixa.remove();
      // negado, mas sem nada guardado: sem dica (não polui)
      armazenamento(false);
      s.online = true;
      await motor.sincronizar(true);
      await montar(perfil, motor);
      expect(caixa.querySelector("[data-painel-sync]")!.textContent).toContain("Nada esperando para enviar.");
      expect(dica()).toBeNull();
      delete (navigator as any).storage;
    });
  });
});
