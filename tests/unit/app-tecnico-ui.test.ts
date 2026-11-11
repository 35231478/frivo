// @vitest-environment happy-dom
/**
 * App do TÉCNICO — as telas num DOM de verdade (happy-dom), com o banco do aparelho de verdade
 * (IndexedDB via fake-indexeddb) e o motor de sincronização real contra um "servidor" simulado:
 *  - Meu dia: cartões na ordem do horário (cliente, endereço, rota no mapa, horário, situação, nº de
 *    equipamentos); sem sinal mostra o que ficou guardado;
 *  - execução guiada: TUDO OK marca só os sem resposta; "Atenção" só salva com foto + observação;
 *    medição só aceita número (vírgula vale) e grava número + unidade; concluir equipamento leva ao
 *    próximo; serviço extra entra na MESMA OS; concluir mostra o que falta (trava da Etapa 1);
 *  - SEM SINAL: tudo isso fica na fila do aparelho (nada é enviado) e o indicador diz "Offline";
 *    o sinal volta → sobe tudo e o indicador fica "Sincronizado";
 *  - regras puras: quem é técnico puro, para onde o middleware leva, cartão (endereço/rota/hora).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PRESETS, montarPermissoes, permissoesTotais } from "@/lib/permissoes";
import { destinoModoTecnico, ehTecnicoPuro, emModoTecnico } from "@/lib/tecnico/modo";
import { aplicarPrivacidade, enderecoEmLinha, horaMarcada, linkDoApp, linkRota, linkWaze, ordenarDoDia } from "@/lib/tecnico/cartao";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import type { RetratoAtividade } from "@/lib/tecnico/offline/tipos";

vi.mock("@/lib/imagem-cliente", () => ({
  FOTO_GALERIA: { ladoMax: 1280, qualidade: 0.8 },
  reduzirImagem: vi.fn(async () => ({ imagem: { dataUrl: "data:image/jpeg;base64,/9j/FOTO", largura: 10, altura: 10, bytes: 9 }, qualidade: {} })),
  // A marca d'água carimba no <canvas> (sem canvas no happy-dom): no teste é passthrough (a foto não
  // muda) e as linhas do carimbo são conferidas pelo spy.
  aplicarMarcaDagua: vi.fn(async (dataUrl: string) => dataUrl),
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));

/* ───────── dados ───────── */
const item = (id: string, texto: string, extra: Record<string, unknown> = {}) =>
  ({ id, texto, pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 1, tipoResposta: "OK_ATENCAO_NA" as const, unidade: null, ...extra });
const ITENS = [item("i1", "Limpeza dos filtros", { pedirFoto: true }), item("i2", "Dreno e bandeja"), item("m1", "Pressão de sucção", { tipoResposta: "MEDICAO", unidade: "psi" })];
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const info = (id: string, titulo: string) => ({ id, titulo, descricao: titulo, fabricante: "Daikin FTXS", tag: id === "eqA" ? "AC-01" : null, numeroSerie: null, local: "Sala 1", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" } });
const cartao = (atividadeId: string, hora: string | null, cliente: string, extra: Record<string, unknown> = {}) => ({
  atividadeId, osId: `os-${atividadeId}`, osNumero: `OS-${atividadeId}`, titulo: "Preventiva", tipoOs: { nome: "Preventiva", cor: "#0EA5E9" }, status: "AGENDADA", prioridade: "NORMAL",
  dataAgendada: "2026-10-20T11:30:00.000Z", dia: "2026-10-20", hora, duracaoMin: 60, cliente, telefone: "1133334444", unidade: "Matriz",
  endereco: "Av. Paulista, 1000 — São Paulo/SP", rota: "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=-23.5%2C-46.6", descricao: "Preventiva mensal",
  equipamentos: 2, atendidos: 0, adicionais: 0, ...extra,
});
function retrato(atividadeId = "aA"): RetratoAtividade {
  return {
    cartao: cartao(atividadeId, "08:30", "Hospital Santa Luzia"),
    execucao: {
      atividade: { id: atividadeId, titulo: "Preventiva", status: "AGENDADA", tipoOs: null },
      os: { id: `os-${atividadeId}`, numero: `OS-${atividadeId}`, status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: false,
      equipamentos: [
        { vinculoId: "v1", feito: false, observacao: null, equipamento: info("eqA", "Split Sala 1"), itens: ITENS, respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false },
        { vinculoId: "v2", feito: false, observacao: null, equipamento: info("eqB", "Split Sala 2"), itens: ITENS, respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false },
      ],
      adicionais: [],
      conclusao: { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 2, mensagem: null },
    },
    equipamentosUnidade: [{ ...info("eqN", "Split Sala 3"), tipoEquipamentoId: "te1", qr: null }],
    checklistsPorTipo: { te1: ITENS },
    geradoEm: new Date().toISOString(),
  } as unknown as RetratoAtividade;
}

/* ───────── servidor simulado + aparelho ───────── */
let online = true;
let enviadas: { tipo: string; dados?: any; valor?: unknown; equipamentoIds?: string[]; itemId?: string }[] = [];
const meuDia = { tecnico: { id: "t1", nome: "João Silva" }, dia: "2026-10-20", atividades: [cartao("aB", "08:30", "Padaria Pão Quente"), cartao("aA", "14:00", "Hospital Santa Luzia"), cartao("aG", null, "Escola Viva")], anteriores: [] };
/** Segura a resposta do Meu dia (para ver a tela carregando) */
let segurarMeuDia: Promise<void> | null = null;
const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  if (segurarMeuDia && url === "/api/tecnico/meu-dia") await segurarMeuDia;
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "content-type": "application/json" } });
  if (url === "/api/tecnico/meu-dia") return json(meuDia);
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato(decodeURIComponent(url.split("/").pop()!)));
  if (url === "/api/tecnico/sync") {
    const { operacoes } = JSON.parse(String(init!.body));
    enviadas.push(...operacoes);
    return json({ resultados: operacoes.map((o: any) => ({ id: o.id, ok: true, status: 200, dados: {} })) });
  }
  return json({}, 404);
});

let root: Root;
let caixa: HTMLDivElement;
let banco: BancoTecnico;
let motor: MotorSync;

beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/meu-dia"), import("@/components/tecnico/execucao"), import("@/components/tecnico/indicador-sync")]);
}, 120_000);

beforeEach(async () => {
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; enviadas = []; fetchFalso.mockClear(); segurarMeuDia = null;
  window.localStorage.clear();
  banco = await BancoTecnico.abrir("uT");
  motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online });
  window.history.replaceState(null, "", "/tecnico");
});
afterEach(() => {
  if (root) act(() => root.unmount());
  caixa?.remove();
  root = undefined as unknown as Root; caixa = undefined as unknown as HTMLDivElement;
  banco.fechar();
});

const USUARIO = { id: "uT", nome: "João Silva", email: "joao@clima.com", empresaNome: "Clima Total", podeGravar: true };
async function montar(filho: any, config?: any) {
  const { ProvedorTecnico } = await import("@/components/tecnico/contexto");
  const { IndicadorSync } = await import("@/components/tecnico/indicador-sync");
  const { useTecnico } = await import("@/components/tecnico/contexto");
  function Topo() { const { estado } = useTecnico(); return createElement(IndicadorSync, { estado }); }
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: USUARIO, config, motorPronto: motor, children: [createElement(Topo, { key: "t" }), createElement("div", { key: "c" }, filho)] })); });
  await esperar();
}
const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean, msg = "condição") {
  for (let i = 0; i < 80; i++) { if (cond()) return; await esperar(1); }
  throw new Error(`não aconteceu: ${msg}`);
}
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function sair(el: Element | null) { await act(async () => { (el as HTMLElement).dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); await esperar(); }
async function foto(input: Element | null) {
  expect(input).not.toBeNull();
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" })] });
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}
const fila = () => banco.fila();
const situacao = () => $("[data-sync]")?.getAttribute("data-sync");

async function abrirOs(atividadeId = "aA", equipamentoId?: string, config?: any) {
  const { VistaOs } = await import("@/components/tecnico/execucao");
  await montar(createElement(VistaOs, { atividadeId, equipamentoId }), config);
  await esperarAte(() => !!$("[data-vista]") && $("[data-vista]")!.getAttribute("data-vista") !== null && !caixa.querySelector(".animate-spin:not([data-sync] *)"), "OS carregada");
}

/* ═════════════════════════ regras puras ═════════════════════════ */
describe("modo técnico (puro, roda no middleware)", () => {
  it("técnico puro = perfil que cabe no de Técnico e vê OS; admin, supervisor, financeiro e perfil com algo a mais NÃO", () => {
    expect(ehTecnicoPuro("TECNICO", PRESETS.TECNICO)).toBe(true);
    expect(ehTecnicoPuro("OPERADOR", PRESETS.TECNICO)).toBe(true); // vale o perfil, não o rótulo
    expect(ehTecnicoPuro("OPERADOR", PRESETS.AUXILIAR)).toBe(true);
    expect(ehTecnicoPuro("ADMIN", PRESETS.TECNICO)).toBe(false);
    expect(ehTecnicoPuro("SUPER_ADMIN", PRESETS.TECNICO)).toBe(false);
    expect(ehTecnicoPuro("OPERADOR", PRESETS.SUPERVISOR)).toBe(false);
    expect(ehTecnicoPuro("OPERADOR", PRESETS.FINANCEIRO)).toBe(false);
    expect(ehTecnicoPuro("OPERADOR", montarPermissoes({ ordens: ["visualizar"], clientes: ["visualizar"] }))).toBe(false); // uma permissão a mais
    expect(ehTecnicoPuro("OPERADOR", montarPermissoes({ equipamentos: ["visualizar"] }))).toBe(false); // não vê OS
    expect(ehTecnicoPuro("OPERADOR", null)).toBe(false);
    // O papel TECNICO está SEMPRE no app (painel travado), com ou sem vínculo — sem vínculo não vê OS.
    expect(emModoTecnico({ role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" })).toBe(true);
    expect(emModoTecnico({ role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: null })).toBe(true);
    // Técnico puro por PERMISSÃO (sem o papel TECNICO) só entra no modo quando ligado a um técnico.
    expect(emModoTecnico({ role: "OPERADOR", permissoes: PRESETS.TECNICO, tecnicoId: "t1" })).toBe(true);
    expect(emModoTecnico({ role: "OPERADOR", permissoes: PRESETS.TECNICO, tecnicoId: null })).toBe(false);
    expect(emModoTecnico({ role: "OPERADOR", permissoes: permissoesTotais(), tecnicoId: "t1" })).toBe(false);
  });

  it("para onde o técnico puro vai: o sistema leva a Meu dia; link antigo de execução abre a mesma atividade no app", () => {
    // G12 (UX-3): área do escritório leva ao app COM aviso; a raiz é só a entrada (sem aviso)
    expect(destinoModoTecnico("/dashboard")).toBe("/tecnico?aviso=restrito");
    expect(destinoModoTecnico("/")).toBe("/tecnico");
    expect(destinoModoTecnico("/ordens")).toBe("/tecnico?aviso=restrito");
    expect(destinoModoTecnico("/clientes/123")).toBe("/tecnico?aviso=restrito");
    expect(destinoModoTecnico("/ordens/os1/atividades/at9/executar")).toBe("/tecnico?ver=os&a=at9");
    expect(destinoModoTecnico("/tecnicos")).toBe("/tecnico?aviso=restrito"); // cadastro de técnicos ≠ app do técnico
    for (const livre of ["/tecnico", "/veiculos/checklist", "/sem-permissao", "/offline", "/api/tecnico/sync", "/api/ordens/1"]) expect(destinoModoTecnico(livre)).toBeNull();
  });

  it("cartão: endereço numa linha, rota (coordenadas ou endereço), hora (meia-noite = sem horário), ordem do dia", () => {
    expect(enderecoEmLinha({ logradouro: "Rua A", numero: "10", complemento: "sala 2", bairro: "Centro", cidade: "Santos", estado: "SP" })).toBe("Rua A, 10 (sala 2) — Centro, Santos/SP");
    expect(enderecoEmLinha({ cidade: "Santos" })).toBe("Santos");
    expect(enderecoEmLinha(null)).toBe("");
    expect(linkRota({ latitude: -23.5, longitude: -46.6, logradouro: "x" })).toBe("https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=-23.5%2C-46.6");
    expect(linkRota({ latitude: 0, longitude: 0, logradouro: "Rua A", cidade: "Santos", cep: "11000-000" })).toContain("destination=Rua%20A%20%E2%80%94%20Santos%2011000-000");
    expect(linkRota({})).toBeNull();
    expect(horaMarcada("2026-10-20T11:30:00.000Z")).toBe("08:30"); // Brasília
    expect(horaMarcada("2026-10-20T03:00:00.000Z")).toBeNull();
    const l = [{ dataAgendada: "2026-10-20T17:00:00Z", hora: "14:00", osNumero: "OS-2" }, { dataAgendada: "2026-10-20T03:00:00Z", hora: null, osNumero: "OS-1" }, { dataAgendada: "2026-10-20T11:30:00Z", hora: "08:30", osNumero: "OS-3" }];
    expect(ordenarDoDia(l).map((x) => x.osNumero)).toEqual(["OS-3", "OS-2", "OS-1"]);
  });

  it("medição digitada no celular: vírgula decimal, negativo, vazio; texto inválido não vira número", async () => {
    const { lerNumero } = await import("@/components/tecnico/equipamento");
    expect([lerNumero("12,5"), lerNumero("-3"), lerNumero(" 118.5 "), lerNumero("1.234,5"), lerNumero("")]).toEqual([12.5, -3, 118.5, 1234.5, null]);
    expect(lerNumero("abc")).toBeNaN();
    expect(lerNumero("12,5,1")).toBeNaN();
  });
});

/* ═════════════════════════ telas ═════════════════════════ */
describe("Meu dia", () => {
  it("cartões na ordem do servidor (horário), com cliente, endereço, rota, horário, situação e nº de equipamentos; prepara as OS para abrir sem sinal", async () => {
    const { MeuDia } = await import("@/components/tecnico/meu-dia");
    await montar(createElement(MeuDia));
    await esperarAte(() => $$("[data-cartao]").length === 3, "3 cartões");
    expect($$("[data-cartao]").map((c) => c.getAttribute("data-cartao"))).toEqual(["aB", "aA", "aG"]);
    expect($$("[data-hora]").map((h) => h.textContent)).toEqual(["08:30", "14:00", "—"]);
    const c = $("[data-cartao=aA]")!;
    expect(c.textContent).toContain("Hospital Santa Luzia");
    expect(c.textContent).toContain("Av. Paulista, 1000 — São Paulo/SP");
    expect(c.querySelector("[data-status]")!.textContent).toBe("Agendada");
    expect(c.querySelector("[data-equipamentos]")!.textContent).toContain("2 equipamentos");
    expect(c.querySelector<HTMLAnchorElement>("[data-rota]")!.href).toContain("google.com/maps/dir/");
    expect($("h1")!.textContent).toMatch(/, João$/);
    // as 3 OS ficam guardadas no aparelho
    await esperarAte(() => fetchFalso.mock.calls.filter(([u]) => String(u).startsWith("/api/tecnico/atividades/")).length === 3, "retratos baixados");
    await esperar();
    expect((await banco.retratos()).map((r) => r.atividadeId).sort()).toEqual(["aA", "aB", "aG"]);
    // tocar no cartão abre a OS no app
    await clicar(c.querySelector("button"));
    expect(window.location.search).toBe("?ver=os&a=aA");
  });

  it("SEM SINAL: mostra o Meu dia guardado (com a hora) e o indicador diz Offline", async () => {
    await motor.baixarLista("meuDia", "/api/tecnico/meu-dia");
    online = false;
    const { MeuDia } = await import("@/components/tecnico/meu-dia");
    await montar(createElement(MeuDia));
    await esperarAte(() => $$("[data-cartao]").length === 3, "cartões guardados");
    expect(caixa.textContent).toMatch(/Atualizado às \d\d:\d\d/);
    await esperarAte(() => situacao() === "offline", "offline");
  });
});

describe("Meu dia — lapidado (Etapa 2a)", () => {
  const abrirMeuDia = async (config?: any, n = 3) => {
    const { MeuDia } = await import("@/components/tecnico/meu-dia");
    await montar(createElement(MeuDia), config);
    if (n) await esperarAte(() => $$("[data-cartao]").length === n, `${n} cartões`);
  };

  it("permissões do app: 'Exibir dados do cliente' DESLIGADO — cartão sem nome, unidade, endereço nem rota; o resto fica", async () => {
    await abrirMeuDia(cfg({ exibirDadosCliente: false }));
    const c = $("[data-cartao=aA]")!;
    for (const oculto of ["Hospital Santa Luzia", "Av. Paulista", "Matriz", "Rota no mapa"]) expect(c.textContent, oculto).not.toContain(oculto);
    expect(c.querySelector("h3")!.textContent).toBe("Preventiva"); // identifica pela OS, sem repetir o título
    expect(c.querySelector("[data-linha-os]")!.textContent).toBe("OS-aA");
    expect(c.querySelector("[data-endereco]")).toBeNull();
    expect(c.querySelector("[data-rota]")).toBeNull();
    // o que ele precisa para o dia continua: horário, situação, equipamentos — e o contato (outra chave)
    expect(c.querySelector("[data-hora]")!.textContent).toBe("14:00");
    expect(c.querySelector("[data-status]")!.textContent).toBe("Agendada");
    expect(c.querySelector("[data-equipamentos]")!.textContent).toContain("2 equipamentos");
    expect(c.querySelector("[data-ligar]")).not.toBeNull();
  });

  it("permissões do app: 'Exibir contatos' DESLIGADO — sem Ligar (a rota fica); as duas desligadas — sem barra de ações", async () => {
    await abrirMeuDia(cfg({ exibirContatosCliente: false }));
    const c = $("[data-cartao=aA]")!;
    expect(c.querySelector("[data-ligar]")).toBeNull();
    expect(c.textContent).not.toContain("Ligar");
    expect(c.querySelector("[data-rota]")).not.toBeNull();
    expect(c.textContent).toContain("Hospital Santa Luzia");
    act(() => root.unmount()); caixa.remove();
    await abrirMeuDia(cfg({ exibirDadosCliente: false, exibirContatosCliente: false }));
    expect($$("[data-acoes-cartao]")).toEqual([]);
    expect($$("a[href^='tel:']")).toEqual([]);
  });

  it("o servidor já mandou o cartão sem os dados (chave desligada depois da página aberta): a tela não quebra nem mostra vazio", async () => {
    const original = meuDia.atividades;
    meuDia.atividades = original.map((c) => aplicarPrivacidade(c, { exibirDadosCliente: false, exibirContatosCliente: false }));
    try {
      await abrirMeuDia(); // config da página ainda "tudo ligado"
      const c = $("[data-cartao=aA]")!;
      expect(c.querySelector("h3")!.textContent).toBe("Preventiva");
      expect(c.querySelector("[data-linha-os]")!.textContent).toBe("OS-aA");
      expect(c.querySelector("[data-acoes-cartao]")).toBeNull();
    } finally { meuDia.atividades = original; }
  });

  it("carregando: esqueleto até a lista chegar", async () => {
    let soltar!: () => void;
    segurarMeuDia = new Promise((r) => { soltar = r; });
    await abrirMeuDia(undefined, 0);
    expect($("[data-carregando]")).not.toBeNull();
    expect($$("[data-cartao]")).toEqual([]);
    soltar();
    await esperarAte(() => $$("[data-cartao]").length === 3, "lista chegou");
    expect($("[data-carregando]")).toBeNull();
  });

  it("vazio: 'Nenhuma OS para hoje', sem barra de progresso, com atalho (≥44px) para a agenda", async () => {
    const original = meuDia.atividades;
    meuDia.atividades = [];
    try {
      await abrirMeuDia(undefined, 0);
      await esperarAte(() => !!$("[data-dia-vazio]"), "estado vazio");
      expect($("[data-dia-vazio]")!.textContent).toContain("Nenhuma OS para hoje");
      expect($("[data-resumo-dia]")!.textContent).toBe("Nenhuma OS para hoje.");
      expect($("[data-progresso-dia]")).toBeNull();
      const atalho = $("[data-dia-vazio] button")!;
      expect(atalho.className).toContain("touch-target");
      await clicar(atalho);
      expect(window.location.search).toBe("?ver=agenda");
    } finally { meuDia.atividades = original; }
  });

  it("sem internet e sem nada guardado: explica e deixa tentar de novo (não quebra); o sinal volta e a lista aparece", async () => {
    online = false;
    await abrirMeuDia(undefined, 0);
    await esperarAte(() => !!$("[data-sem-dados]"), "aviso sem dados");
    expect($("[data-sem-dados]")!.textContent).toContain("Sem sinal e nada guardado ainda");
    expect($$("[data-cartao]")).toEqual([]);
    online = true;
    await clicar($("[data-sem-dados] button"));
    await esperarAte(() => $$("[data-cartao]").length === 3, "lista depois do sinal");
    expect($("[data-sem-dados]")).toBeNull();
  });

  it("progresso do dia e a PRÓXIMA: conta o que ele já concluiu no aparelho (sem sinal) e diz que a lista é a guardada", async () => {
    await abrirMeuDia();
    // de início: nada concluído, a primeira do horário é a próxima
    expect($("[data-progresso-dia]")!.getAttribute("data-progresso-dia")).toBe("0/3");
    expect($("[data-resumo-dia]")!.textContent).toBe("3 OS para hoje, na ordem do horário.");
    expect($$("[data-proxima]").map((c) => c.getAttribute("data-cartao"))).toEqual(["aB"]);
    expect($("[data-cartao=aB]")!.textContent).toContain("Próxima");
    expect($("[data-origem]")).toBeNull(); // veio do servidor: sem o aviso de "guardado no aparelho"
    act(() => root.unmount()); caixa.remove();

    online = false;
    await motor.registrar([{ tipo: "concluir", atividadeId: "aB", dados: {} }]);
    await abrirMeuDia();
    expect($("[data-progresso-dia]")!.getAttribute("data-progresso-dia")).toBe("1/3");
    expect($("[data-progresso-dia]")!.getAttribute("aria-valuenow")).toBe("1");
    expect($("[data-resumo-dia]")!.textContent).toBe("3 OS para hoje, na ordem do horário · 1 concluída.");
    expect($("[data-cartao=aB] [data-status]")!.textContent).toBe("Concluída");
    expect($$("[data-proxima]").map((c) => c.getAttribute("data-cartao"))).toEqual(["aA"]);
    expect($("[data-origem=aparelho]")!.textContent).toMatch(/^Guardado no aparelho · Atualizado às \d\d:\d\d$/);
  });

  it("selo de prioridade só quando merece destaque; toque ≥44px no cartão e nas ações", async () => {
    const original = meuDia.atividades;
    meuDia.atividades = [cartao("aB", "08:30", "Padaria Pão Quente", { prioridade: "URGENTE" }), cartao("aA", "14:00", "Hospital Santa Luzia")];
    try {
      await abrirMeuDia(undefined, 2);
      expect($("[data-cartao=aB] [data-prioridade]")!.textContent).toBe("Urgente");
      expect($("[data-cartao=aA] [data-prioridade]")).toBeNull();
      for (const el of [$("[data-cartao=aA] button"), $("[data-cartao=aA] [data-rota]"), $("[data-cartao=aA] [data-ligar]")]) expect(el!.className).toContain("touch-target");
    } finally { meuDia.atividades = original; }
  });

  it("ROTA: na 1ª vez pergunta o app (Google Maps ou Waze), lembra neste aparelho e passa a abrir direto; o Perfil troca", async () => {
    const naoNavegar = (e: Event) => e.preventDefault(); // o teste não sai da página
    document.addEventListener("click", naoNavegar, true);
    try {
      await abrirMeuDia();
      const link = (id = "aA") => $<HTMLAnchorElement>(`[data-cartao=${id}] [data-rota]`)!;
      expect(link().href).toContain("google.com/maps/dir/"); // link de verdade mesmo antes de escolher
      await clicar(link());
      expect($("[data-escolher-rota]")).not.toBeNull();
      expect($<HTMLAnchorElement>("[data-abrir-rota=google]")!.href).toContain("google.com/maps/dir/");
      expect($<HTMLAnchorElement>("[data-abrir-rota=waze]")!.href).toBe("https://waze.com/ul?ll=-23.5%2C-46.6&navigate=yes");
      await clicar($("[data-abrir-rota=waze]"));
      expect(window.localStorage.getItem("frivo:app-rota")).toBe("waze");
      expect($("[data-escolher-rota]")).toBeNull();
      // todos os cartões passam a abrir o Waze direto (sem perguntar)
      expect(link().href).toBe("https://waze.com/ul?ll=-23.5%2C-46.6&navigate=yes");
      expect(link("aB").getAttribute("data-app-rota")).toBe("waze");
      await clicar(link());
      expect($("[data-escolher-rota]")).toBeNull();
      act(() => root.unmount()); caixa.remove();

      // Perfil: troca o app lembrado, ou volta a perguntar
      const { PreferenciaRota } = await import("@/components/tecnico/rota");
      await montar(createElement(PreferenciaRota));
      expect($("[data-opcao-rota=waze]")!.getAttribute("aria-pressed")).toBe("true");
      await clicar($("[data-opcao-rota=google]"));
      expect(window.localStorage.getItem("frivo:app-rota")).toBe("google");
      expect($("[data-opcao-rota=google]")!.getAttribute("aria-pressed")).toBe("true");
      await clicar($("[data-opcao-rota=perguntar]"));
      expect(window.localStorage.getItem("frivo:app-rota")).toBeNull();
    } finally { document.removeEventListener("click", naoNavegar, true); }
  });

  it("regras puras: link do Waze (coordenada ou endereço), app escolhido e privacidade do cartão", () => {
    const comCoord = linkRota({ latitude: -23.56, longitude: -46.65 })!;
    const comEndereco = linkRota({ logradouro: "Rua das Flores", numero: "10", cidade: "Santos", estado: "SP" })!;
    expect(linkWaze(comCoord)).toBe("https://waze.com/ul?ll=-23.56%2C-46.65&navigate=yes");
    expect(linkWaze(comEndereco)).toBe(`https://waze.com/ul?q=${encodeURIComponent("Rua das Flores, 10 — Santos/SP")}&navigate=yes`);
    expect([linkWaze(null), linkWaze(""), linkWaze("não é url"), linkWaze("https://www.google.com/maps")]).toEqual([null, null, null, null]);
    expect(linkDoApp(comCoord, "google")).toBe(comCoord);
    expect(linkDoApp(comCoord, "waze")).toBe(linkWaze(comCoord));
    expect(linkDoApp("https://www.google.com/maps", "waze")).toBe("https://www.google.com/maps"); // sem destino: fica no Google

    const c = cartao("aA", "14:00", "Hospital Santa Luzia");
    expect(aplicarPrivacidade(c, { exibirDadosCliente: true, exibirContatosCliente: true })).toEqual(c);
    expect(aplicarPrivacidade(c, { exibirDadosCliente: false, exibirContatosCliente: true }))
      .toEqual({ ...c, cliente: "", unidade: null, endereco: "", rota: null, descricao: "" });
    expect(aplicarPrivacidade(c, { exibirDadosCliente: true, exibirContatosCliente: false })).toEqual({ ...c, telefone: null });
  });
});

describe("execução guiada", () => {
  it("TUDO OK marca só os sem resposta (medição fica); medição grava número + unidade; tudo SEM SINAL fica na fila; o sinal volta e sobe", async () => {
    await motor.baixarRetrato("aA");
    online = false;
    await abrirOs("aA", "eqA");
    expect($("[data-vista=equipamento]")).not.toBeNull();
    expect($("[data-progresso]")!.textContent).toBe("0 de 3");
    await clicar($("[data-tudo-ok]"));
    await esperarAte(() => $("[data-progresso]")!.textContent === "2 de 3", "TUDO OK aplicado");
    expect($$("[data-item=i1] [data-chip=OK], [data-item=i2] [data-chip=OK]").map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "true"]);
    expect($("[data-tudo-ok]")!.hasAttribute("disabled")).toBe(true);
    // medição: texto inválido não grava; "118,5" grava 118.5 com a unidade do item
    const campo = $<HTMLInputElement>("[data-item=m1] input")!;
    await digitar(campo, "abc"); await sair(campo);
    expect($("[data-item=m1]")!.textContent).toContain("Número inválido");
    await digitar(campo, "118,5"); await sair(campo);
    await esperarAte(() => $("[data-progresso]")!.textContent === "3 de 3", "medição gravada");
    const ops = await fila();
    expect(ops.map((o) => [o.tipo, o.estado])).toEqual([["iniciar", "pendente"], ["tudoOk", "pendente"], ["resposta", "pendente"]]);
    expect(ops[2]).toMatchObject({ equipamentoId: "eqA", itemId: "m1", dados: { valor: 118.5 } });
    expect(enviadas).toEqual([]); // sem sinal: nada saiu
    await esperarAte(() => situacao() === "offline", "indicador offline");
    // ainda falta a foto pedida pelo item 1 → concluir mostra o que falta
    await clicar($("[data-concluir-equipamento]"));
    // UX-7 (Y8): a pendência é um BOTÃO que leva ao item
    const pendencia = $$("[data-faltas] [data-pendencia]").find((b) => b.textContent!.includes("Foto: Limpeza dos filtros"));
    expect(pendencia).toBeTruthy();
    const alvoPulo: Element[] = [];
    (Element.prototype as any).scrollIntoView = function () { alvoPulo.push(this); };
    await clicar(pendencia!);
    expect(alvoPulo.some((el) => (el as HTMLElement).getAttribute("data-item") === "i1")).toBe(true);
    await foto($("[data-item=i1] input[data-foto-input]"));
    await esperarAte(() => !!$("[data-item=i1] [data-miniatura]"), "miniatura da foto");
    expect($("[data-item=i1] [data-miniatura]")!.textContent).toContain("no aparelho");
    // UX-7 (Y9): depois de anexar, o botão confirma — e (G11) o progresso tem legenda
    expect($$("[data-item=i1] button").some((b) => b.textContent!.includes("Foto registrada (1)"))).toBe(true);
    expect($("[data-progresso-legenda]")!.textContent).toContain("Itens do checklist e medições");
    await clicar($("[data-concluir-equipamento]"));
    await esperarAte(() => window.location.search === "?ver=os&a=aA&e=eqB", "foi para o próximo");
    // o sinal volta: sobe tudo, em ordem, e o indicador fica Sincronizado
    online = true;
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await motor.sincronizar(true);
    await esperarAte(() => situacao() === "sincronizado", "sincronizado");
    expect(enviadas.map((o) => o.tipo)).toEqual(["iniciar", "tudoOk", "resposta", "foto"]); // já estava atendido: concluir o equipamento não grava nada a mais
  });

  it("“Atenção” só salva com foto + observação; grava status + observação; a foto vai junto", async () => {
    await motor.baixarRetrato("aA");
    online = false;
    await abrirOs("aA", "eqA");
    await clicar($("[data-item=i2] [data-chip=ATENCAO]"));
    expect($("[data-modal-atencao]")).not.toBeNull();
    const salvar = () => $("[data-salvar-atencao]")!;
    expect(salvar().hasAttribute("disabled")).toBe(true);
    await foto($("[data-modal-atencao] input[data-foto-input]"));
    await esperarAte(() => !!$("[data-modal-atencao] [data-miniatura]"), "foto no modal");
    expect(salvar().hasAttribute("disabled")).toBe(true); // falta a observação
    await digitar($("[data-modal-atencao] textarea"), "Bandeja com lodo");
    await esperarAte(() => !salvar().hasAttribute("disabled"), "salvar habilitado");
    await clicar(salvar());
    await esperarAte(() => !$("[data-modal-atencao]"), "modal fechado");
    expect($("[data-item=i2] [data-chip=ATENCAO]")!.getAttribute("aria-pressed")).toBe("true");
    expect($("[data-resumo-atencao]")!.textContent).toContain("Bandeja com lodo");
    const ops = await fila();
    expect(ops.map((o) => o.tipo)).toEqual(["iniciar", "foto", "resposta"]);
    expect(ops[1]).toMatchObject({ dados: { itemId: "i2", clientId: expect.any(String), dataUrl: "data:image/jpeg;base64,/9j/FOTO" } });
    expect(ops[2]).toMatchObject({ itemId: "i2", dados: { status: "ATENCAO", observacao: "Bandeja com lodo" } });
  });

  it("serviço extra entra na MESMA OS (com foto) e aparece destacado; concluir com pendência mostra o que falta e não grava", async () => {
    await motor.baixarRetrato("aA");
    online = false;
    await abrirOs("aA");
    expect($$("[data-equip-linha]").map((l) => l.getAttribute("data-situacao"))).toEqual(["nao-iniciado", "nao-iniciado"]);
    await clicar($("[data-novo-adicional]"));
    // UX-7 (G13): a option diz QUAL equipamento (TAG e local), não só o nome repetido
    expect($$("[data-modal-adicional] select option").some((o) => o.textContent!.includes("TAG AC-01 · Sala 1"))).toBe(true);
    const salvar = () => $("[data-salvar-adicional]")!;
    expect(salvar().hasAttribute("disabled")).toBe(true);
    await digitar($("[data-modal-adicional] textarea"), "Troca do controle remoto");
    await foto($("[data-modal-adicional] input[data-foto-input]"));
    await clicar(salvar());
    await esperarAte(() => $$("[data-adicional]").length === 1, "adicional na lista");
    expect($("[data-adicional]")!.textContent).toContain("Adicional");
    expect($("[data-adicional]")!.textContent).toContain("Troca do controle remoto");
    const ops = await fila();
    expect(ops.map((o) => o.tipo)).toEqual(["iniciar", "adicional", "adicionalFoto"]);
    const ad = ops[1] as any;
    expect(ad.dados).toMatchObject({ descricao: "Troca do controle remoto", equipamentoId: null, clientId: expect.any(String) });
    expect((ops[2] as any).dados.servicoClientId).toBe(ad.dados.clientId);
    // concluir: nenhum equipamento atendido → mostra o motivo, nada vai para a fila
    await clicar($("[data-concluir-atividade]"));
    expect($("[data-pendencias]")!.textContent).toContain("vincule pelo menos 1 equipamento atendido");
    expect((await fila()).some((o) => o.tipo === "concluir")).toBe(false);
  });

  it("foto do serviço: exige a que se refere (equipamento ou Geral) + legenda + foto; vai para a fila e aparece na OS; remover pede confirmação", async () => {
    await motor.baixarRetrato("aA");
    online = false;
    await abrirOs("aA");
    expect($("[data-fotos-servico]")!.textContent).toContain("Cada foto vai com o equipamento (ou “Geral da OS”) e uma legenda");
    const escolher = async (el: Element | null, v: string) => {
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
      await esperar();
    };
    const salvar = () => $<HTMLButtonElement>("[data-salvar-foto-servico]")!;

    await clicar($("[data-nova-foto-servico]"));
    expect($$("[data-modal-foto-servico] [data-referencia] option").map((o) => o.getAttribute("value"))).toEqual(["", "eqA", "eqB", "GERAL"]);
    expect($$("[data-modal-foto-servico] [data-referencia] option")[1].textContent).toBe("Split Sala 1 — Daikin FTXS — TAG AC-01 — Sala 1");
    expect(salvar().disabled).toBe(true);
    await foto($("[data-modal-foto-servico] input[data-foto-input]"));
    await digitar($("[data-modal-foto-servico] [data-legenda]"), "Placa da condensadora");
    await esperar();
    expect(salvar().disabled).toBe(true); // falta dizer a que se refere
    await escolher($("[data-modal-foto-servico] [data-referencia]"), "eqA");
    expect(salvar().disabled).toBe(false);
    await clicar(salvar());
    await esperarAte(() => $$("[data-foto-servico]").length === 1, "foto na lista");
    expect($("[data-foto-servico]")!.textContent).toContain("Placa da condensadora");
    expect($("[data-foto-servico] [data-referencia-foto]")!.textContent).toBe("Split Sala 1 · Daikin FTXS · TAG AC-01");
    expect($("[data-foto-servico]")!.textContent).toContain("no aparelho");

    await clicar($("[data-nova-foto-servico]"));
    await escolher($("[data-modal-foto-servico] [data-referencia]"), "GERAL");
    await digitar($("[data-modal-foto-servico] [data-legenda]"), "Quadro elétrico");
    await foto($("[data-modal-foto-servico] input[data-foto-input]"));
    await clicar(salvar());
    await esperarAte(() => $$("[data-foto-servico]").length === 2, "2ª foto");
    expect($$("[data-foto-servico] [data-referencia-foto]").map((e) => e.textContent)).toEqual(["Split Sala 1 · Daikin FTXS · TAG AC-01", "Geral da OS"]);

    let ops = await fila();
    expect(ops.map((o) => o.tipo)).toEqual(["iniciar", "fotoOs", "fotoOs"]);
    const [, f1, f2] = ops as any[];
    expect(f1).toMatchObject({ atividadeId: "aA", dados: { equipamentoId: "eqA", legenda: "Placa da condensadora", dataUrl: "data:image/jpeg;base64,/9j/FOTO", clientId: expect.any(String) } });
    expect(f2.dados).toMatchObject({ equipamentoId: null, legenda: "Quadro elétrico" });

    // Remover: confirmação (sem host de avisos, cai no confirm do navegador); cancelar não remove
    const confirmar = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await clicar($$("[data-foto-servico] button[aria-label^='Excluir']")[0]);
    expect((await fila()).map((o) => o.tipo)).toEqual(["iniciar", "fotoOs", "fotoOs"]);
    await clicar($$("[data-foto-servico] button[aria-label^='Excluir']")[0]);
    await esperarAte(() => $$("[data-foto-servico]").length === 1, "foto removida");
    ops = await fila();
    expect(ops.at(-1)).toMatchObject({ tipo: "fotoOsRemover", dados: { clientId: f1.dados.clientId } });
    expect(confirmar).toHaveBeenCalledTimes(2);
    confirmar.mockRestore();
  });
});

/* ═════════════════════════ execução guiada — lapidada (Etapa 2b) ═════════════════════════ */
describe("execução guiada — lapidada (Etapa 2b)", () => {
  /** Arquivo ANTIGO (galeria/pasta): a data dele é de quando foi tirado, não de agora */
  async function fotoAntiga(input: Element | null) {
    expect(input).not.toBeNull();
    await act(async () => {
      Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array([1, 2, 3])], "galeria.jpg", { type: "image/jpeg", lastModified: Date.now() - 3 * 60 * 60 * 1000 })] });
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperar();
  }
  /** A OS aberta PELA URL (como no app): tocar em voltar, nas setas ou em concluir troca a tela de verdade */
  async function abrirNaUrl(equipamentoId?: string, config?: any) {
    const { VistaOs } = await import("@/components/tecnico/execucao");
    const { useVista } = await import("@/components/tecnico/contexto");
    function Roteada() { const v = useVista(); return v?.ver === "os" ? createElement(VistaOs, { key: v.a, atividadeId: v.a, equipamentoId: v.e }) : null; }
    window.history.replaceState(null, "", `/tecnico?ver=os&a=aA${equipamentoId ? `&e=${equipamentoId}` : ""}`);
    await montar(createElement(Roteada), config);
    await esperarAte(() => !!$("[data-vista]"), "OS carregada");
  }
  const offline = async (equipamentoId?: string, config?: any) => { await motor.baixarRetrato("aA"); online = false; await abrirNaUrl(equipamentoId, config); };
  const rodape = () => $("[data-concluir-equipamento]")!;
  /** Deixa o equipamento aberto completo: TUDO OK + a medição + a foto pedida pelo item 1 */
  async function completar() {
    await clicar($("[data-tudo-ok]"));
    const campo = $<HTMLInputElement>("[data-item=m1] input")!;
    await digitar(campo, "118,5"); await sair(campo);
    await foto($("[data-item=i1] input[data-foto-input]"));
    await esperarAte(() => !!$("[data-destino-concluir]"), "equipamento completo");
  }

  it("1 · TUDO OK é reversível: depois dele o técnico vira um item para N/A, volta para OK, e Atenção só troca quando há prova", async () => {
    await offline("eqA");
    await clicar($("[data-tudo-ok]"));
    const pressionado = (item: string, chip: string) => $(`[data-item=${item}] [data-chip=${chip}]`)!.getAttribute("aria-pressed");
    expect([pressionado("i1", "OK"), pressionado("i2", "OK")]).toEqual(["true", "true"]);
    await clicar($("[data-item=i2] [data-chip=NAO_SE_APLICA]"));
    expect([pressionado("i2", "NAO_SE_APLICA"), pressionado("i2", "OK")]).toEqual(["true", "false"]);
    await clicar($("[data-item=i2] [data-chip=OK]"));
    expect(pressionado("i2", "OK")).toBe("true");
    // Atenção: abre a prova; fechar sem prova NÃO troca o item (continua OK)
    await clicar($("[data-item=i2] [data-chip=ATENCAO]"));
    expect($("[data-modal-atencao]")).not.toBeNull();
    await clicar($("[data-modal-atencao]")!.closest("[role=dialog]")?.querySelector("button[aria-label*='echar']") ?? $("button[aria-label*='echar']"));
    await esperarAte(() => !$("[data-modal-atencao]"), "modal fechado");
    expect([pressionado("i2", "OK"), pressionado("i2", "ATENCAO")]).toEqual(["true", "false"]);
    expect((await fila()).map((o) => [o.tipo, (o as any).dados?.status ?? null])).toEqual([["iniciar", null], ["tudoOk", null], ["resposta", "NAO_SE_APLICA"], ["resposta", "OK"]]);
  });

  it("3 · Atenção exige prova: diz o que falta (foto, depois observação); a foto leva a marca d'água da OS; sem a foto o equipamento não conclui", async () => {
    const { aplicarMarcaDagua } = await import("@/lib/imagem-cliente");
    (aplicarMarcaDagua as any).mockClear();
    await offline("eqA", cfg({ marcaDaguaEndereco: true }));
    await clicar($("[data-item=i2] [data-chip=ATENCAO]"));
    const falta = () => $("[data-falta-atencao]")?.textContent ?? null;
    expect(falta()).toBe("Para marcar Atenção: pelo menos 1 foto e a observação.");
    await digitar($("[data-modal-atencao] textarea"), "Bandeja com lodo");
    await esperarAte(() => falta() === "Falta a foto do problema.", "pede a foto");
    expect($("[data-salvar-atencao]")!.hasAttribute("disabled")).toBe(true);
    await foto($("[data-modal-atencao] input[data-foto-input]"));
    await esperarAte(() => falta() === null, "prova completa");
    // a foto do problema é carimbada com a OS e o endereço (antes saía só com data/hora)
    const linhas = (aplicarMarcaDagua as any).mock.calls.at(-1)[1] as string[];
    expect(linhas).toContain("OS OS-aA");
    expect(linhas).toContain("Av. Paulista, 1000 — São Paulo/SP");
    await clicar($("[data-salvar-atencao]"));
    await esperarAte(() => !$("[data-modal-atencao]"), "modal fechado");
    // tira a foto do item em Atenção: volta a faltar e o equipamento não conclui
    await clicar($("[data-tudo-ok]"));
    const campo = $<HTMLInputElement>("[data-item=m1] input")!;
    await digitar(campo, "10"); await sair(campo);
    await foto($("[data-item=i1] input[data-foto-input]"));
    await esperarAte(() => !!$("[data-destino-concluir]"), "completo com a prova");
    const confirmar = vi.spyOn(await import("@/components/ui/avisos"), "confirmar").mockResolvedValue(true);
    await clicar($("[data-item=i2] [data-miniatura] button"));
    confirmar.mockRestore();
    await esperarAte(() => rodape().querySelector("[data-faltam]")?.getAttribute("data-faltam") === "1", "voltou a faltar a foto");
    await clicar(rodape());
    expect(window.location.search).toBe("?ver=os&a=aA&e=eqA"); // não saiu do equipamento
    expect($$("[data-faltas] [data-pendencia]").map((b) => b.textContent)).toEqual(["Foto: Dreno e bandeja ›"]);
  });

  it("4 · Próximo equipamento: 'Equipamento 1 de 2', setas para pular, rodapé conta o que falta e diz para onde vai", async () => {
    await offline("eqA");
    expect($("[data-posicao-equipamento]")!.textContent).toBe("Equipamento 1 de 2");
    expect($<HTMLButtonElement>("[data-nav-equipamento=anterior]")!.disabled).toBe(true);
    expect($("[data-nav-equipamento=proximo]")!.className).toContain("touch-target");
    // incompleto: o rodapé conta (3 itens sem resposta) em vez de só "ver o que falta"
    expect(rodape().textContent).toBe("Faltam 3 — ver o que falta");
    await completar();
    expect(rodape().textContent).toContain("Concluir e ir ao próximo");
    expect($("[data-destino-concluir]")!.textContent).toBe("Split Sala 2 · equipamento 2 de 2");
    await clicar(rodape());
    await esperarAte(() => window.location.search === "?ver=os&a=aA&e=eqB", "foi para o próximo");
    expect($("[data-posicao-equipamento]")!.textContent).toBe("Equipamento 2 de 2");
    expect($<HTMLButtonElement>("[data-nav-equipamento=proximo]")!.disabled).toBe(true);
    // último: concluir volta para a OS (onde se conclui a atividade)
    await completar();
    expect(rodape().textContent).toContain("Concluir equipamento");
    expect($("[data-destino-concluir]")!.textContent).toBe("Volta para a OS para concluir a atividade");
    // as setas pulam sem concluir nem gravar nada
    const antes = (await fila()).length;
    await clicar($("[data-nav-equipamento=anterior]"));
    await esperarAte(() => window.location.search === "?ver=os&a=aA&e=eqA", "voltou pela seta");
    expect((await fila()).length).toBe(antes);
    await clicar($("[data-nav-equipamento=proximo]"));
    await esperarAte(() => window.location.search === "?ver=os&a=aA&e=eqB", "avançou pela seta");
    await clicar(rodape());
    await esperarAte(() => window.location.search === "?ver=os&a=aA", "voltou para a OS");
  });

  it("5 · Fotos ANTES e DEPOIS por equipamento: cada uma na sua seção, com a contagem, gravadas com o momento (sem mudança de banco)", async () => {
    await offline("eqA");
    expect($("[data-secao=antes] [data-contagem-fotos]")).toBeNull();
    await foto($("[data-secao=antes] input[data-foto-input]"));
    await foto($("[data-secao=antes] input[data-foto-input]"));
    await foto($("[data-secao=depois] input[data-foto-input]"));
    await esperarAte(() => $$("[data-secao=antes] [data-miniatura]").length === 2 && $$("[data-secao=depois] [data-miniatura]").length === 1, "fotos nas seções");
    expect($("[data-secao=antes] [data-contagem-fotos]")!.textContent).toBe("2");
    expect($("[data-secao=depois] [data-contagem-fotos]")!.textContent).toBe("1");
    expect((await fila()).filter((o) => o.tipo === "foto").map((o: any) => [o.dados.momento, o.dados.itemId ?? null])).toEqual([["ANTES", null], ["ANTES", null], ["DEPOIS", null]]);
  });

  it("permissões · 'Foto somente pela câmera' bloqueia a galeria DE VERDADE: arquivo antigo é recusado e nada é gravado; foto tirada agora passa", async () => {
    await offline("eqA", cfg({ fotoSomenteCamera: true }));
    const campo = () => $("[data-secao=antes] input[data-foto-input]");
    expect(campo()!.getAttribute("capture")).toBe("environment");
    await fotoAntiga(campo());
    expect($("[data-secao=antes] [data-erro-foto]")!.textContent).toContain("Fotos da galeria ficam bloqueadas");
    expect($$("[data-secao=antes] [data-miniatura]")).toEqual([]);
    expect((await fila()).some((o) => o.tipo === "foto")).toBe(false);
    await foto(campo());
    await esperarAte(() => $$("[data-secao=antes] [data-miniatura]").length === 1, "foto da câmera aceita");
    expect($("[data-secao=antes] [data-erro-foto]")).toBeNull();
    // a prova da Atenção segue a mesma regra
    await clicar($("[data-item=i2] [data-chip=ATENCAO]"));
    await fotoAntiga($("[data-modal-atencao] input[data-foto-input]"));
    expect($("[data-modal-atencao] [data-erro-foto]")).not.toBeNull();
    expect($("[data-modal-atencao] [data-miniatura]")).toBeNull();
  });

  it("permissões · com a chave desligada a galeria vale (arquivo antigo é aceito); regra pura da data do arquivo", async () => {
    await offline("eqA", cfg({ fotoSomenteCamera: false }));
    await fotoAntiga($("[data-secao=antes] input[data-foto-input]"));
    await esperarAte(() => $$("[data-secao=antes] [data-miniatura]").length === 1, "galeria aceita");
    const { fotoTiradaAgora, TOLERANCIA_CAMERA_MS } = await import("@/lib/tecnico/camera");
    const agora = 1_800_000_000_000;
    expect(fotoTiradaAgora({ lastModified: agora - 1000 }, agora)).toBe(true);
    expect(fotoTiradaAgora({ lastModified: agora - TOLERANCIA_CAMERA_MS }, agora)).toBe(true);
    expect(fotoTiradaAgora({ lastModified: agora - TOLERANCIA_CAMERA_MS - 1 }, agora)).toBe(false);
    expect(fotoTiradaAgora({ lastModified: agora - 86_400_000 }, agora)).toBe(false);
    expect([fotoTiradaAgora({}, agora), fotoTiradaAgora({ lastModified: 0 }, agora)]).toEqual([true, true]); // sem data: vale o capture
  });

  it("permissões · com 'Exibir dados do cliente' desligado, a tela do equipamento e a OS não mostram cliente, unidade nem endereço", async () => {
    await offline("eqA", cfg({ exibirDadosCliente: false, exibirContatosCliente: false }));
    for (const dado of ["Hospital Santa Luzia", "Av. Paulista", "Matriz", "1133334444"]) expect(caixa.textContent, dado).not.toContain(dado);
    expect($("h1")!.textContent).toBe("Split Sala 1"); // o trabalho segue identificado pelo equipamento
    await clicar($("[data-vista=equipamento] button")); // "Equipamentos da OS"
    await esperarAte(() => !!$("[data-vista=os]"), "voltou para a OS");
    for (const dado of ["Hospital Santa Luzia", "Av. Paulista", "Matriz", "Ligar", "Rota no mapa"]) expect(caixa.textContent, dado).not.toContain(dado);
  });

  it("salvamento incremental SEM SINAL: fechar e reabrir não apaga resposta nem foto (ficam no aparelho) — e nada foi enviado", async () => {
    await offline("eqA");
    await clicar($("[data-item=i2] [data-chip=NAO_SE_APLICA]"));
    await foto($("[data-secao=antes] input[data-foto-input]"));
    await foto($("[data-item=i1] input[data-foto-input]"));
    await esperarAte(() => $$("[data-miniatura]").length === 2, "fotos gravadas");
    act(() => root.unmount()); caixa.remove();
    await abrirNaUrl("eqA"); // reabre, ainda sem sinal
    expect($("[data-item=i2] [data-chip=NAO_SE_APLICA]")!.getAttribute("aria-pressed")).toBe("true");
    expect($$("[data-secao=antes] [data-miniatura]").length).toBe(1);
    expect($$("[data-item=i1] [data-miniatura]").length).toBe(1);
    expect($("[data-progresso]")!.textContent).toBe("1 de 3");
    expect(enviadas).toEqual([]);
    expect((await fila()).map((o) => [o.tipo, o.estado])).toEqual([["iniciar", "pendente"], ["resposta", "pendente"], ["foto", "pendente"], ["foto", "pendente"]]);
  });

  it("trava de conclusão mantida: atendido com checklist incompleto barra a atividade; completo, conclui (o não atendido não trava)", async () => {
    await offline("eqA");
    await clicar($("[data-tudo-ok]")); // atendido, mas faltam a medição e a foto pedida
    await clicar($("[data-vista=equipamento] button"));
    await esperarAte(() => !!$("[data-vista=os]"), "na OS");
    await clicar($("[data-concluir-atividade]"));
    expect($("[data-pendencias]")!.textContent).toContain("Split Sala 1");
    expect($("[data-confirmar-conclusao]")).toBeNull();
    expect((await fila()).some((o) => o.tipo === "concluir")).toBe(false);
    await clicar($$("[data-pendencias] button").find((b) => b.textContent!.includes("Split Sala 1"))!);
    await esperarAte(() => !!$("[data-vista=equipamento]"), "abriu o equipamento pela pendência");
    const campo = $<HTMLInputElement>("[data-item=m1] input")!;
    await digitar(campo, "118,5"); await sair(campo);
    await foto($("[data-item=i1] input[data-foto-input]"));
    await esperarAte(() => !!$("[data-destino-concluir]"), "equipamento completo");
    await clicar($("[data-vista=equipamento] button"));
    await esperarAte(() => !!$("[data-vista=os]"), "na OS de novo");
    await clicar($("[data-concluir-atividade]"));
    expect($("[data-pendencias]")).toBeNull();
    await clicar($("[data-confirmar-conclusao]"));
    await esperar();
    expect((await fila()).at(-1)).toMatchObject({ tipo: "concluir", estado: "pendente" });
  });
});

/* ═════════════════════════ App do colaborador (config por empresa) ═════════════════════════ */
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
const cfg = (over: Partial<typeof CONFIG_APP_PADRAO>) => ({ ...CONFIG_APP_PADRAO, ...over });

describe("App do colaborador: o que o técnico vê e pode fazer (por empresa)", () => {
  it("Exibir dados do cliente DESLIGADO: esconde nome, endereço, descrição e a rota no mapa", async () => {
    await abrirOs("aA", undefined, cfg({ exibirDadosCliente: false }));
    const cab = $("header")!.textContent!;
    expect(cab).not.toContain("Hospital Santa Luzia"); // nome do cliente oculto
    expect(cab).not.toContain("Av. Paulista"); // endereço oculto
    expect($("[data-descricao]")).toBeNull();
    expect(cab).not.toContain("Rota no mapa");
    expect(cab).toContain("Preventiva"); // ainda identifica a OS pelo título/nº
  });

  it("Exibir contatos DESLIGADO: some o 'Ligar', mas a rota (dados) continua", async () => {
    await abrirOs("aA", undefined, cfg({ exibirContatosCliente: false }));
    const cab = $("header")!.textContent!;
    expect(cab).not.toContain("Ligar");
    expect(cab).toContain("Rota no mapa");
    expect(cab).toContain("Hospital Santa Luzia");
  });

  it("padrão (tudo ligado): nome, endereço, rota e Ligar aparecem", async () => {
    await abrirOs("aA");
    const cab = $("header")!.textContent!;
    expect(cab).toContain("Hospital Santa Luzia");
    expect(cab).toContain("Rota no mapa");
    expect(cab).toContain("Ligar");
  });

  it("Foto somente pela câmera: LIGADO força capture=environment; DESLIGADO libera a galeria", async () => {
    const { BotaoFoto } = await import("@/components/tecnico/captura");
    await montar(createElement(BotaoFoto, { onFoto() {} }), cfg({ fotoSomenteCamera: true }));
    expect($("[data-foto-input]")!.getAttribute("capture")).toBe("environment");
    expect($("[data-foto-input]")!.getAttribute("data-somente-camera")).toBe("true");
    if (root) act(() => root.unmount()); caixa?.remove();
    await montar(createElement(BotaoFoto, { onFoto() {} }), cfg({ fotoSomenteCamera: false }));
    expect($("[data-foto-input]")!.getAttribute("capture")).toBeNull();
  });

  it("Marca d'água LIGADA: carimba data/hora + OS + endereço; DESLIGADA não carimba", async () => {
    const { BotaoFoto } = await import("@/components/tecnico/captura");
    const { aplicarMarcaDagua } = await import("@/lib/imagem-cliente");
    (aplicarMarcaDagua as any).mockClear();
    await montar(createElement(BotaoFoto, { onFoto() {}, marca: { osNumero: "OS-aA", endereco: "Av. Paulista, 1000" } }), cfg({ marcaDagua: true, marcaDaguaOs: true, marcaDaguaEndereco: true }));
    await foto($("[data-foto-input]"));
    expect(aplicarMarcaDagua).toHaveBeenCalledTimes(1);
    const linhas = (aplicarMarcaDagua as any).mock.calls[0][1] as string[];
    expect(linhas[0]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/); // data/hora sempre, primeiro
    expect(linhas).toContain("OS OS-aA");
    expect(linhas).toContain("Av. Paulista, 1000");
    if (root) act(() => root.unmount()); caixa?.remove();

    (aplicarMarcaDagua as any).mockClear();
    await montar(createElement(BotaoFoto, { onFoto() {}, marca: { osNumero: "OS-aA" } }), cfg({ marcaDagua: false }));
    await foto($("[data-foto-input]"));
    expect(aplicarMarcaDagua).not.toHaveBeenCalled();
  });

  it("Campo de conclusão obrigatório: sem o resumo, o botão de concluir fica travado", async () => {
    const { ModalConcluir } = await import("@/components/tecnico/execucao");
    const x: any = { atividade: { id: "aA", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "os", numero: "OS-1" }, adicionais: [], conclusao: { ok: true, semEquipamento: false, pendencias: [], atendidos: 1, naoAtendidos: 0, mensagem: null } };
    await montar(createElement(ModalConcluir, { x, onFechar() {}, onConcluir() {}, onJustificado() {} }), cfg({ conclusaoObrigatoria: true }));
    const botao = $("[data-confirmar-conclusao]") as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect($("[data-falta-resumo]")).not.toBeNull();
    await digitar($("textarea"), "Troca de filtro e limpeza concluídas");
    expect((($("[data-confirmar-conclusao]")) as HTMLButtonElement).disabled).toBe(false);
  });

  it("conclusão opcional (padrão): conclui mesmo sem resumo", async () => {
    const { ModalConcluir } = await import("@/components/tecnico/execucao");
    const x: any = { atividade: { id: "aA", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "os", numero: "OS-1" }, adicionais: [], conclusao: { ok: true, semEquipamento: false, pendencias: [], atendidos: 1, naoAtendidos: 0, mensagem: null } };
    await montar(createElement(ModalConcluir, { x, onFechar() {}, onConcluir() {}, onJustificado() {} }));
    expect((($("[data-confirmar-conclusao]")) as HTMLButtonElement).disabled).toBe(false);
    expect($("[data-falta-resumo]")).toBeNull();
  });
});

/* ═════════════════════════ escritório ═════════════════════════ */
async function montarSimples(el: any, role = "OPERADOR", permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role, permissoes, children: el })); });
  await esperar(2);
}
const ADICIONAL = {
  id: "s1", descricao: "Troca do controle remoto", statusCobranca: "A_AVALIAR" as const, criadoEm: "2026-10-20T15:00:00Z",
  atividade: { titulo: "Preventiva" }, equipamento: { nome: "Split Sala 2", marca: "Daikin", modelo: "FTXS", patrimonio: "AC-02" },
  criadoPor: { nome: "João" }, fotos: [{ id: "f1" }],
};

describe("escritório: adicional na OS e no relatório", () => {
  it("painel da OS: o escritório decide a cobrança (grava e desfaz se falhar); o técnico só vê", async () => {
    const { OsAdicionais } = await import("@/components/os/os-adicionais");
    const chamadas: { url: string; corpo: unknown }[] = [];
    let ok = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      chamadas.push({ url, corpo: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(ok ? {} : { erro: "Sem permissão para esta ação" }), { status: ok ? 200 : 403, headers: { "content-type": "application/json" } });
    }));
    try {
      await montarSimples(createElement(OsAdicionais, { osId: "osA", adicionais: [ADICIONAL] }));
      expect($("[data-os-adicionais]")!.textContent).toContain("Serviços adicionais pedidos na visita (1)");
      expect($("[data-a-avaliar]")!.textContent).toBe("1 a avaliar para cobrança");
      expect($("[data-adicional-os=s1]")!.textContent).toContain("Split Sala 2 · TAG AC-02");
      // Leva 4 (D4) + UX-1: marcar COBRAR pede o preço num MODAL da casa (não window.prompt)
      await clicar($("[data-cobranca=COBRAR]"));
      expect(chamadas).toEqual([]); // ainda não gravou: abriu o modal do preço
      expect($("[data-modal-preco-adicional]")).not.toBeNull();
      // preço inválido não grava e explica
      await digitar($("[data-preco-adicional]"), "0");
      await clicar($("[data-confirmar-preco]"));
      expect($("[data-erro-preco]")!.textContent).toContain("preço válido");
      expect(chamadas).toEqual([]);
      await digitar($("[data-preco-adicional]"), "180");
      await clicar($("[data-confirmar-preco]"));
      expect(chamadas).toEqual([{ url: "/api/ordens/osA/servicos-adicionais/s1", corpo: { statusCobranca: "COBRAR", valor: 180 } }]);
      expect($("[data-modal-preco-adicional]")).toBeNull(); // modal fechou
      expect($("[data-cobranca=COBRAR]")!.getAttribute("aria-pressed")).toBe("true");
      expect($("[data-a-avaliar]")).toBeNull();
      ok = false;
      await clicar($("[data-cobranca=NAO_COBRAR]"));
      await esperar();
      expect($("[data-cobranca=COBRAR]")!.getAttribute("aria-pressed")).toBe("true"); // desfeito
      expect($("[data-os-adicionais]")!.textContent).toContain("Sem permissão para esta ação");
      act(() => root.unmount()); caixa.remove();
      // técnico (mesmo com "editar OS"): só a situação, sem botões
      await montarSimples(createElement(OsAdicionais, { osId: "osA", adicionais: [ADICIONAL] }), "TECNICO", PRESETS.TECNICO);
      expect($("[data-cobranca=COBRAR]")).toBeNull();
      expect($("[data-adicional-os=s1]")!.textContent).toContain("A avaliar");
      act(() => root.unmount()); caixa.remove();
      // sem adicional: nada aparece
      await montarSimples(createElement(OsAdicionais, { osId: "osA", adicionais: [] }));
      expect($("[data-os-adicionais]")).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });

  it("documento: medição com o valor e a unidade; áudio e cobrança só na versão interna; adicional em destaque", async () => {
    const { BlocoEquip, SecaoAdicionais } = await import("@/components/relatorio/relatorio-os-documento");
    const bloco = {
      id: "eqA", local: { principal: "Sala 1", complemento: null, unidade: "Matriz" }, titulo: "Split Sala 1", descricao: "Split", fabricante: "Daikin", tag: "AC-01", numeroSerie: null,
      checklist: [], observacoes: [], fotos: [],
      checklistTipo: [{ atividade: "Preventiva", itens: [
        { texto: "Dreno e bandeja", status: "ATENCAO" as const, observacao: "Bandeja com lodo", medicao: null, audio: true },
        { texto: "Pressão de sucção", status: null, observacao: null, medicao: { valor: 118.5, unidade: "psi" }, audio: false },
      ] }],
      resumoChecklist: { ok: 0, atencao: 1, naoSeAplica: 0, medicoes: 1 },
    };
    const ad = [{ id: "s1", descricao: "Troca do controle remoto", atividade: "Preventiva", equipamento: "Split Sala 2", fotos: [], statusCobranca: "COBRAR" as const, criadoPor: "João" }];
    const doc = (interna: boolean) => createElement("div", null, createElement(BlocoEquip, { b: bloco, checklist: true, fotos: true, interna }), createElement(SecaoAdicionais, { adicionais: ad, fotos: true, interna }));
    await montarSimples(doc(true));
    expect($("[data-medicao-relatorio]")!.textContent).toBe("118,5 psi");
    expect($("[data-resumo-checklist]")!.textContent).toContain("1 medição");
    expect($("[data-audio-relatorio]")!.textContent).toContain("Observação em áudio");
    expect($("[data-adicional-relatorio]")!.textContent).toContain("Adicional");
    expect($("[data-cobranca]")!.textContent).toBe("Cobrança: Cobrar");
    act(() => root.unmount()); caixa.remove();
    await montarSimples(doc(false));
    expect($("[data-medicao-relatorio]")!.textContent).toBe("118,5 psi");
    expect($("[data-audio-relatorio]")).toBeNull();
    expect($("[data-cobranca]")).toBeNull();
    expect($("[data-adicional-relatorio]")!.textContent).toContain("Troca do controle remoto");
  });
});
