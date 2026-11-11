// @vitest-environment happy-dom
/**
 * Cadastro de equipamento EM CAMPO — a tela do app do técnico num DOM de verdade, com o banco do
 * aparelho de verdade (IndexedDB via fake-indexeddb) e o motor de sincronização real:
 *  - "Cadastrar novo equipamento" só aparece com a permissão ligada (e a OS com unidade);
 *  - formulário enxuto: só o tipo é obrigatório, dos tipos que já existem; cliente/unidade não são pedidos;
 *  - SEM SINAL: salva na fila do aparelho, o equipamento já aparece na OS com o checklist do tipo e o
 *    técnico segue nele; a série é conferida com o que o aparelho tem e a tela diz que a conferência
 *    completa acontece ao sincronizar; o sinal volta e sobe sozinho;
 *  - COM sinal: a etiqueta é lida (preenche só o que está vazio) e a série é conferida na empresa;
 *  - aviso de série é SÓ aviso: salvar continua liberado;
 *  - QR: etiqueta nova é guardada; QR de equipamento que já existe vira "vincular";
 *  - permissões do app: foto só câmera, marca d'água e dados do cliente escondidos são respeitados.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import { MSG_SEM_SINAL_SERIE, MSG_SEM_UNIDADE, MSG_TIPO_OBRIGATORIO } from "@/lib/tecnico/cadastro-equipamento";
import type { RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const imagem = vi.hoisted(() => ({ marca: vi.fn(async (dataUrl: string, _linhas: string[]) => dataUrl) }));
vi.mock("@/lib/imagem-cliente", () => ({
  FOTO_GALERIA: { ladoMax: 1280, qualidade: 0.8 },
  reduzirImagem: vi.fn(async (f: File) => ({ imagem: { dataUrl: `data:image/jpeg;base64,/9j/${f.name}`, largura: 10, altura: 10, bytes: 9 }, qualidade: {} })),
  aplicarMarcaDagua: imagem.marca,
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
// A câmera do QR não existe no teste: um botão "lê" o valor que o teste escolher
const qr = vi.hoisted(() => ({ valor: "" }));
vi.mock("@/components/os/scanner-qr", () => ({
  ScannerQR: ({ onLer }: { onLer: (v: string) => void }) => createElement("button", { type: "button", "data-scanner-falso": "", onClick: () => onLer(qr.valor) }, "ler"),
}));

/* ───────── dados ───────── */
const item = (id: string, texto: string) => ({ id, texto, pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 1, tipoResposta: "OK_ATENCAO_NA" as const, unidade: null });
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const info = (id: string, titulo: string, extra: Record<string, unknown> = {}) => ({ id, titulo, descricao: titulo, fabricante: "Daikin FTXS", tag: null, numeroSerie: null, local: "Sala 1", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" }, ...extra });
const CADASTRO = {
  unidadeId: "un1",
  tipos: [{ valor: "AR_CONDICIONADO_SPLIT", nome: "Split Hi-Wall", tipoEquipamentoId: "te1" }, { valor: "custom:teCam", nome: "Câmara fria", tipoEquipamentoId: "teCam" }],
  setores: ["2º andar", "Térreo"], ambientes: ["Recepção", "Sala 201"],
};
let ajustar: (r: any) => any = (r) => r;
function retrato(atividadeId = "aA"): RetratoAtividade {
  return ajustar({
    cartao: {
      atividadeId, osId: "os1", osNumero: "OS-0001", titulo: "Preventiva", tipoOs: null, status: "EM_ANDAMENTO", prioridade: "NORMAL", dataAgendada: null, dia: null, hora: "08:30", duracaoMin: 60,
      cliente: "Hospital Santa Luzia", telefone: null, unidade: "Matriz", endereco: "Av. Paulista, 1000 — São Paulo/SP", rota: null, descricao: "Preventiva mensal", equipamentos: 1, atendidos: 0, adicionais: 0,
    },
    execucao: {
      atividade: { id: atividadeId, titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "os1", numero: "OS-0001", status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: false, adicionais: [],
      equipamentos: [{ vinculoId: "v1", feito: false, observacao: null, equipamento: info("eqA", "Split Sala 1"), itens: [item("i1", "Limpeza dos filtros")], respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false }],
      conclusao: { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 1, mensagem: null },
    },
    equipamentosUnidade: [
      { ...info("eqA", "Split Sala 1"), tipoEquipamentoId: "te1", qr: null },
      { ...info("eqN", "Split do auditório", { numeroSerie: "SERIE-DA-UNIDADE-7", local: "Auditório" }), tipoEquipamentoId: "te1", qr: { tokenPublico: "tok-eqN", codigo: "QR-77" } },
    ],
    checklistsPorTipo: { te1: [item("i1", "Limpeza dos filtros")], teCam: [item("iCam", "Vedação da porta")] },
    cadastro: CADASTRO,
    geradoEm: new Date().toISOString(),
  }) as RetratoAtividade;
}

/* ───────── servidor simulado + aparelho ───────── */
let online = true;
let enviadas: any[] = [];
let pedidos: { url: string; metodo: string; corpo: any }[] = [];
let respostaSerie: unknown = { doCliente: [], outrosClientes: 0 };
let respostaEtiqueta: { status: number; corpo: unknown } = { status: 200, corpo: { legivel: true, campos: {} } };
const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "content-type": "application/json" } });
  const metodo = String(init?.method ?? "GET");
  pedidos.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
  if (url.includes("/serie?")) return json(respostaSerie);
  if (url.endsWith("/etiqueta")) return json(respostaEtiqueta.corpo, respostaEtiqueta.status);
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato(decodeURIComponent(url.split("/").pop()!)));
  if (url === "/api/tecnico/sync") {
    const { operacoes } = JSON.parse(String(init!.body));
    enviadas.push(...operacoes);
    return json({ resultados: operacoes.map((o: any) => ({ id: o.id, ok: true, status: 200, dados: {} })) });
  }
  return json({}, 404);
});

let root: Root; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync;

beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/execucao"), import("@/components/tecnico/cadastro-equipamento")]);
}, 120_000);
beforeEach(async () => {
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; enviadas = []; pedidos = []; ajustar = (r) => r; qr.valor = ""; imagem.marca.mockClear(); fetchFalso.mockClear();
  respostaSerie = { doCliente: [], outrosClientes: 0 }; respostaEtiqueta = { status: 200, corpo: { legivel: true, campos: {} } };
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  banco = await BancoTecnico.abrir("uT");
  motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online });
  window.history.replaceState(null, "", "/tecnico?ver=os&a=aA");
});
afterEach(() => {
  if (root) act(() => root.unmount());
  caixa?.remove(); document.body.innerHTML = "";
  root = undefined as unknown as Root;
  banco.fechar(); vi.unstubAllGlobals();
});

const USUARIO = { id: "uT", nome: "João Silva", email: "joao@clima.com", empresaNome: "Clima Total", podeGravar: true };
const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean, msg = "condição") {
  for (let i = 0; i < 120; i++) { if (cond()) return; await esperar(1); }
  throw new Error(`não aconteceu: ${msg}`);
}
const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  await esperar(2);
}
async function fotografar(secao: Element | null, nome: string) {
  const input = secao?.querySelector("[data-foto-input]") as HTMLInputElement | null;
  expect(input).toBeTruthy();
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array([1, 2, 3])], nome, { type: "image/jpeg", lastModified: Date.now() })] });
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}
const fila = () => banco.fila();
/** O que o técnico gravou: ainda na fila do aparelho, ou já recebido pelo servidor (com sinal, sobe na hora e sai da fila) */
async function gravadas(tipo: string): Promise<any[]> {
  const vistas = new Set<string>();
  return [...(await fila()), ...enviadas].filter((o: any) => o.tipo === tipo && !vistas.has(o.id) && vistas.add(o.id));
}
const cadastrosNaFila = () => gravadas("cadastrarEquipamento");
const modal = () => $("[data-modal-cadastro-equipamento]");
const secao = (rotulo: string) => [...(modal()?.querySelectorAll("div.space-y-2") ?? [])].find((d) => d.firstElementChild?.textContent?.startsWith(rotulo)) ?? null;

async function abrirOs(config?: any, equipamentoId?: string) {
  const { ProvedorTecnico } = await import("@/components/tecnico/contexto");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: USUARIO, config, motorPronto: motor, children: createElement(VistaOs, { atividadeId: "aA", equipamentoId }) })); });
  await esperarAte(() => !!$("[data-vista]"), "OS carregada");
  await esperar();
}
async function abrirCadastro(config?: any) {
  await abrirOs(config);
  await clicar($("[data-cadastrar-equipamento]"));
  expect(modal()).toBeTruthy();
}
const salvar = () => clicar($("[data-salvar-equipamento]"));

/* ═════════════════════════ onde aparece ═════════════════════════ */
describe("'Cadastrar novo equipamento' no passo de vincular", () => {
  it("com a permissão ligada: aparece junto de 'Ler QR Code' e 'Da lista', com alvo de toque de 44 px", async () => {
    await abrirOs();
    const b = $("[data-cadastrar-equipamento]")!;
    expect(texto(b)).toContain("Cadastrar novo equipamento");
    expect(b.className).toContain("touch-target");
    expect(texto()).toContain("Ler QR Code");
    expect(texto()).toContain("Da lista");
  });

  it("permissão DESLIGADA em Equipes › App do colaborador: o botão nem aparece (nem na lista da unidade)", async () => {
    await abrirOs({ ...CONFIG_APP_PADRAO, cadastrarEquipamento: false });
    expect($("[data-cadastrar-equipamento]")).toBeNull();
    await clicar([...document.querySelectorAll("button")].find((b) => texto(b).includes("Da lista")));
    expect($("[data-lista-unidade]")).toBeTruthy();
    expect($("[data-cadastrar-da-lista]")).toBeNull();
  });

  it("o servidor diz que a empresa não permite (cadastro nulo no retrato) ou o retrato é antigo: não aparece", async () => {
    ajustar = (r) => ({ ...r, cadastro: null });
    await abrirOs();
    expect($("[data-cadastrar-equipamento]")).toBeNull();
    act(() => root.unmount()); document.body.innerHTML = "";
    ajustar = ({ cadastro: _c, ...r }) => r;
    await abrirOs();
    expect($("[data-cadastrar-equipamento]")).toBeNull();
  });

  it("OS sem unidade definida (cliente com mais de um endereço): explica, em vez de oferecer o cadastro", async () => {
    ajustar = (r) => ({ ...r, cadastro: { ...CADASTRO, unidadeId: null } });
    await abrirOs();
    expect($("[data-cadastrar-equipamento]")).toBeNull();
    expect(texto($("[data-cadastro-sem-unidade]"))).toBe(MSG_SEM_UNIDADE);
  });

  it("atividade concluída (só leitura): não aparece", async () => {
    ajustar = (r) => ({ ...r, execucao: { ...r.execucao, bloqueada: true, atividade: { ...r.execucao.atividade, status: "CONCLUIDA" } } });
    await abrirOs();
    expect($("[data-cadastrar-equipamento]")).toBeNull();
  });

  it("na lista da unidade: 'Não está na lista? Cadastrar novo' leva ao mesmo formulário", async () => {
    await abrirOs();
    await clicar([...document.querySelectorAll("button")].find((b) => texto(b).includes("Da lista")));
    await clicar($("[data-cadastrar-da-lista]"));
    expect($("[data-lista-unidade]")).toBeNull();
    expect(modal()).toBeTruthy();
  });
});

/* ═════════════════════════ formulário ═════════════════════════ */
describe("formulário enxuto", () => {
  it("tipo: só os que já existem (sem 'criar tipo'); cliente e unidade não são pedidos; botões com 44 px", async () => {
    await abrirCadastro();
    expect([...$("[data-tipo]")!.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Escolha…", "Split Hi-Wall", "Câmara fria"]);
    expect(texto(modal())).not.toMatch(/Novo tipo|Cadastrar tipo|Cliente|Unidade \/ endereço/);
    expect(texto(modal())).toContain("Fica nesta unidade, já vinculado a esta OS.");
    for (const sel of ["[data-salvar-equipamento]", "[data-ler-qr-cadastro]"]) expect($(sel)!.className).toContain("touch-target");
    expect($$("[data-modal-cadastro-equipamento] button").filter((b) => !b.className.includes("touch-target"))).toEqual([]);
  });

  it("sem escolher o tipo: não salva e diz o que falta; nada vai para a fila", async () => {
    await abrirCadastro();
    await digitar($("[data-marca]"), "LG");
    await salvar();
    expect(texto($("[data-erro-cadastro]"))).toBe(MSG_TIPO_OBRIGATORIO);
    expect(await cadastrosNaFila()).toEqual([]);
    expect(modal()).toBeTruthy();
  });

  it("só com o tipo já salva (marca, modelo, série, capacidade, local e foto são opcionais)", async () => {
    await abrirCadastro();
    await digitar($("[data-tipo]"), "custom:teCam");
    await salvar();
    const [op] = await cadastrosNaFila();
    expect(op.dados).toEqual({ id: op.dados.id, tipo: "custom:teCam" });
    expect(op.dados.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(modal()).toBeNull();
  });

  it("sugere os setores e ambientes que já existem na unidade (sem obrigar a escolher um)", async () => {
    await abrirCadastro();
    expect($("[data-setor]")!.getAttribute("list")).toBe("cadastro-setores");
    expect([...$("#cadastro-setores")!.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value)).toEqual(["2º andar", "Térreo"]);
    expect([...$("#cadastro-ambientes")!.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value)).toEqual(["Recepção", "Sala 201"]);
  });
});

/* ═════════════════════════ sem sinal ═════════════════════════ */
describe("SEM SINAL", () => {
  async function cadastrarOffline() {
    await abrirCadastro();
    online = false;
    await digitar($("[data-tipo]"), "AR_CONDICIONADO_SPLIT");
    await fotografar(secao("Etiqueta do equipamento"), "etiqueta.jpg");
    await digitar($("[data-serie]"), "LG24K8891X");
    await digitar($("[data-marca]"), "LG");
    await digitar($("[data-modelo]"), "S4-W12JA3AA");
    await digitar($("[data-capacidade]"), "12000");
    await digitar($("[data-setor]"), "2º andar");
    await digitar($("[data-ambiente]"), "Sala 201");
    await fotografar(secao("Foto do equipamento"), "equipamento.jpg");
    await salvar();
    return (await cadastrosNaFila())[0];
  }

  it("salva na fila do aparelho com tudo o que foi preenchido — nada é enviado, nada se perde", async () => {
    const op = await cadastrarOffline();
    expect(op.estado).toBe("pendente");
    expect(op.dados).toEqual({
      id: op.dados.id, tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4-W12JA3AA", numeroSerie: "LG24K8891X", capacidade: "12000 BTU/h",
      setor: "2º andar", ambiente: "Sala 201", fotos: ["data:image/jpeg;base64,/9j/equipamento.jpg", "data:image/jpeg;base64,/9j/etiqueta.jpg"], // a do equipamento é a capa
    });
    expect(enviadas).toEqual([]);
    expect(pedidos.filter((p) => p.url.includes("/etiqueta") || p.url.includes("/serie"))).toEqual([]); // sem sinal nem tenta
  });

  it("depois de salvar, vai direto para o equipamento novo, que já está na OS com o checklist do tipo — o técnico segue nele", async () => {
    const op = await cadastrarOffline();
    expect(window.location.search).toBe(`?ver=os&a=aA&e=${op.dados.id}`);
    expect($("[data-equip-linha]") && $$("[data-equip-linha]").map((l) => l.getAttribute("data-equip-linha"))).toEqual(["eqA", op.dados.id]);
    expect(texto($(`[data-equip-linha="${op.dados.id}"]`))).toContain("Split Hi-Wall — 12.000 BTU/h");
    // abrindo a tela dele: checklist do tipo e o aviso de que ainda está no aparelho
    act(() => root.unmount()); document.body.innerHTML = "";
    await abrirOs(undefined, op.dados.id);
    expect(texto()).toContain("Split Hi-Wall — 12.000 BTU/h");
    expect(texto()).toContain("Limpeza dos filtros");
    expect(texto($("[data-equipamento-no-aparelho]"))).toBe("No aparelho: sobe sozinho quando houver sinal.");
  });

  it("fechar e abrir o app sem sinal: o cadastro continua na fila; quando o sinal volta, sobe sozinho", async () => {
    const op = await cadastrarOffline();
    act(() => root.unmount()); document.body.innerHTML = ""; banco.fechar();
    banco = await BancoTecnico.abrir("uT"); // o app foi reaberto
    motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online });
    expect((await cadastrosNaFila()).map((o) => o.dados.id)).toEqual([op.dados.id]);
    online = true;
    await motor.sincronizar();
    expect(enviadas.filter((o) => o.tipo === "cadastrarEquipamento").map((o) => o.dados)).toEqual([op.dados]);
    expect((await fila()).filter((o) => o.estado !== "enviada")).toEqual([]); // nada ficou para trás
  });

  it("a etiqueta fotografada sem sinal fica guardada e a tela pede para digitar (a leitura é só com sinal)", async () => {
    await abrirCadastro();
    online = false;
    await fotografar(secao("Etiqueta do equipamento"), "etiqueta.jpg");
    expect(texto($("[data-leitura]"))).toBe("Sem sinal: digite os dados da etiqueta.");
    expect(pedidos.some((p) => p.url.includes("/etiqueta"))).toBe(false);
    expect(secao("Etiqueta do equipamento")!.querySelector("[data-miniatura]")).toBeTruthy();
  });

  it("série: confere com o que o aparelho tem (equipamento da unidade) e diz que a conferência completa vem ao sincronizar", async () => {
    await abrirCadastro();
    online = false;
    await digitar($("[data-tipo]"), "AR_CONDICIONADO_SPLIT");
    await digitar($("[data-serie]"), " serie-da-unidade-7 ");
    const aviso = $("[data-serie-repetida]")!;
    expect(texto(aviso)).toContain("Este nº de série já existe. Confira se não é o mesmo equipamento.");
    expect(texto(aviso)).toContain("Split do auditório — Auditório");
    expect(texto(aviso)).toContain("Apenas um aviso: é possível salvar assim mesmo.");
    expect(texto($("[data-serie-sem-sinal]"))).toBe(MSG_SEM_SINAL_SERIE);
    expect(($("[data-salvar-equipamento]") as HTMLButtonElement).disabled).toBe(false); // só aviso: nunca trava
    await salvar();
    expect((await cadastrosNaFila())[0].dados.numeroSerie).toBe("serie-da-unidade-7");
  });

  it("série inédita no aparelho: sem aviso de repetição, só o lembrete de que a conferência completa vem depois", async () => {
    await abrirCadastro();
    online = false;
    await digitar($("[data-serie]"), "NUNCA-VISTA-1");
    expect($("[data-serie-repetida]")).toBeNull();
    expect(texto($("[data-serie-sem-sinal]"))).toBe(MSG_SEM_SINAL_SERIE);
    await digitar($("[data-serie]"), "AB"); // curta demais: nem lembrete
    expect($("[data-aviso-serie-campo]")).toBeNull();
  });

  it("série igual à de um cadastro que está NA FILA (feito agora há pouco, sem sinal): avisa também", async () => {
    await cadastrarOffline();
    await clicar($("[data-cadastrar-equipamento]"));
    await digitar($("[data-serie]"), "lg24k8891x");
    await esperarAte(() => !!$('[data-serie-origem="fila"]'), "aviso da fila");
    expect(texto($('[data-serie-origem="fila"]'))).toBe("Split Hi-Wall — 12.000 BTU/h · LG S4-W12JA3AA — Sala 201 · 2º andar (cadastrado neste aparelho)");
    expect(($("[data-salvar-equipamento]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("o equipamento com a mesma série já está na unidade: 'Vincular este à OS' vincula em vez de cadastrar de novo", async () => {
    await abrirCadastro();
    online = false;
    await digitar($("[data-serie]"), "SERIE-DA-UNIDADE-7");
    await clicar($('[data-vincular-existente="eqN"]'));
    expect(modal()).toBeNull();
    const ops = await fila();
    expect(ops.filter((o) => o.tipo === "vincular").map((o: any) => o.equipamentoIds)).toEqual([["eqN"]]);
    expect(ops.some((o) => o.tipo === "cadastrarEquipamento")).toBe(false);
    expect(window.location.search).toBe("?ver=os&a=aA&e=eqN");
  });
});

/* ═════════════════════════ com sinal ═════════════════════════ */
describe("COM sinal", () => {
  it("série conferida na empresa: mostra o do mesmo cliente e só a CONTAGEM de outros clientes — e salvar continua liberado", async () => {
    respostaSerie = { doCliente: [{ id: "eqZ", titulo: "Split Hi-Wall — 9.000 BTU/h", fabricante: "LG S4", local: "Matriz › Farmácia", ativo: false }], outrosClientes: 2 };
    await abrirCadastro();
    await digitar($("[data-tipo]"), "AR_CONDICIONADO_SPLIT");
    await digitar($("[data-serie]"), "ABC123XYZ");
    await esperarAte(() => !!$("[data-serie-repetida]"), "aviso do servidor");
    const pedido = pedidos.find((p) => p.url.includes("/serie?"))!;
    expect(pedido.url).toMatch(/^\/api\/tecnico\/atividades\/aA\/serie\?numero=ABC123XYZ&ignorar=[0-9a-f-]{36}$/);
    expect(texto($("[data-serie-repetida]"))).toContain("Split Hi-Wall — 9.000 BTU/h — LG S4 — Matriz › Farmácia (inativo)");
    expect(texto($("[data-serie-outro-cliente]"))).toBe("Existe em 2 equipamentos de outros clientes.");
    expect($("[data-serie-sem-sinal]")).toBeNull();
    await salvar();
    expect((await cadastrosNaFila())[0].dados.numeroSerie).toBe("ABC123XYZ");
  });

  it("série inédita na empresa: nenhum aviso", async () => {
    await abrirCadastro();
    await digitar($("[data-serie]"), "INEDITA-9");
    await esperarAte(() => pedidos.some((p) => p.url.includes("/serie?")), "consulta");
    await esperar();
    expect($("[data-aviso-serie-campo]")).toBeNull();
  });

  it("servidor fora do ar no meio da conferência: cai no lembrete de 'sem sinal', sem erro e sem travar", async () => {
    await abrirCadastro();
    respostaSerie = null;
    fetchFalso.mockImplementationOnce(async () => new Response("{}", { status: 500 }));
    await digitar($("[data-serie]"), "ABC123XYZ");
    await esperarAte(() => !!$("[data-serie-sem-sinal]"), "lembrete");
    expect(($("[data-salvar-equipamento]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("etiqueta: a foto vai para a leitura e preenche SÓ o que está vazio; o que o técnico digitou vale", async () => {
    respostaEtiqueta = { status: 200, corpo: { legivel: true, campos: { numero_serie: "LG24K8891X", marca: "LG", modelo: "S4-W12JA3AA", capacidade_valor: "12000", capacidade_unidade: "BTU/h", tipo: "AR_CONDICIONADO_SPLIT" } } };
    await abrirCadastro();
    await digitar($("[data-marca]"), "Elgin"); // já digitado: não é trocado
    await fotografar(secao("Etiqueta do equipamento"), "etiqueta.jpg");
    await esperarAte(() => !!$("[data-leitura]"), "leitura");
    const pedido = pedidos.find((p) => p.url === "/api/tecnico/atividades/aA/etiqueta")!;
    expect(pedido).toMatchObject({ metodo: "POST", corpo: { imagem: "data:image/jpeg;base64,/9j/etiqueta.jpg" } });
    expect(texto($("[data-leitura]"))).toBe("Lido da etiqueta: confira os campos.");
    expect(($("[data-serie]") as HTMLInputElement).value).toBe("LG24K8891X");
    expect(($("[data-marca]") as HTMLInputElement).value).toBe("Elgin");
    expect(($("[data-modelo]") as HTMLInputElement).value).toBe("S4-W12JA3AA");
    expect(($("[data-capacidade]") as HTMLInputElement).value).toBe("12000");
    expect(($("[data-tipo]") as HTMLSelectElement).value).toBe("AR_CONDICIONADO_SPLIT");
    expect(texto($("[data-aviso-privacidade]"))).toBe("Com sinal, a foto da etiqueta é enviada à Anthropic (IA) só para ler o texto.");
  });

  it("etiqueta ilegível ou leitura recusada: não trava — pede para digitar; a foto continua guardada", async () => {
    respostaEtiqueta = { status: 502, corpo: { erro: "A leitura automática não respondeu.", fallback: true } };
    await abrirCadastro();
    await fotografar(secao("Etiqueta do equipamento"), "etiqueta.jpg");
    await esperarAte(() => !!$("[data-leitura]"), "leitura");
    expect($("[data-leitura]")!.getAttribute("data-leitura")).toBe("aviso");
    expect(texto($("[data-leitura]"))).toBe("Não deu para ler a etiqueta: digite os dados.");
    await digitar($("[data-tipo]"), "AR_CONDICIONADO_SPLIT");
    await salvar();
    expect((await cadastrosNaFila())[0].dados.fotos).toEqual(["data:image/jpeg;base64,/9j/etiqueta.jpg"]);
  });

  it("salvar com sinal: sobe pela mesma fila (iniciar não é necessário aqui) e o servidor recebe o cadastro", async () => {
    await abrirCadastro();
    await digitar($("[data-tipo]"), "AR_CONDICIONADO_SPLIT");
    await salvar();
    await esperarAte(() => enviadas.some((o) => o.tipo === "cadastrarEquipamento"), "envio");
    expect(enviadas.filter((o) => o.tipo === "cadastrarEquipamento")).toHaveLength(1);
  });
});

/* ═════════════════════════ QR ═════════════════════════ */
describe("QR Code no cadastro", () => {
  it("sem etiqueta: diz que o número é gerado ao salvar (nada de QR vai na gravação)", async () => {
    await abrirCadastro();
    expect(texto($("[data-qr-cadastro]"))).toContain("Sem etiqueta? O número do QR é gerado ao salvar.");
    await digitar($("[data-tipo]"), "AR_CONDICIONADO_SPLIT");
    await salvar();
    expect("qrLido" in (await cadastrosNaFila())[0].dados).toBe(false);
  });

  it("etiqueta QR nova lida no equipamento: fica guardada e vai junto no cadastro; dá para descartar", async () => {
    await abrirCadastro();
    qr.valor = "https://app.frivo.com.br/qr/tok-etiqueta-avulsa ";
    await clicar($("[data-ler-qr-cadastro]"));
    await clicar($("[data-scanner-falso]"));
    expect(texto($("[data-qr-lido]"))).toContain("Etiqueta QR lida.");
    await digitar($("[data-tipo]"), "AR_CONDICIONADO_SPLIT");
    await salvar();
    expect((await cadastrosNaFila())[0].dados.qrLido).toBe("https://app.frivo.com.br/qr/tok-etiqueta-avulsa");
  });

  it("o QR lido já é de um equipamento da unidade: avisa qual e oferece VINCULAR — não cadastra em duplicidade", async () => {
    await abrirCadastro();
    qr.valor = "QR-77";
    await clicar($("[data-ler-qr-cadastro]"));
    await clicar($("[data-scanner-falso]"));
    expect($("[data-qr-lido]")).toBeNull();
    expect(texto($("[data-qr-de-outro]"))).toContain("Este QR já é de Split do auditório.");
    await clicar($("[data-qr-de-outro] button"));
    expect((await gravadas("vincular")).map((o: any) => o.equipamentoIds)).toEqual([["eqN"]]);
    expect(await gravadas("cadastrarEquipamento")).toEqual([]);
  });
});

/* ═════════════════════════ permissões do app ═════════════════════════ */
describe("respeita as permissões do app do colaborador", () => {
  it("'Foto somente pela câmera' ligado: as duas fotos do cadastro só abrem a câmera e recusam arquivo antigo", async () => {
    await abrirCadastro({ ...CONFIG_APP_PADRAO, fotoSomenteCamera: true });
    const inputs = $$("[data-modal-cadastro-equipamento] [data-foto-input]") as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => [i.getAttribute("capture"), i.hasAttribute("data-somente-camera")])).toEqual([["environment", true], ["environment", true]]);
    const antigo = secao("Foto do equipamento")!.querySelector("[data-foto-input]") as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(antigo, "files", { configurable: true, value: [new File([new Uint8Array([1])], "galeria.jpg", { type: "image/jpeg", lastModified: Date.now() - 86_400_000 })] });
      antigo.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperar();
    expect($("[data-erro-foto]")).toBeTruthy();
    expect(secao("Foto do equipamento")!.querySelector("[data-miniatura]")).toBeNull();
  });

  it("desligado: sem `capture`, a galeria continua permitida", async () => {
    await abrirCadastro();
    expect(($$("[data-modal-cadastro-equipamento] [data-foto-input]") as HTMLInputElement[]).map((i) => i.getAttribute("capture"))).toEqual([null, null]);
  });

  it("marca d'água ligada: as fotos do cadastro são carimbadas (data/hora + OS); desligada: não", async () => {
    await abrirCadastro();
    await fotografar(secao("Foto do equipamento"), "equipamento.jpg");
    expect(imagem.marca).toHaveBeenCalledTimes(1);
    expect(imagem.marca.mock.calls[0][1].some((l: string) => l === "OS OS-0001")).toBe(true);
    act(() => root.unmount()); document.body.innerHTML = ""; imagem.marca.mockClear();
    await abrirCadastro({ ...CONFIG_APP_PADRAO, marcaDagua: false });
    await fotografar(secao("Foto do equipamento"), "equipamento.jpg");
    expect(imagem.marca).not.toHaveBeenCalled();
  });

  it("'Exibir dados do cliente' desligado: o formulário não mostra nome de cliente, unidade nem endereço", async () => {
    await abrirCadastro({ ...CONFIG_APP_PADRAO, exibirDadosCliente: false });
    expect(texto(modal())).not.toMatch(/Hospital|Santa Luzia|Matriz|Paulista/);
    await digitar($("[data-serie]"), "SERIE-DA-UNIDADE-7"); // o aviso de série local também não leva o nome da unidade
    expect(texto($("[data-serie-repetida]"))).not.toMatch(/Hospital|Matriz|Paulista/);
  });
});
