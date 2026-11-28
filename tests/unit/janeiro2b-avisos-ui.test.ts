// @vitest-environment happy-dom
/**
 * App pronto pra janeiro 2 · PR B — os avisos novos do Meu dia nas telas (componentes de verdade) e no motor:
 *  - D8: o cartão "Instale o app e ative as notificações" (o passo do iPhone; Ativar; Agora não guarda no aparelho);
 *  - D9: as faixas "Saiu do seu dia" (juntam às guardadas; "Entendi" tira só aquela, também sem sinal);
 *  - D11: o aviso do outro aparelho (até "Entendi"; uma notícia mais nova volta a avisar);
 *  - o motor manda, no Meu dia e no envio, o id do aparelho e quantas gravações tem na fila (e os ids de hoje).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/avisos", () => ({ toast: avisos.toast, confirmar: vi.fn(async () => true) }));
const banco = vi.hoisted(() => {
  const dados = new Map<string, unknown>();
  // O motor do app é um só (estável entre renderizações), como no ProvedorTecnico
  const motor = { banco: { ler: async (k: string) => dados.get(k) ?? null, gravar: async (k: string, v: unknown) => { dados.set(k, structuredClone(v)); } } };
  return { dados, contexto: { motor } };
});
vi.mock("@/components/tecnico/contexto", () => ({ useTecnico: () => banco.contexto, irPara: vi.fn() }));
const push = vi.hoisted(() => ({ estado: { situacao: "inativo", chave: "k" } as any, instalado: false, ativar: vi.fn(async (_k: string) => null as string | null) }));
vi.mock("@/lib/push", () => ({
  estadoDoAparelho: async () => push.estado, appInstalado: () => push.instalado,
  ativarNesteAparelho: (k: string) => push.ativar(k),
}));

let root: Root | null = null; let caixa: HTMLDivElement | null = null;
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => [...document.querySelectorAll(s)] as HTMLElement[];
const esperar = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function montar(el: any) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(el); }); await act(async () => { await esperar(); });
}
const desmontar = async () => { await act(async () => root?.unmount()); caixa?.remove(); root = null; };
async function clicar(el: Element | null) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); await esperar(); }); }
const ua = (v: string) => Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => v });
beforeEach(() => { banco.dados.clear(); avisos.toast.mockClear(); push.estado = { situacao: "inativo", chave: "k" }; push.instalado = false; push.ativar.mockClear(); ua("Mozilla/5.0 (Linux; Android 14)"); });
afterEach(async () => { await desmontar(); document.body.innerHTML = ""; });

describe("D8: Instale o app e ative as notificações", () => {
  it("1º dia no Android: o passo de instalar; 'Agora não' some e fica guardado no aparelho", async () => {
    const { CartaoPrimeirosDias } = await import("@/components/tecnico/primeiros-dias");
    await montar(createElement(CartaoPrimeirosDias));
    expect($("[data-primeiros-dias]")!.getAttribute("data-primeiros-dias")).toBe("instalar");
    expect($("h2")!.textContent).toBe("Instale o app e ative as notificações");
    expect((banco.dados.get("primeirosDias") as any).desde).toBeGreaterThan(0); // o 1º Meu dia marca o começo
    expect($("[data-dispensar-primeiros-dias]")!.className).toContain("min-h-[44px]");
    await clicar($("[data-dispensar-primeiros-dias]"));
    expect($("[data-primeiros-dias]")).toBeNull();
    expect(banco.dados.get("primeirosDias")).toMatchObject({ dispensado: true });
    await desmontar();
    await montar(createElement(CartaoPrimeirosDias));
    expect($("[data-primeiros-dias]")).toBeNull();
  });

  it("iPhone fora da tela de início: o passo do Safari (Compartilhar › Adicionar à Tela de Início)", async () => {
    ua("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    push.estado = { situacao: "instalar-iphone" };
    const { CartaoPrimeirosDias } = await import("@/components/tecnico/primeiros-dias");
    await montar(createElement(CartaoPrimeirosDias));
    expect($("[data-primeiros-dias]")!.getAttribute("data-primeiros-dias")).toBe("instalar-iphone");
    expect($("[data-passo-primeiros-dias]")!.textContent).toContain("Compartilhar");
    expect($("[data-passo-primeiros-dias]")!.textContent).toContain("Adicionar à Tela de Início");
    expect($("[data-ativar-notificacoes]")).toBeNull();
  });

  it("instalado: 'Ativar notificações' ativa e o cartão some (feito)", async () => {
    push.instalado = true;
    const { CartaoPrimeirosDias } = await import("@/components/tecnico/primeiros-dias");
    await montar(createElement(CartaoPrimeirosDias));
    expect($("[data-primeiros-dias]")!.getAttribute("data-primeiros-dias")).toBe("ativar");
    push.estado = { situacao: "ativo", chave: "k", endpoint: "e" };
    await clicar($("[data-ativar-notificacoes]"));
    expect(push.ativar).toHaveBeenCalledWith("k");
    expect(avisos.toast).toHaveBeenCalledWith("Notificações ativadas neste aparelho.");
    expect($("[data-primeiros-dias]")).toBeNull();
  });

  it("já feito, servidor sem notificações ou depois dos primeiros dias: nada", async () => {
    const { CartaoPrimeirosDias } = await import("@/components/tecnico/primeiros-dias");
    push.instalado = true; push.estado = { situacao: "ativo", chave: "k", endpoint: "e" };
    await montar(createElement(CartaoPrimeirosDias));
    expect($("[data-primeiros-dias]")).toBeNull();
    await desmontar();
    push.instalado = false; push.estado = { situacao: "desligado" };
    await montar(createElement(CartaoPrimeirosDias));
    expect($("[data-primeiros-dias]")).toBeNull();
    await desmontar();
    push.estado = { situacao: "inativo", chave: "k" };
    banco.dados.set("primeirosDias", { desde: Date.now() - 8 * 86_400_000 });
    await montar(createElement(CartaoPrimeirosDias));
    expect($("[data-primeiros-dias]")).toBeNull();
  });
});

describe("D9: Saiu do seu dia", () => {
  const s = (atividadeId: string, osNumero: string, motivo: string, novaData: string | null = null) => ({ atividadeId, osNumero, motivo, novaData }) as any;
  it("a faixa com o motivo; junta às guardadas; 'Entendi' tira só aquela e fica guardado (sem sinal também)", async () => {
    const { FaixasSaiuDoDia } = await import("@/components/tecnico/saiu-do-dia");
    banco.dados.set("saiuDoDia", { dia: "2027-01-10", itens: [s("a9", "OS-2609", "outro-tecnico")] });
    await montar(createElement(FaixasSaiuDoDia, { hoje: "2027-01-10", novas: [s("a2", "OS-2602", "cancelada"), s("a3", "OS-2603", "reagendada", "2027-01-12")] }));
    expect($$("[data-saida]").map((e) => e.textContent)).toEqual([
      "Saiu do seu dia: OS-2609 (passou para outro técnico) Entendi",
      "Saiu do seu dia: OS-2602 (cancelada pelo escritório) Entendi",
      "Saiu do seu dia: OS-2603 (reagendada pelo escritório para 12/01) Entendi",
    ]);
    expect($$("[data-entendi-saida]").every((b) => b.className.includes("min-h-[44px]"))).toBe(true);
    await clicar($("[data-saida='a2'] [data-entendi-saida]"));
    expect($$("[data-saida]").map((e) => e.getAttribute("data-saida"))).toEqual(["a9", "a3"]);
    expect((banco.dados.get("saiuDoDia") as any).itens.map((x: any) => x.atividadeId)).toEqual(["a9", "a3"]);
    // reabriu o app sem sinal (sem novas): continuam as que não foram dispensadas
    await desmontar();
    await montar(createElement(FaixasSaiuDoDia, { hoje: "2027-01-10", novas: undefined }));
    expect($$("[data-saida]").map((e) => e.getAttribute("data-saida"))).toEqual(["a9", "a3"]);
    // o dia virou: somem
    await desmontar();
    await montar(createElement(FaixasSaiuDoDia, { hoje: "2027-01-11", novas: [] }));
    expect($("[data-saiu-do-dia]")).toBeNull();
  });
});

describe("D11: o outro aparelho tem gravação sem enviar", () => {
  it("o aviso até 'Entendi'; uma notícia mais nova volta a avisar; sem notícia, nada", async () => {
    const { AvisoOutroAparelho } = await import("@/components/tecnico/saiu-do-dia");
    const o1 = { pendentes: 3, em: "2027-01-10T13:42:00.000Z", umAparelho: true };
    await montar(createElement(AvisoOutroAparelho, { outro: o1 }));
    expect($("[data-outro-aparelho]")!.textContent).toContain("O outro aparelho tem 3 gravações que ainda não subiram");
    expect($("[data-outro-aparelho]")!.textContent).toContain("este aparelho sai");
    expect($("[data-outro-aparelho]")!.getAttribute("role")).toBe("alert");
    await clicar($("[data-entendi-outro-aparelho]"));
    expect($("[data-outro-aparelho]")).toBeNull();
    await desmontar();
    await montar(createElement(AvisoOutroAparelho, { outro: o1 }));
    expect($("[data-outro-aparelho]")).toBeNull();
    await desmontar();
    await montar(createElement(AvisoOutroAparelho, { outro: { ...o1, pendentes: 1, em: "2027-01-10T15:00:00.000Z" } }));
    expect($("[data-outro-aparelho]")!.textContent).toContain("1 gravação que ainda não subiu");
    await desmontar();
    await montar(createElement(AvisoOutroAparelho, { outro: null }));
    expect($("[data-outro-aparelho]")).toBeNull();
  });
});

describe("o motor conta a fila ao servidor (D11) e manda os ids de hoje (D9)", () => {
  it("Meu dia e envio levam o id do aparelho (o mesmo sempre) e quantas gravações faltam; as outras chamadas, não", async () => {
    (globalThis as any).indexedDB = new IDBFactory();
    const { BancoTecnico } = await import("@/lib/tecnico/offline/banco");
    const { MotorSync } = await import("@/lib/tecnico/offline/motor");
    const b = await BancoTecnico.abrir("uT");
    const pedidos: { url: string; headers: Record<string, string> }[] = [];
    const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
      pedidos.push({ url, headers: { ...(init?.headers as Record<string, string> | undefined) } });
      if (url === "/api/tecnico/sync") return new Response(JSON.stringify({ resultados: JSON.parse(String(init!.body)).operacoes.map((o: any) => ({ id: o.id, ok: true, status: 200 })) }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ tecnico: null, dia: null, atividades: [], anteriores: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    let online = false;
    const motor = new MotorSync(b, { fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
    await motor.registrar([{ tipo: "iniciar", atividadeId: "a1" } as any, { tipo: "iniciar", atividadeId: "a2" } as any]);
    online = true;
    await motor.baixarLista("meuDia", "/api/tecnico/meu-dia", { "x-frivo-antes": "a1,a2" });
    await motor.sincronizar(true);
    await motor.baixarLista("meuDia", "/api/tecnico/meu-dia");
    await motor.baixarLista("agenda", "/api/tecnico/agenda?dias=14");
    const [md1, s1, md2, ag] = [pedidos.find((p) => p.url === "/api/tecnico/meu-dia")!, pedidos.find((p) => p.url === "/api/tecnico/sync")!, pedidos.filter((p) => p.url === "/api/tecnico/meu-dia")[1], pedidos.find((p) => p.url.startsWith("/api/tecnico/agenda"))!];
    expect(md1.headers).toMatchObject({ "x-frivo-antes": "a1,a2", "x-frivo-fila": "2", "x-frivo-aparelho": expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(s1.headers).toMatchObject({ "x-frivo-fila": "2", "x-frivo-aparelho": md1.headers["x-frivo-aparelho"] });
    expect(md2.headers).toMatchObject({ "x-frivo-fila": "0", "x-frivo-aparelho": md1.headers["x-frivo-aparelho"] });
    expect(md2.headers["x-frivo-antes"]).toBeUndefined();
    expect(ag.headers["x-frivo-aparelho"]).toBeUndefined();
    expect(await b.ler("aparelhoId")).toBe(md1.headers["x-frivo-aparelho"]);
    b.fechar();
  });
});
