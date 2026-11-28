// @vitest-environment happy-dom
/**
 * Checklist de veículo obrigatório — o porteiro no APP do técnico, com o app de verdade (AppTecnico: o banco do
 * aparelho via fake-indexeddb, o motor de sincronização real) e a fila do checklist:
 *  - dia de checklist: a ÚNICA tela é o checklist (sem a navegação); obrigatório faltando avisa; enviado, libera;
 *  - SEM SINAL: o checklist fica no aparelho e libera na hora; quando o sinal volta, sobe sozinho (uma vez só);
 *  - "Hoje não vou usar o veículo": libera; o atalho "Fazer checklist do veículo" no Meu dia reabre e troca;
 *  - recusa do servidor: libera do mesmo jeito e avisa no Perfil; já registrado hoje (servidor), fora dos dias, ou
 *    sem resumo (não obrigado / opção / Frota desligada): sem porteiro; a virada do dia renova;
 *  - a fila do aparelho (pura): feito vale sobre "não vou usar", o que fazer com cada resposta do servidor.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import type { ResumoPorteiro } from "@/lib/checklist-diario/regras";
import { FilaDiario, armazemNaMemoria, comEnvio, destinoDaResposta, GUARDADO_VAZIO, situacaoLocal } from "@/lib/checklist-diario/aparelho";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/os/scanner-qr", () => ({ ScannerQR: () => null }));
vi.mock("@/components/perfil/perfil-client", () => ({ PerfilClient: () => null }));

const MEIO_DIA = Date.parse("2027-01-04T15:00:00.000Z"); // segunda, 12:00 em Brasília
const HOJE = "2027-01-04";
const ONTEM = "2027-01-03";

const RESUMO = (extra: Partial<ResumoPorteiro> = {}): ResumoPorteiro => ({
  dias: [1, 2, 3, 4, 5], diaServidor: HOJE, veiculo: { id: "v1", placa: "ABC1D23", modelo: "Strada" }, registro: null,
  modelo: { id: "tpl", nome: "Diário", itens: [
    { id: "i-pneu", categoria: "Pneus", descricao: "Calibragem", tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: true, ordem: 0 },
    { id: "i-oleo", categoria: "Motor", descricao: "Nível do óleo", tipo: "NIVEL", opcoes: ["Normal", "Baixo"], obrigatorio: true, ordem: 1 },
  ] },
  ...extra,
});

let online = true;
let respostaChecklist: { status: number; corpo: unknown } = { status: 200, corpo: { ok: true, acao: "criar" } };
const enviados: any[] = [];
const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "content-type": "application/json" } });
  if (url === "/api/tecnico/checklist-diario") { enviados.push(JSON.parse(String(init!.body))); return json(respostaChecklist.corpo, respostaChecklist.status); }
  if (url === "/api/tecnico/meu-dia") return json({ tecnico: { id: "t1", nome: "Carlos" }, dia: HOJE, atividades: [], anteriores: [] });
  if (url.startsWith("/api/tecnico/agenda")) return json({ tecnico: { id: "t1", nome: "Carlos" }, dias: [] });
  return json({}, 404);
});

let root: Root | undefined; let caixa: HTMLDivElement;
beforeAll(async () => { await Promise.all([import("@/components/tecnico/app-tecnico"), import("@/components/ui/avisos")]); }, 120_000);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MEIO_DIA);
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; enviados.length = 0; fetchFalso.mockClear();
  respostaChecklist = { status: 200, corpo: { ok: true, acao: "criar" } };
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.history.replaceState(null, "", "/tecnico");
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined; caixa?.remove(); document.body.innerHTML = "";
  vi.unstubAllGlobals(); vi.useRealTimers();
});

const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function ate(cond: () => boolean, msg = "condição") {
  for (let i = 0; i < 200; i++) { if (cond()) return; await esperar(1); }
  throw new Error(`não aconteceu: ${msg}`);
}
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const clicar = async (el: HTMLElement | null) => { await act(async () => { el!.click(); }); await esperar(3); };
const digitar = async (el: HTMLElement | null, v: string) => {
  await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!; set.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
};
async function abrirApp(porteiro: ResumoPorteiro | null, usuarioId = "uT") {
  const { AppTecnico } = await import("@/components/tecnico/app-tecnico");
  const { Avisos } = await import("@/components/ui/avisos");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  const usuario = { id: usuarioId, nome: "Carlos", email: "c@x.com", empresaNome: "Clima", podeGravar: true };
  await act(async () => {
    root!.render(createElement("div", null, createElement(Avisos), createElement(AppTecnico, { usuario, config: CONFIG_APP_PADRAO, perfilInicial: {} as any, porteiro })));
  });
  await ate(() => !!$("[data-porteiro]") || !!$("[data-nav='dia']"), "o app abrir");
}
const toasts = () => [...document.querySelectorAll("[data-toast]")].map((t) => (t.textContent ?? "").trim());
async function responderTudo(oleo = "Normal") { await clicar($("[data-item-checklist='i-pneu'] [data-opcao='OK']")); await clicar($(`[data-item-checklist='i-oleo'] [data-opcao='${oleo}']`)); }

describe("o porteiro no app", () => {
  it("dia de checklist: a única tela é o checklist (sem navegação); obrigatório faltando avisa; enviado, libera e grava o FEITO", async () => {
    await abrirApp(RESUMO());
    expect($("[data-porteiro]")).toBeTruthy();
    expect($("[data-porteiro-veiculo]")!.textContent).toContain("ABC1D23");
    expect(document.querySelectorAll("[data-nav]")).toHaveLength(0);
    await clicar($("[data-porteiro-enviar]"));
    expect($("[data-erro-porteiro]")!.textContent).toContain("Preencha: Calibragem");
    expect(enviados).toHaveLength(0);
    await responderTudo("Baixo");
    await clicar($("[data-porteiro-enviar]"));
    await ate(() => !$("[data-porteiro]"), "liberar");
    expect(document.querySelectorAll("[data-nav]").length).toBeGreaterThan(0);
    await ate(() => enviados.length === 1, "subir");
    expect(enviados[0]).toMatchObject({ situacao: "FEITO", dia: HOJE, veiculoId: "v1", templateId: "tpl", itens: [{ itemTemplateId: "i-pneu", valor: "OK" }, { itemTemplateId: "i-oleo", valor: "Baixo" }] });
    expect(enviados[0].clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(toasts().join(" ")).toContain("gestor vai ver"); // item com problema: o gestor fica sabendo
  });

  it("SEM SINAL: libera na hora, guarda no aparelho e sobe quando o sinal volta (uma vez só); reabrir o app sem sinal não trava de novo", async () => {
    online = false;
    await abrirApp(RESUMO());
    await responderTudo();
    await clicar($("[data-porteiro-enviar]"));
    await ate(() => !$("[data-porteiro]"), "liberar sem sinal");
    expect(toasts().join(" ")).toContain("Sem sinal agora");
    expect(enviados).toHaveLength(0);
    // fecha e reabre o app ainda sem sinal: o registro do aparelho libera o dia
    act(() => root!.unmount()); root = undefined; caixa.remove();
    await abrirApp(RESUMO());
    expect($("[data-porteiro]")).toBeNull();
    // o sinal volta
    online = true;
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await ate(() => enviados.length === 1, "subir quando o sinal volta");
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await esperar(10);
    expect(enviados).toHaveLength(1);
  });

  it("'Hoje não vou usar o veículo': libera e registra; no Meu dia, 'Fazer checklist do veículo' reabre e troca", async () => {
    await abrirApp(RESUMO());
    await clicar($("[data-porteiro-nao-vou]"));
    await digitar($("[data-porteiro-motivo]"), "Serviço a pé");
    await clicar($("[data-porteiro-confirmar-nao-vou]"));
    await ate(() => !$("[data-porteiro]"), "liberar");
    await ate(() => enviados.length === 1, "subir");
    expect(enviados[0]).toMatchObject({ situacao: "NAO_VAI_USAR", motivo: "Serviço a pé", veiculoId: "v1" });
    await ate(() => !!$("[data-atalho-checklist]"), "atalho no Meu dia");
    await clicar($("[data-fazer-checklist]"));
    expect($("[data-porteiro]")!.textContent).toContain("substitui o “não vou usar”");
    await clicar($("[data-porteiro-voltar]"));
    expect($("[data-porteiro]")).toBeNull();
    await clicar($("[data-fazer-checklist]"));
    await responderTudo();
    await clicar($("[data-porteiro-enviar]"));
    await ate(() => enviados.length === 2, "subir o checklist");
    expect(enviados[1].situacao).toBe("FEITO");
    await ate(() => !$("[data-atalho-checklist]"), "atalho some depois do feito");
  });

  it("servidor recusa (ex.: veículo inválido): o técnico segue liberado e o aviso aparece no Perfil", async () => {
    respostaChecklist = { status: 400, corpo: { ok: false, erro: "Veículo não encontrado." } };
    await abrirApp(RESUMO());
    await responderTudo();
    await clicar($("[data-porteiro-enviar]"));
    await ate(() => enviados.length === 1, "tentar subir");
    expect($("[data-porteiro]")).toBeNull();
    await clicar($("[data-nav='perfil']"));
    await ate(() => !!$("[data-erro-envio-checklist]"), "aviso no Perfil");
    expect($("[data-erro-envio-checklist]")!.textContent).toContain("Veículo não encontrado.");
  });

  it("sem porteiro: já feito hoje (servidor), fora dos dias, ou sem resumo (não obrigado / opção / Frota desligada)", async () => {
    await abrirApp(RESUMO({ registro: { dia: HOJE, situacao: "FEITO" } }));
    expect($("[data-porteiro]")).toBeNull();
    act(() => root!.unmount()); root = undefined; caixa.remove();
    await abrirApp(RESUMO({ dias: [6] }), "uT2");
    expect($("[data-porteiro]")).toBeNull();
    act(() => root!.unmount()); root = undefined; caixa.remove();
    await abrirApp(null, "uT3");
    expect($("[data-porteiro]")).toBeNull();
    expect($("[data-atalho-checklist]")).toBeNull();
  });

  it("o registro de ontem não vale hoje: a virada do dia renova o porteiro", async () => {
    await abrirApp(RESUMO({ diaServidor: ONTEM, registro: { dia: ONTEM, situacao: "FEITO" }, dias: [0, 1, 2, 3, 4, 5, 6] }));
    expect($("[data-porteiro]")).toBeTruthy();
  });
});

describe("a fila do aparelho (pura)", () => {
  const envio = (situacao: "FEITO" | "NAO_VAI_USAR", dia = HOJE, clientId = `c-${Math.random()}`) =>
    (situacao === "FEITO" ? { clientId, dia, feitoEm: "x", veiculoId: "v1", situacao, templateId: "tpl", itens: [] } : { clientId, dia, feitoEm: "x", veiculoId: "v1", situacao }) as any;

  it("o 'feito' vale sobre o 'não vou usar' do mesmo dia; outro 'não vou usar' não rebaixa; guarda 14 dias", () => {
    let g = comEnvio(GUARDADO_VAZIO, envio("NAO_VAI_USAR"));
    expect(situacaoLocal(g, HOJE)).toBe("NAO_VAI_USAR");
    g = comEnvio(g, envio("FEITO"));
    expect(situacaoLocal(g, HOJE)).toBe("FEITO");
    g = comEnvio(g, envio("NAO_VAI_USAR"));
    expect(situacaoLocal(g, HOJE)).toBe("FEITO");
    expect(g.pendentes).toHaveLength(3);
    expect(situacaoLocal(g, ONTEM)).toBeNull();
    let h = GUARDADO_VAZIO;
    for (let d = 1; d <= 20; d++) h = comEnvio(h, envio("FEITO", `2027-01-${String(d).padStart(2, "0")}`));
    expect(h.registros).toHaveLength(14);
    expect(h.registros[0].dia).toBe("2027-01-20");
    // o mesmo envio de novo não entra duas vezes na fila
    const e = envio("FEITO", HOJE, "fixo");
    expect(comEnvio(comEnvio(GUARDADO_VAZIO, e), e).pendentes).toHaveLength(1);
  });

  it("resposta do servidor: 2xx enviado; sem rede, 401, 408, 429 e 5xx tentam depois; 400/403/404/409 descartam", () => {
    expect([200, 201, null, 401, 408, 429, 500, 503, 400, 403, 404, 409].map(destinoDaResposta)).toEqual([
      "enviado", "enviado", "tentarDepois", "tentarDepois", "tentarDepois", "tentarDepois", "tentarDepois", "tentarDepois", "descartar", "descartar", "descartar", "descartar",
    ]);
  });

  it("envia na ordem; para no primeiro 'tente depois'; descarte guarda o erro", async () => {
    const respostas = [500, 200, 400];
    const corpos: string[] = [];
    const f = vi.fn(async (_u: string, init: RequestInit) => { corpos.push(JSON.parse(String(init.body)).clientId); const s = respostas.shift() ?? 200; return new Response(JSON.stringify(s === 400 ? { erro: "Dia do checklist inválido." } : {}), { status: s }); });
    const fila = new FilaDiario(armazemNaMemoria(), { fetch: f as unknown as typeof fetch });
    await fila.registrar(envio("FEITO", "2027-01-01", "a"));
    await fila.enviar(); // 500: fica
    expect((await fila.ler()).pendentes.map((p) => p.clientId)).toEqual(["a"]);
    await fila.registrar(envio("FEITO", "2027-01-02", "b"));
    await fila.enviar(); // a: 200, b: 400 (descarta com erro)
    const g = await fila.ler();
    expect(g.pendentes).toEqual([]);
    expect(g.erro).toBe("Dia do checklist inválido.");
    expect(g.registros.map((r) => r.dia)).toEqual(["2027-01-02", "2027-01-01"]); // o registro local fica (libera o dia)
    expect(corpos.slice(-2)).toEqual(["a", "b"]);
  });
});

/* ───────── D13 (App pronto pra janeiro 2): corrigir o checklist do veículo de hoje ───────── */

describe("D13: corrigir o checklist do veículo até o fim do dia", () => {
  it("feito no aparelho: no Perfil, 'Corrigir o checklist de hoje' reabre com as respostas; salvar manda a correção (sem sinal também)", async () => {
    await abrirApp(RESUMO());
    await responderTudo();
    await clicar($("[data-porteiro-enviar]"));
    await ate(() => !$("[data-porteiro]") && enviados.length === 1, "feito e enviado");
    expect($("[data-corrigir-checklist]")).toBeNull(); // no Meu dia, não (fica no Perfil)
    await clicar($("[data-nav='perfil']"));
    await ate(() => !!$("[data-corrigir-checklist]"), "atalho no Perfil");
    expect($("[data-corrigir-checklist]")!.textContent).toContain("Até o fim do dia. O gestor vê o que mudou.");
    await clicar($("[data-corrigir-checklist]"));
    await ate(() => !!$("[data-porteiro]"), "reabre");
    expect($("[data-porteiro-texto]")!.textContent).toContain("Corrigindo o checklist de hoje");
    expect($("[data-porteiro-enviar]")!.textContent).toBe("Salvar correção");
    expect($("[data-item-checklist='i-pneu'] [data-opcao='OK']")!.getAttribute("aria-pressed") ?? $("[data-item-checklist='i-pneu'] [data-opcao='OK']")!.getAttribute("aria-checked")).toBe("true");
    online = false;
    await clicar($("[data-item-checklist='i-pneu'] [data-opcao='NOK']"));
    await clicar($("[data-porteiro-enviar]"));
    await ate(() => !$("[data-porteiro]"), "fecha");
    expect(toasts().join(" ")).toContain("Checklist corrigido, com alertas. O gestor vê o que mudou.");
    online = true;
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await ate(() => enviados.length === 2, "a correção sobe");
    expect(enviados[1]).toMatchObject({ situacao: "FEITO", dia: HOJE, correcao: true, itens: [{ itemTemplateId: "i-pneu", valor: "NOK" }, { itemTemplateId: "i-oleo", valor: "Normal" }] });
    expect(enviados[1].clientId).not.toBe(enviados[0].clientId);
  });

  it("feito em outro aparelho: o resumo da página traz as respostas de hoje; a foto já enviada vale para o item de foto obrigatório", async () => {
    const itens = [...RESUMO().modelo.itens, { id: "i-foto", categoria: "Geral", descricao: "Foto do painel", tipo: "FOTO", opcoes: [], obrigatorio: true, ordem: 2 }];
    await abrirApp(RESUMO({
      registro: { dia: HOJE, situacao: "FEITO" }, modelo: { id: "tpl", nome: "Diário", itens: itens as any },
      feitoHoje: { itens: [{ itemTemplateId: "i-pneu", valor: "OK", temFoto: false }, { itemTemplateId: "i-oleo", valor: "Baixo", temFoto: false }, { itemTemplateId: "i-foto", valor: null, temFoto: true }], observacaoGeral: "Arranhão na porta" },
    }));
    expect($("[data-porteiro]")).toBeNull();
    await clicar($("[data-nav='perfil']"));
    await ate(() => !!$("[data-corrigir-checklist]"), "atalho");
    await clicar($("[data-corrigir-checklist]"));
    await ate(() => !!$("[data-porteiro]"), "reabre");
    expect(($("[data-porteiro-observacao]") as HTMLTextAreaElement).value).toBe("Arranhão na porta");
    await clicar($("[data-item-checklist='i-oleo'] [data-opcao='Normal']"));
    await clicar($("[data-porteiro-enviar]"));
    expect($("[data-erro-porteiro]")).toBeNull(); // a foto obrigatória: a já enviada vale
    await ate(() => enviados.length === 1, "sobe");
    expect(enviados[0]).toMatchObject({ correcao: true, observacaoGeral: "Arranhão na porta" });
    expect(enviados[0].itens).toEqual([{ itemTemplateId: "i-pneu", valor: "OK", foto: null }, { itemTemplateId: "i-oleo", valor: "Normal", foto: null }, { itemTemplateId: "i-foto", valor: null, foto: null }]);
  });

  it("'Voltar sem corrigir' fecha sem mandar nada; sem checklist feito hoje (ou o de ontem), nada para corrigir", async () => {
    await abrirApp(RESUMO({ registro: { dia: HOJE, situacao: "FEITO" }, feitoHoje: { itens: [{ itemTemplateId: "i-pneu", valor: "OK", temFoto: false }], observacaoGeral: null } }));
    await clicar($("[data-nav='perfil']"));
    await ate(() => !!$("[data-corrigir-checklist]"), "atalho");
    await clicar($("[data-corrigir-checklist]"));
    await ate(() => !!$("[data-porteiro]"), "reabre");
    await clicar($("[data-porteiro-voltar]"));
    await ate(() => !$("[data-porteiro]"), "fecha");
    expect(enviados).toHaveLength(0);
    act(() => root!.unmount()); root = undefined; caixa.remove();
    // o resumo é de ontem (a página ficou aberta): hoje não há o que corrigir
    await abrirApp(RESUMO({ diaServidor: ONTEM, registro: { dia: ONTEM, situacao: "FEITO" }, feitoHoje: { itens: [], observacaoGeral: null }, dias: [] }));
    await clicar($("[data-nav='perfil']"));
    await esperar(10);
    expect($("[data-corrigir-checklist]")).toBeNull();
  });
});

describe("D13: as respostas que ficam no aparelho (pura)", () => {
  it("o feito guarda as respostas sem a foto; a correção sem foto nova mantém 'tem foto'; 'não vou usar' não mexe", async () => {
    const { feitoDoEnvio, feitoParaCorrigir } = await import("@/lib/checklist-diario/aparelho");
    const base = { clientId: "c", dia: HOJE, feitoEm: "x", veiculoId: "v1", templateId: "tpl" };
    const f1 = feitoDoEnvio(null, { ...base, situacao: "FEITO", itens: [{ itemTemplateId: "a", valor: "OK" }, { itemTemplateId: "f", foto: "data:image/jpeg;base64,AA" }], observacaoGeral: "obs" });
    expect(f1).toEqual({ dia: HOJE, itens: [{ itemTemplateId: "a", valor: "OK", temFoto: false }, { itemTemplateId: "f", valor: null, temFoto: true }], observacaoGeral: "obs" });
    expect(JSON.stringify(f1)).not.toContain("base64");
    const f2 = feitoDoEnvio(f1, { ...base, situacao: "FEITO", correcao: true, itens: [{ itemTemplateId: "a", valor: "NOK" }, { itemTemplateId: "f" }] });
    expect(f2!.itens).toEqual([{ itemTemplateId: "a", valor: "NOK", temFoto: false }, { itemTemplateId: "f", valor: null, temFoto: true }]);
    // um checklist novo (não correção) de outro dia não herda a foto
    expect(feitoDoEnvio(f1, { ...base, dia: "2027-01-05", situacao: "FEITO", itens: [{ itemTemplateId: "f" }] })!.itens).toEqual([{ itemTemplateId: "f", valor: null, temFoto: false }]);
    expect(feitoDoEnvio(f1, { ...base, situacao: "NAO_VAI_USAR", motivo: null } as any)).toBe(f1);
    // para corrigir: o do aparelho (hoje) vale sobre o da página; de outro dia, nenhum
    const pag = { dia: HOJE, itens: [], observacaoGeral: "página" };
    expect(feitoParaCorrigir({ ...GUARDADO_VAZIO, feito: f1 }, pag, HOJE)).toBe(f1);
    expect(feitoParaCorrigir({ ...GUARDADO_VAZIO, feito: { ...f1!, dia: ONTEM } }, pag, HOJE)).toBe(pag);
    expect(feitoParaCorrigir(null, { ...pag, dia: ONTEM }, HOJE)).toBeNull();
    expect(comEnvio(GUARDADO_VAZIO, { ...base, situacao: "FEITO", itens: [] }).feito).toEqual({ dia: HOJE, itens: [], observacaoGeral: null });
  });
});
