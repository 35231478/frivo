// @vitest-environment happy-dom
/**
 * Padronização — leva 2, nas telas (DOM real): "editar no contexto" ligado na OS e no orçamento.
 *
 * REFERÊNCIA (cadastro-mãe — "Editando o cadastro do …", vale em todo lugar):
 *  - cliente (telefone, celular, e-mail + contatos), unidade, equipamento e contato, com os valores
 *    buscados ao abrir, só o que mudou no PATCH, toast, link do cadastro completo e RBAC no lápis.
 * USO (a linha — "Editando este item …", vale só ali):
 *  - linha da OS e linha do orçamento: descrição, quantidade e preço aplicado naquele documento; o
 *    catálogo não é chamado; número à brasileira; erro de digitação não vira zero.
 * TRAVA: registro fechado e linha que não se edita viram cadeado desabilitado, com o motivo no ⓘ; em
 *  registro fechado não há lixeira nem "novo item".
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import {
  situacaoDaOs, TRAVA_APROVADO, TRAVA_ASSINADA, TRAVA_CONCLUIDA, TRAVA_FATURADO, TRAVA_LINHA_DO_ORCAMENTO, TRAVA_LINHA_EXECUTADA, TRAVA_LINHA_PECA, TRAVA_NOTA,
  TRAVA_ORCAMENTO_ENVIADO,
} from "@/lib/edicao-contexto";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => {
  const real = await original<typeof import("@/components/ui/avisos")>();
  return { ...real, toast: vi.fn(real.toast) };
});

const RAIZ = path.resolve(__dirname, "../..");
const fonte = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");
let root: Root, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
/** Opera OS e orçamento, mas só VÊ clientes e equipamentos */
const SO_OPERA = montarPermissoes({ ordens: ["visualizar", "criar", "editar"], orcamentos: ["visualizar", "editar"], clientes: ["visualizar"], equipamentos: ["visualizar"] });
/** Só vê tudo */
const SO_VE = montarPermissoes({ ordens: ["visualizar"], orcamentos: ["visualizar"], clientes: ["visualizar"], equipamentos: ["visualizar"] });

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = <T extends Element = HTMLElement>(sel: string, dentro: ParentNode = document) => dentro.querySelector(sel) as T | null;
const $$ = (sel: string, dentro: ParentNode = document) => [...dentro.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (t: string, dentro: ParentNode = document) => [...dentro.querySelectorAll("button")].filter((b) => txt(b) === t).at(-1);
async function digitar(el: Element | null | undefined, v: string) {
  expect(el, "campo a preencher").toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function montar(el: ReactElement, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { Avisos } = await import("@/components/ui/avisos");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: [createElement("div", { key: "tela" }, el), createElement(Avisos, { key: "avisos" })] })); });
  await esperar();
}
const desmontar = () => { act(() => root.unmount()); caixa.remove(); };
const painel = () => $$('[role="dialog"]').at(-1) ?? null;
const tituloDoPainel = () => txt(painel()?.querySelector("h3"));
const campo = (rotulo: string) => {
  const l = [...(painel()?.querySelectorAll("label") ?? [])].find((x) => txt(x.querySelector("span")).replace(/ \*$/, "") === rotulo);
  return (l?.querySelector("input, textarea, select") ?? null) as HTMLInputElement | null;
};
const rotulosDosCampos = () => [...(painel()?.querySelectorAll("label > span") ?? [])].map((s) => txt(s).replace(/ \*$/, ""));
const salvar = () => clicar(botao("SalvarSalvar", painel()!));
const dica = (rotulo: string, dentro: ParentNode = document) => {
  const b = $$("[data-dica]", dentro).find((d) => d.getAttribute("aria-label") === `Ajuda: ${rotulo}`);
  return b ? txt(document.getElementById(b.getAttribute("aria-describedby")!)) : null;
};
const toasts = async () => vi.mocked((await import("@/components/ui/avisos")).toast).mock.calls.map((c) => c[0]);
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET");

beforeAll(async () => {
  await Promise.all([
    import("@/components/ui/select-cadastro-rapido"), import("@/components/cadastro-rapido/definicoes"), import("@/components/os/os-orcamento"),
    import("@/components/orcamento/editar-linha-orcamento"), import("@/components/orcamento/orcamento-documento"), import("@/components/os/central/resumo-os"),
    import("@/components/providers/permissoes-provider"),
  ]);
}, 120_000);
beforeEach(async () => {
  chamadas.length = 0; respostas = {}; nav.push.mockClear(); nav.refresh.mockClear();
  vi.mocked((await import("@/components/ui/avisos")).toast).mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: metodo === "GET" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

/* ═════════ O componente da leva 1, com o que a leva 2 precisou ═════════ */
describe("painel de edição: valores buscados ao abrir, seção extra e ação secundária", () => {
  const CAMPOS = [{ nome: "telefone", label: "Telefone" }, { nome: "email", label: "E-mail" }];
  it("com `carregar`: 'Carregando…' até o cadastro chegar; depois abre com os valores e só manda o que mudou", async () => {
    const { EdicaoNoContextoModal } = await import("@/components/ui/select-cadastro-rapido");
    let soltar!: (v: Record<string, string>) => void;
    const salvarFn = vi.fn(async () => {});
    await montar(createElement(EdicaoNoContextoModal, {
      aberto: true, onFechar: () => {}, escopo: "referencia", alvo: "do cliente", campos: CAMPOS, valores: {}, salvar: salvarFn, onSalvo: () => {},
      carregar: () => new Promise<Record<string, string>>((r) => { soltar = r; }),
    }));
    expect(tituloDoPainel()).toBe("Editando o cadastro do cliente");
    expect(txt($("[data-edicao-carregando]", painel()!))).toContain("Carregando…");
    // a faixa já diz até onde a mudança chega, mesmo antes de os campos aparecerem
    expect(txt($("[data-alcance-edicao]", painel()!))).toBe("Vale em todo lugar onde este cadastro é usado.");
    expect(painel()!.querySelectorAll("input")).toHaveLength(0);
    await act(async () => { soltar({ telefone: "(11) 3333-0000", email: "a@x.com" }); });
    await esperar();
    expect([campo("Telefone")!.value, campo("E-mail")!.value]).toEqual(["(11) 3333-0000", "a@x.com"]);
    await digitar(campo("Telefone"), "(11) 4444-1111");
    await salvar();
    expect(salvarFn).toHaveBeenCalledWith({ telefone: "(11) 4444-1111", email: "a@x.com" }, ["telefone"]);
  });

  it("falha ao buscar: a mensagem aparece, nenhum campo abre e dá para fechar", async () => {
    const { EdicaoNoContextoModal } = await import("@/components/ui/select-cadastro-rapido");
    const fechar = vi.fn(), salvarFn = vi.fn();
    await montar(createElement(EdicaoNoContextoModal, {
      aberto: true, onFechar: fechar, escopo: "referencia", alvo: "do cliente", campos: CAMPOS, valores: {}, salvar: salvarFn, onSalvo: () => {},
      carregar: () => Promise.reject(new Error("Sem permissão")),
    }));
    expect(txt($('[role="alert"]', painel()!))).toBe("Sem permissão");
    expect(painel()!.querySelectorAll("input")).toHaveLength(0);
    await clicar(botao("Fechar", painel()!));
    expect(fechar).toHaveBeenCalledTimes(1);
    expect(salvarFn).not.toHaveBeenCalled();
  });

  it("seção extra abaixo dos campos; ação secundária no lugar do link quando não há cadastro completo", async () => {
    const { EdicaoNoContextoModal } = await import("@/components/ui/select-cadastro-rapido");
    const acao = vi.fn();
    await montar(createElement(EdicaoNoContextoModal, {
      aberto: true, onFechar: () => {}, escopo: "uso", alvo: "este item da OS", campos: CAMPOS, valores: { telefone: "1", email: "" }, salvar: vi.fn(), onSalvo: () => {},
      extra: createElement("p", { "data-meu-extra": true }, "Contatos"), acaoSecundaria: { rotulo: "Materiais e peças deste item", onClick: acao },
    }));
    expect(txt($("[data-extra-edicao] [data-meu-extra]", painel()!))).toBe("Contatos");
    const b = $("[data-acao-secundaria]", painel()!) as HTMLButtonElement;
    expect([txt(b), b.type]).toEqual(["Materiais e peças deste item", "button"]);
    await clicar(b);
    expect(acao).toHaveBeenCalledTimes(1);
    expect(painel()!.querySelector("a")).toBeNull();
  });

  it("faixa avulsa: com rótulo, diz o que se edita e até onde vale (uso × referência)", async () => {
    const { FaixaDaEdicao } = await import("@/components/ui/select-cadastro-rapido");
    await montar(createElement("div", null,
      createElement("div", { "data-a": true }, createElement(FaixaDaEdicao, { escopo: "uso", rotulo: "Editando este item da OS" })),
      createElement("div", { "data-b": true }, createElement(FaixaDaEdicao, { escopo: "referencia" }))));
    expect(txt($("[data-a] [data-faixa-edicao='uso']"))).toBe("Editando este item da OS. Vale só aqui. O cadastro não muda.");
    expect(txt($("[data-b] [data-faixa-edicao='referencia']"))).toBe("Vale em todo lugar onde este cadastro é usado.");
  });
});

describe("lápis avulso (EditarNoContexto): onde não há seletor", () => {
  const edicao = (extra: Record<string, unknown> = {}) => ({
    escopo: "uso" as const, alvo: "este item da OS", campos: [{ nome: "descricao", label: "Descrição" }], valores: () => ({ descricao: "Visita" }),
    salvar: vi.fn(async () => {}), permissao: { modulo: "ordens", acao: "editar" as const }, ...extra,
  });
  it("com permissão: lápis que abre o painel; sem ela, nada aparece (nem cadeado)", async () => {
    const { EditarNoContexto } = await import("@/components/ui/select-cadastro-rapido");
    await montar(createElement(EditarNoContexto, { id: "i1", rotulo: "Editar Visita", edicao: edicao() }));
    const b = $("[data-editar-no-contexto]") as HTMLButtonElement;
    expect([b.getAttribute("aria-label"), b.disabled, b.type]).toEqual(["Editar Visita", false, "button"]);
    expect(painel()).toBeNull();
    await clicar(b);
    expect(tituloDoPainel()).toBe("Editando este item da OS");
    desmontar();
    await montar(createElement(EditarNoContexto, { id: "i1", rotulo: "Editar Visita", edicao: edicao() }), SO_VE);
    expect($("[data-editar-no-contexto]")).toBeNull();
    desmontar();
    await montar(createElement(EditarNoContexto, { id: "i1", rotulo: "Editar Visita", edicao: edicao({ travado: TRAVA_CONCLUIDA }) }), SO_VE);
    expect($("[data-editar-no-contexto]")).toBeNull();
  });

  it("registro fechado: cadeado desabilitado com o motivo no ⓘ, e o painel não existe", async () => {
    const { EditarNoContexto } = await import("@/components/ui/select-cadastro-rapido");
    const e = edicao({ travado: TRAVA_FATURADO });
    await montar(createElement(EditarNoContexto, { id: "i1", rotulo: "Editar Visita", edicao: e }));
    const b = $("[data-editar-no-contexto]") as HTMLButtonElement;
    expect([b.disabled, b.getAttribute("aria-label")]).toEqual([true, "Editar Visita: edição travada"]);
    expect(dica("Edição travada")).toBe(TRAVA_FATURADO);
    await clicar(b);
    expect(painel()).toBeNull();
    expect(e.salvar).not.toHaveBeenCalled();
  });

  it("na lista é compacto (sem moldura); ao lado de um campo, com a moldura do campo", async () => {
    const { EditarNoContexto } = await import("@/components/ui/select-cadastro-rapido");
    await montar(createElement("div", null,
      createElement("span", { "data-lista": true }, createElement(EditarNoContexto, { id: "i1", rotulo: "A", edicao: edicao() })),
      createElement("span", { "data-campo": true }, createElement(EditarNoContexto, { id: "i1", rotulo: "B", edicao: edicao(), comMoldura: true }))));
    expect($("[data-lista] [data-editar-no-contexto]")!.className).not.toContain("border-surface-campo");
    expect($("[data-campo] [data-editar-no-contexto]")!.className).toContain("border-surface-campo");
  });
});

/* ═════════ REFERÊNCIA ═════════ */
describe("referência: cliente (telefone, e-mail e contatos) de dentro da OS e do orçamento", () => {
  const CLI = { id: "c1", nome: "Hospital Santa Luzia Ltda", telefone: "(11) 3333-0000", celular: null, email: "contato@hospital.com.br", cpfCnpj: "22.101.333/0001-11" };
  const CT1 = { id: "ct1", nome: "Marta Lima", cargo: "Compras", telefone: "(11) 98888-0000", email: "marta@hospital.com.br", principal: true };
  async function abrirCliente(opcoes: Record<string, unknown> = {}, permissoes?: Permissoes) {
    respostas["GET /api/clientes/c1/contatos"] = { status: 200, corpo: [CT1] };
    respostas["GET /api/clientes/c1"] = { status: 200, corpo: CLI };
    const { EditarNoContexto } = await import("@/components/ui/select-cadastro-rapido");
    const { CLIENTE } = await import("@/components/cadastro-rapido/definicoes");
    await montar(createElement(EditarNoContexto, { id: "c1", rotulo: "Editar o cadastro do cliente", edicao: CLIENTE.edicao(opcoes) }), permissoes);
    if ($("[data-editar-no-contexto]")) await clicar($("[data-editar-no-contexto]"));
  }

  it("o painel diz 'Editando o cadastro do cliente', busca o cadastro e abre só com telefone, celular e e-mail", async () => {
    await abrirCliente();
    expect(tituloDoPainel()).toBe("Editando o cadastro do cliente");
    expect($("[data-faixa-edicao]", painel()!)!.getAttribute("data-faixa-edicao")).toBe("referencia");
    expect(txt($("[data-alcance-edicao]", painel()!))).toBe("Vale em todo lugar onde este cadastro é usado.");
    expect(rotulosDosCampos()).toEqual(["Telefone", "Celular", "E-mail"]);
    expect([campo("Telefone")!.value, campo("Celular")!.value, campo("E-mail")!.value]).toEqual(["(11) 3333-0000", "", "contato@hospital.com.br"]);
    // edição mais a fundo: o cadastro completo, em outra aba
    const link = [...painel()!.querySelectorAll("a")].find((a) => txt(a) === "Abrir cadastro completo")!;
    expect([link.getAttribute("href"), link.getAttribute("target")]).toEqual(["/clientes/c1/editar", "_blank"]);
    expect(chamadas.some((c) => c.url === "/api/clientes/c1" && c.metodo === "GET")).toBe(true);
  });

  it("corrigir o telefone: PATCH só do que mudou, toast 'Cliente atualizado.' e a tela é avisada", async () => {
    const aoSalvar = vi.fn();
    await abrirCliente({ aoSalvar });
    respostas["PATCH /api/clientes/c1"] = { status: 200, corpo: { ...CLI, telefone: "(11) 4444-1111" } };
    await digitar(campo("Telefone"), "(11) 4444-1111");
    await salvar();
    expect(gravacoes()).toEqual([{ url: "/api/clientes/c1", metodo: "PATCH", corpo: { telefone: "(11) 4444-1111" } }]);
    expect(await toasts()).toEqual(["Cliente atualizado."]);
    expect(aoSalvar).toHaveBeenCalledWith(expect.objectContaining({ id: "c1", telefone: "(11) 4444-1111" }));
    expect(painel()).toBeNull();
  });

  it("nada mudou: fecha sem gravar; recusa do servidor: mensagem no painel, sem toast", async () => {
    await abrirCliente();
    await salvar();
    expect(gravacoes()).toEqual([]);
    expect(painel()).toBeNull();
    await clicar($("[data-editar-no-contexto]"));
    respostas["PATCH /api/clientes/c1"] = { status: 400, corpo: { erro: "E-mail inválido" } };
    await digitar(campo("E-mail"), "errado");
    await salvar();
    expect(txt(painel())).toContain("E-mail inválido");
    expect(await toasts()).toEqual([]);
  });

  it("sem nenhum retorno da tela (o caso da OS): o salvar CHAMA o servidor do mesmo jeito — nunca avisa sem gravar", async () => {
    await abrirCliente();
    respostas["PATCH /api/clientes/c1"] = { status: 200, corpo: { ...CLI, celular: "(11) 97777-0000" } };
    await digitar(campo("Celular"), "(11) 97777-0000");
    await salvar();
    expect(gravacoes()).toEqual([{ url: "/api/clientes/c1", metodo: "PATCH", corpo: { celular: "(11) 97777-0000" } }]);
    expect(await toasts()).toEqual(["Cliente atualizado."]);
  });

  it("contatos: lista no mesmo painel; adicionar manda só o preenchido; editar manda só o que mudou; a tela é avisada", async () => {
    const aoMudarContatos = vi.fn();
    await abrirCliente({ aoMudarContatos });
    const secao = $("[data-contatos-no-contexto]", painel()!)!;
    expect($$("[data-contato]", secao).map(txt)).toEqual(["Marta Lima · Compras(11) 98888-0000 · marta@hospital.com.br"]);
    // adicionar
    await clicar($("[data-novo-contato]", secao));
    expect(txt($("[data-form-contato] p", secao))).toBe("Novo contato");
    await digitar($("[aria-label='Nome do contato']", secao), "Paulo Souza");
    await digitar($("[aria-label='Telefone do contato']", secao), "(11) 91111-2222");
    respostas["POST /api/clientes/c1/contatos"] = { status: 201, corpo: { id: "ct2", nome: "Paulo Souza", cargo: null, telefone: "(11) 91111-2222", email: null } };
    await clicar($("[data-salvar-contato]", secao));
    expect(gravacoes()).toEqual([{ url: "/api/clientes/c1/contatos", metodo: "POST", corpo: { nome: "Paulo Souza", telefone: "(11) 91111-2222" } }]);
    expect($$("[data-contato]", secao).map((c) => c.getAttribute("data-contato"))).toEqual(["ct1", "ct2"]);
    // editar a Marta: só o cargo
    await clicar($("button[aria-label='Editar o contato Marta Lima']", secao));
    expect(txt($("[data-form-contato] p", secao))).toBe("Editar contato");
    expect(($("[aria-label='E-mail do contato']", secao) as HTMLInputElement).value).toBe("marta@hospital.com.br");
    await digitar($("[aria-label='Cargo']", secao), "Diretoria");
    respostas["PATCH /api/clientes/c1/contatos/ct1"] = { status: 200, corpo: { ...CT1, cargo: "Diretoria" } };
    await clicar($("[data-salvar-contato]", secao));
    expect(gravacoes().at(-1)).toEqual({ url: "/api/clientes/c1/contatos/ct1", metodo: "PATCH", corpo: { cargo: "Diretoria" } });
    expect(txt($("[data-contato='ct1']", secao))).toContain("Marta Lima · Diretoria");
    expect(await toasts()).toEqual(["Contato adicionado.", "Contato atualizado."]);
    expect(aoMudarContatos).toHaveBeenCalledTimes(2);
    // o cadastro do cliente em volta não foi gravado por causa dos contatos, e o painel continua aberto
    expect(gravacoes().some((c) => c.url === "/api/clientes/c1")).toBe(false);
    expect(tituloDoPainel()).toBe("Editando o cadastro do cliente");
  });

  it("contato: nome obrigatório; nada mudou não chama o servidor; Enter grava o contato, não o cliente", async () => {
    await abrirCliente();
    const secao = $("[data-contatos-no-contexto]", painel()!)!;
    await clicar($("[data-novo-contato]", secao));
    await clicar($("[data-salvar-contato]", secao));
    expect(txt($('[role="alert"]', secao))).toBe("Informe o nome do contato.");
    expect(gravacoes()).toEqual([]);
    await clicar(botao("Cancelar", $("[data-form-contato]", secao)!));
    await clicar($("button[aria-label='Editar o contato Marta Lima']", secao));
    await clicar($("[data-salvar-contato]", secao));
    expect(gravacoes()).toEqual([]);
    expect($("[data-form-contato]", secao)).toBeNull();
    // Enter dentro do contato
    await clicar($("button[aria-label='Editar o contato Marta Lima']", secao));
    await digitar($("[aria-label='Cargo']", secao), "Financeiro");
    respostas["PATCH /api/clientes/c1/contatos/ct1"] = { status: 200, corpo: { ...CT1, cargo: "Financeiro" } };
    await act(async () => { $("[aria-label='Cargo']", secao)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await esperar();
    expect(gravacoes().map((c) => c.url)).toEqual(["/api/clientes/c1/contatos/ct1"]);
  });

  it("RBAC: quem só vê clientes não tem o lápis (nem o cadastro é buscado)", async () => {
    await abrirCliente({}, SO_OPERA);
    expect($("[data-editar-no-contexto]")).toBeNull();
    expect(painel()).toBeNull();
    expect(chamadas).toEqual([]);
  });
});

describe("referência: unidade, equipamento e contato", () => {
  async function abrir(edicao: any, id: string, permissoes?: Permissoes) {
    const { EditarNoContexto } = await import("@/components/ui/select-cadastro-rapido");
    await montar(createElement(EditarNoContexto, { id, rotulo: "Editar", edicao }), permissoes);
    if ($("[data-editar-no-contexto]")) await clicar($("[data-editar-no-contexto]"));
  }

  it("unidade: 'Editando o cadastro da unidade', nome e endereço; PATCH só do que mudou; a tela recebe a unidade nova", async () => {
    const UN = { id: "un1", nome: "Matriz", cep: "01310-100", logradouro: "Av. Paulista", numero: "1000", complemento: null, bairro: null, cidade: "São Paulo", estado: "SP", clienteId: "c1" };
    respostas["GET /api/unidades/un1"] = { status: 200, corpo: UN };
    respostas["PATCH /api/unidades/un1"] = { status: 200, corpo: { ...UN, numero: "1578", bairro: "Bela Vista" } };
    const { UNIDADE } = await import("@/components/cadastro-rapido/definicoes");
    const aoSalvar = vi.fn();
    await abrir(UNIDADE.edicao("c1", aoSalvar), "un1");
    expect(tituloDoPainel()).toBe("Editando o cadastro da unidade");
    expect($("[data-faixa-edicao]", painel()!)!.getAttribute("data-faixa-edicao")).toBe("referencia");
    expect(rotulosDosCampos()).toEqual(["Nome do local", "CEP", "Endereço", "Número", "Complemento", "Bairro", "Cidade", "UF"]);
    expect([campo("Nome do local")!.value, campo("Número")!.value, (campo("UF") as unknown as HTMLSelectElement).value]).toEqual(["Matriz", "1000", "SP"]);
    expect([...painel()!.querySelectorAll("a")].find((a) => txt(a) === "Abrir cadastro completo")!.getAttribute("href")).toBe("/clientes/c1/editar");
    await digitar(campo("Número"), "1578");
    await digitar(campo("Bairro"), "Bela Vista");
    await salvar();
    expect(gravacoes()).toEqual([{ url: "/api/unidades/un1", metodo: "PATCH", corpo: { numero: "1578", bairro: "Bela Vista" } }]);
    expect(aoSalvar).toHaveBeenCalledWith(expect.objectContaining({ id: "un1", numero: "1578" }));
    expect(await toasts()).toEqual(["Unidade atualizada."]);
    desmontar();
    // unidade é endereço do cliente: quem só vê clientes não edita
    await abrir(UNIDADE.edicao("c1", aoSalvar), "un1", SO_OPERA);
    expect($("[data-editar-no-contexto]")).toBeNull();
  });

  it("equipamento: 'Editando o cadastro do equipamento', identificação; a permissão é a de Equipamentos › editar", async () => {
    const EQ = { id: "eq1", nome: null, marca: "LG", modelo: "Dual Inverter", numeroSerie: "SN-001", patrimonio: null, localizacao: "Recepção", tipo: "AR_CONDICIONADO_SPLIT", capacidade: "12000" };
    respostas["GET /api/equipamentos/eq1"] = { status: 200, corpo: EQ };
    respostas["PATCH /api/equipamentos/eq1"] = { status: 200, corpo: { ...EQ, numeroSerie: "SN-002" } };
    const { EQUIPAMENTO } = await import("@/components/cadastro-rapido/definicoes");
    const aoSalvar = vi.fn();
    await abrir(EQUIPAMENTO.edicao(aoSalvar), "eq1");
    expect(tituloDoPainel()).toBe("Editando o cadastro do equipamento");
    expect(rotulosDosCampos()).toEqual(["Identificação", "Marca", "Modelo", "Nº de série", "Patrimônio", "Ambiente"]);
    expect([campo("Marca")!.value, campo("Nº de série")!.value, campo("Ambiente")!.value]).toEqual(["LG", "SN-001", "Recepção"]);
    expect([...painel()!.querySelectorAll("a")].find((a) => txt(a) === "Abrir cadastro completo")!.getAttribute("href")).toBe("/equipamentos/eq1");
    await digitar(campo("Nº de série"), "SN-002");
    await salvar();
    expect(gravacoes()).toEqual([{ url: "/api/equipamentos/eq1", metodo: "PATCH", corpo: { numeroSerie: "SN-002" } }]);
    expect(aoSalvar).toHaveBeenCalledWith(expect.objectContaining({ id: "eq1", numeroSerie: "SN-002" }));
    expect(await toasts()).toEqual(["Equipamento atualizado."]);
    // marca é obrigatória: vazia não sai da tela
    await clicar($("[data-editar-no-contexto]"));
    await digitar(campo("Marca"), "");
    await salvar();
    expect(txt(painel())).toContain("Preencha os campos obrigatórios.");
    expect(gravacoes()).toHaveLength(1);
    desmontar();
    // quem edita clientes mas só vê equipamentos não tem o lápis
    await abrir(EQUIPAMENTO.edicao(aoSalvar), "eq1", montarPermissoes({ clientes: ["visualizar", "editar"], equipamentos: ["visualizar"], ordens: ["visualizar", "editar"] }));
    expect($("[data-editar-no-contexto]")).toBeNull();
  });

  it("contato A/C do orçamento: 'Editando o cadastro do contato'; PATCH só do que mudou", async () => {
    const CT = { id: "ct1", nome: "Marta Lima", cargo: "Compras", telefone: null, email: "marta@hospital.com.br" };
    respostas["GET /api/clientes/c1/contatos"] = { status: 200, corpo: [CT] };
    respostas["PATCH /api/clientes/c1/contatos/ct1"] = { status: 200, corpo: { ...CT, telefone: "(11) 95555-1234" } };
    const { CONTATO } = await import("@/components/cadastro-rapido/definicoes");
    const aoSalvar = vi.fn();
    await abrir(CONTATO.edicao("c1", [CT], aoSalvar), "ct1");
    expect(tituloDoPainel()).toBe("Editando o cadastro do contato");
    expect(rotulosDosCampos()).toEqual(["Nome", "Cargo", "Telefone", "E-mail"]);
    expect([campo("Nome")!.value, campo("Cargo")!.value]).toEqual(["Marta Lima", "Compras"]);
    await digitar(campo("Telefone"), "(11) 95555-1234");
    await salvar();
    expect(gravacoes()).toEqual([{ url: "/api/clientes/c1/contatos/ct1", metodo: "PATCH", corpo: { telefone: "(11) 95555-1234" } }]);
    expect(aoSalvar).toHaveBeenCalledWith(expect.objectContaining({ telefone: "(11) 95555-1234" }));
    expect(await toasts()).toEqual(["Contato atualizado."]);
  });
});

/* ═════════ USO + TRAVA: os itens da OS ═════════ */
const MAT = { id: "m1", produtoId: "tubo", descricao: "Tubo de cobre", unidade: "m", comportamento: "INCLUSO_NO_SERVICO", quantidade: 5, quantidadePadrao: 3, valorVendaUnit: 20, custoUnit: 12, origem: "KIT", kitNome: "Kit", quantidadeSeparada: 0 };
const SERVICO = { id: "i1", tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 840, valorTotal: 840, valorBase: 800, ajusteMateriais: 40, valorManual: false, executado: false, materiais: [MAT] };
const PECA = { id: "i2", tipo: "PRODUTO", produtoId: "cap", descricao: "Capacitor 35uF", quantidade: 1, valorUnitario: 80, valorTotal: 80, executado: false, materialId: "m9", material: { osItemId: "i1" } };
const LIVRE = { id: "i3", tipo: "SERVICO", descricao: "Visita técnica", quantidade: 2, valorUnitario: 100, valorTotal: 200, executado: false };
const PRODUTO = { id: "i4", tipo: "PRODUTO", produtoId: "fita", descricao: "Fita", quantidade: 3, valorUnitario: 15, valorTotal: 45, executado: false };

describe("uso: 'Editando este item da OS'", () => {
  async function abrirItens(itens: unknown[] = [SERVICO, PECA, LIVRE, PRODUTO], situacao: any = situacaoDaOs({ status: "EM_ANDAMENTO" }), permissoes?: Permissoes) {
    const { OsOrcamento } = await import("@/components/os/os-orcamento");
    await montar(createElement(OsOrcamento as any, { osId: "os1", itens, clienteId: "c1", situacao }), permissoes);
    await esperar();
    chamadas.length = 0;
  }
  const linha = (id: string) => $(`[data-item-os='${id}']`)!;
  const lapisDa = (id: string) => $("[data-editar-no-contexto]", linha(id)) as HTMLButtonElement | null;

  it("o lápis da linha abre o painel de USO: rótulo 'Editando este item da OS', vale só aqui, com os valores da linha", async () => {
    await abrirItens();
    await clicar(lapisDa("i3"));
    expect(tituloDoPainel()).toBe("Editando este item da OS");
    const faixa = $("[data-faixa-edicao]", painel()!)!;
    expect([faixa.getAttribute("data-faixa-edicao"), txt(faixa)]).toEqual(["uso", "Vale só aqui. O cadastro não muda."]);
    expect(rotulosDosCampos()).toEqual(["Descrição", "Quantidade", "Valor unitário (R$)"]);
    expect([campo("Descrição")!.value, campo("Quantidade")!.value, campo("Valor unitário (R$)")!.value]).toEqual(["Visita técnica", "2", "100,00"]);
    // nada de link para o catálogo: o item é uso
    expect(painel()!.querySelector("a")).toBeNull();
    expect(txt(painel())).not.toContain("cadastro completo");
  });

  it("salvar: PATCH na linha só com o que mudou, número à brasileira; toast; a linha mostra o que o servidor gravou", async () => {
    await abrirItens();
    await clicar(lapisDa("i3"));
    await digitar(campo("Quantidade"), "3");
    await digitar(campo("Valor unitário (R$)"), "1.250,50");
    respostas["PATCH /api/ordens/os1/orcamento/i3"] = { status: 200, corpo: { ...LIVRE, quantidade: 3, valorUnitario: 1250.5, valorTotal: 3751.5 } };
    await salvar();
    expect(gravacoes()).toEqual([{ url: "/api/ordens/os1/orcamento/i3", metodo: "PATCH", corpo: { quantidade: 3, valorUnitario: 1250.5 } }]);
    expect(await toasts()).toEqual(["Item da OS atualizado."]);
    expect(painel()).toBeNull();
    expect(txt($("[data-total-item]", linha("i3")))).toMatch(/R\$\s?3\.751,50/);
    // o catálogo nunca é chamado pela edição da linha
    expect(chamadas.some((c) => /\/api\/(servicos|produtos|cadastros)/.test(c.url))).toBe(false);
  });

  it("só a descrição: manda só a descrição; nada mudou: não chama o servidor", async () => {
    await abrirItens();
    await clicar(lapisDa("i4"));
    await digitar(campo("Descrição"), "Fita isolante 19mm");
    respostas["PATCH /api/ordens/os1/orcamento/i4"] = { status: 200, corpo: { ...PRODUTO, descricao: "Fita isolante 19mm" } };
    await salvar();
    expect(gravacoes()).toEqual([{ url: "/api/ordens/os1/orcamento/i4", metodo: "PATCH", corpo: { descricao: "Fita isolante 19mm" } }]);
    expect(txt(linha("i4"))).toContain("Fita isolante 19mm");
    await clicar(lapisDa("i4"));
    await salvar();
    expect(gravacoes()).toHaveLength(1);
  });

  it("erro de digitação não vira zero: preço inválido e quantidade zero ficam no painel, sem chamar o servidor", async () => {
    await abrirItens();
    await clicar(lapisDa("i3"));
    await digitar(campo("Valor unitário (R$)"), "1o0");
    await salvar();
    expect(txt(painel())).toContain("Valor unitário inválido.");
    await digitar(campo("Valor unitário (R$)"), "100,00");
    await digitar(campo("Quantidade"), "0");
    await salvar();
    expect(txt(painel())).toContain("Quantidade deve ser maior que zero.");
    expect(gravacoes()).toEqual([]);
    expect(await toasts()).toEqual([]);
    // recusa do servidor (ex.: a OS foi concluída por outra pessoa enquanto o painel estava aberto)
    await digitar(campo("Quantidade"), "5");
    respostas["PATCH /api/ordens/os1/orcamento/i3"] = { status: 400, corpo: { erro: TRAVA_CONCLUIDA } };
    await salvar();
    expect(txt(painel())).toContain(TRAVA_CONCLUIDA);
    expect(await toasts()).toEqual([]);
  });

  it("serviço com materiais: o preço é o unitário BASE; os materiais ficam no editor completo, com a mesma faixa de uso", async () => {
    await abrirItens();
    await clicar(lapisDa("i1"));
    expect(rotulosDosCampos()).toEqual(["Descrição", "Quantidade", "Unit. base (R$)"]);
    expect(campo("Unit. base (R$)")!.value).toBe("800,00");
    const acao = $("[data-acao-secundaria]", painel()!)!;
    expect(txt(acao)).toBe("Materiais e peças deste item");
    await clicar(acao);
    // o painel fecha e o editor completo abre na linha, dizendo o que se edita
    expect(painel()).toBeNull();
    const editor = $("[data-form-item]", linha("i1"))!;
    expect(txt($("[data-faixa-edicao='uso']", editor))).toBe("Editando este item da OS. Vale só aqui. O cadastro não muda.");
    expect($("[data-materiais-linha]", editor)).not.toBeNull();
    // enquanto o editor completo está aberto, a linha não mostra outro lápis
    expect(lapisDa("i1")).toBeNull();
  });

  it("produto não tem 'materiais e peças'; linha com total digitado à mão não oferece o unitário", async () => {
    await abrirItens([{ ...SERVICO, valorManual: true, valorTotal: 1000 }, PRODUTO]);
    await clicar(lapisDa("i4"));
    expect($("[data-acao-secundaria]", painel()!)).toBeNull();
    await clicar(botao("Cancelar", painel()!));
    await clicar(lapisDa("i1"));
    expect(rotulosDosCampos()).toEqual(["Descrição", "Quantidade"]);
    expect(txt($("[data-acao-secundaria]", painel()!))).toBe("Materiais e peças deste item");
  });

  it("item novo: o formulário também diz que vale só nesta OS", async () => {
    await abrirItens([]);
    await clicar($("[data-acao='novo-livre']"));
    expect(txt($("[data-novo-item] [data-faixa-edicao='uso']"))).toBe("Novo item da OS. Vale só aqui. O cadastro não muda.");
  });

  it("linha que não se edita por ela mesma: peça, item do orçamento e item executado — cadeado com o motivo, sem lixeira", async () => {
    await abrirItens([SERVICO, PECA, { ...LIVRE, orcamentoServicoId: "orc1" }, { ...PRODUTO, executado: true }]);
    for (const [id, motivo] of [["i2", TRAVA_LINHA_PECA], ["i3", TRAVA_LINHA_DO_ORCAMENTO], ["i4", TRAVA_LINHA_EXECUTADA]] as const) {
      const b = lapisDa(id)!;
      expect([id, b.disabled, $("[data-edicao-travada]", linha(id)) !== null, dica("Edição travada", linha(id))]).toEqual([id, true, true, motivo]);
      expect($("button[aria-label^='Excluir']", linha(id)), id).toBeNull();
    }
    // a linha comum, na mesma OS aberta, continua com lápis e lixeira
    expect(lapisDa("i1")!.disabled).toBe(false);
    expect($("button[aria-label^='Excluir']", linha("i1"))).not.toBeNull();
    expect($("[data-itens-travados]")).toBeNull();
    expect($("[data-acao='novo-servico']")).not.toBeNull();
  });
});

describe("trava de registro fechado nos itens da OS", () => {
  async function abrirFechada(situacao: any, itens: unknown[] = [SERVICO, PECA, LIVRE, PRODUTO], permissoes?: Permissoes) {
    const { OsOrcamento } = await import("@/components/os/os-orcamento");
    await montar(createElement(OsOrcamento as any, { osId: "os1", itens, clienteId: "c1", situacao }), permissoes);
    await esperar();
    chamadas.length = 0;
  }
  it.each([
    ["concluída", situacaoDaOs({ status: "CONCLUIDA" }), TRAVA_CONCLUIDA],
    ["assinada pelo cliente", situacaoDaOs({ status: "CONCLUIDA", aceite: { situacao: "CONFIRMADO" } }), TRAVA_ASSINADA],
    ["faturada", situacaoDaOs({ status: "CONCLUIDA", faturada: true }), TRAVA_FATURADO],
    ["com nota emitida", situacaoDaOs({ status: "CONCLUIDA", faturada: true, notaEmitida: true }), TRAVA_NOTA],
  ])("OS %s: todas as linhas com cadeado e o motivo no ⓘ; sem lixeira; sem 'novo item'; o painel não abre", async (_n, situacao, motivo) => {
    await abrirFechada(situacao);
    const linhas = $$("[data-item-os]");
    expect(linhas).toHaveLength(4);
    for (const l of linhas) {
      const b = $("[data-editar-no-contexto]", l) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(b.getAttribute("aria-label")).toMatch(/: edição travada$/);
      expect(dica("Edição travada", l)).toBe(motivo);
      expect($("button[aria-label^='Excluir']", l)).toBeNull();
    }
    // não entra linha nova, e a tela diz por quê
    expect(txt($("[data-itens-travados]"))).toBe(motivo);
    for (const acao of ["novo-servico", "novo-produto", "novo-livre"]) expect($(`[data-acao='${acao}']`), acao).toBeNull();
    await clicar($("[data-editar-no-contexto]", linhas[2]));
    expect(painel()).toBeNull();
    expect(chamadas).toEqual([]);
  });

  it("OS fechada: 'Marcar executado' continua (é o que leva ao faturamento)", async () => {
    await abrirFechada(situacaoDaOs({ status: "CONCLUIDA" }), [LIVRE]);
    respostas["PUT /api/ordens/os1/orcamento/i3"] = { status: 200, corpo: { ...LIVRE, executado: true } };
    await clicar(botao("Marcar executado"));
    expect(gravacoes()).toEqual([{ url: "/api/ordens/os1/orcamento/i3", metodo: "PUT", corpo: { executado: true } }]);
    expect(txt($("[data-item-os='i3']"))).toContain("Executado");
  });

  it("sem a situação informada (telas antigas), nada trava", async () => {
    const { OsOrcamento } = await import("@/components/os/os-orcamento");
    await montar(createElement(OsOrcamento as any, { osId: "os1", itens: [LIVRE], clienteId: "c1" }));
    expect(($("[data-editar-no-contexto]") as HTMLButtonElement).disabled).toBe(false);
    expect($("[data-itens-travados]")).toBeNull();
  });

  it("RBAC: sem Ordens › editar, os itens aparecem sem lápis, cadeado, lixeira, 'marcar executado' nem 'novo item'", async () => {
    for (const situacao of [situacaoDaOs({ status: "EM_ANDAMENTO" }), situacaoDaOs({ status: "CONCLUIDA" })]) {
      await abrirFechada(situacao, [SERVICO, PECA, LIVRE, PRODUTO], SO_VE);
      expect($$("[data-item-os]")).toHaveLength(4);
      expect(txt($("[data-total-os]"))).toMatch(/R\$\s?1\.165,00/);
      expect($$("[data-editar-no-contexto]")).toHaveLength(0);
      expect($$("button[aria-label^='Excluir']")).toHaveLength(0);
      expect(botao("Marcar executado")).toBeUndefined();
      expect($("[data-acao='novo-servico']")).toBeNull();
      expect($("[data-itens-travados]")).toBeNull();
      desmontar();
    }
  });
});

/* ═════════ USO + TRAVA: a linha do orçamento ═════════ */
describe("uso: 'Editando este item do orçamento' (detalhe do orçamento)", () => {
  const L = { id: "l1", descricao: "Limpeza", quantidade: 2, valorUnitario: 150, observacao: "Fora do horário", materialId: null, comMateriais: false, valorManual: false };
  async function abrirLinha(status: string, extra: Record<string, unknown> = {}, permissoes?: Permissoes, faturado = false) {
    const { EditarLinhaOrcamento } = await import("@/components/orcamento/editar-linha-orcamento");
    await montar(createElement(EditarLinhaOrcamento, { orcamentoId: "o1", status, faturado, linha: { ...L, ...extra } }), permissoes);
  }

  it("rascunho: painel de uso com descrição, quantidade, preço e observação; PATCH só do que mudou; a tela relê do servidor", async () => {
    await abrirLinha("RASCUNHO");
    await clicar($("[data-editar-no-contexto]"));
    expect(tituloDoPainel()).toBe("Editando este item do orçamento");
    expect(txt($("[data-faixa-edicao='uso']", painel()!))).toBe("Vale só aqui. O cadastro não muda.");
    expect(rotulosDosCampos()).toEqual(["Descrição", "Quantidade", "Valor unitário (R$)", "Observação"]);
    expect([campo("Descrição")!.value, campo("Quantidade")!.value, campo("Valor unitário (R$)")!.value, campo("Observação")!.value]).toEqual(["Limpeza", "2", "150,00", "Fora do horário"]);
    await digitar(campo("Quantidade"), "3");
    await digitar(campo("Observação"), "");
    respostas["PATCH /api/orcamentos/o1/linhas/l1"] = { status: 200, corpo: { linha: { id: "l1" }, totalGeral: 450 } };
    await salvar();
    expect(gravacoes()).toEqual([{ url: "/api/orcamentos/o1/linhas/l1", metodo: "PATCH", corpo: { quantidade: 3, observacao: null } }]);
    expect(await toasts()).toEqual(["Item do orçamento atualizado."]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(chamadas.some((c) => /\/api\/(servicos|produtos|cadastros)/.test(c.url))).toBe(false);
  });

  it("edição mais a fundo: 'Abrir o formulário do orçamento' leva ao editar de sempre", async () => {
    await abrirLinha("RASCUNHO");
    await clicar($("[data-editar-no-contexto]"));
    await clicar($("[data-acao-secundaria]", painel()!));
    expect(nav.push).toHaveBeenCalledWith("/orcamentos/o1/editar");
    expect(painel()).toBeNull();
  });

  it("serviço com materiais: unitário BASE; com total digitado à mão, o unitário não é oferecido", async () => {
    await abrirLinha("RASCUNHO", { comMateriais: true, valorUnitario: 800 });
    await clicar($("[data-editar-no-contexto]"));
    expect(rotulosDosCampos()).toEqual(["Descrição", "Quantidade", "Unit. base (R$)", "Observação"]);
    desmontar();
    await abrirLinha("RASCUNHO", { comMateriais: true, valorManual: true });
    await clicar($("[data-editar-no-contexto]"));
    expect(rotulosDosCampos()).toEqual(["Descrição", "Quantidade", "Observação"]);
  });

  it.each([
    ["APROVADO", false, TRAVA_APROVADO], ["CONVERTIDA", false, TRAVA_APROVADO], ["APROVADO", true, TRAVA_FATURADO], ["ENVIADO", false, TRAVA_ORCAMENTO_ENVIADO],
  ])("orçamento %s (faturado: %s): cadeado com o motivo, e o painel não abre", async (status, faturado, motivo) => {
    await abrirLinha(status, {}, undefined, faturado);
    const b = $("[data-editar-no-contexto]") as HTMLButtonElement;
    expect([b.disabled, dica("Edição travada")]).toEqual([true, motivo]);
    await clicar(b);
    expect(painel()).toBeNull();
    expect(chamadas).toEqual([]);
  });

  it("peça derivada em rascunho: cadeado; sem Orçamentos › editar: nada aparece", async () => {
    await abrirLinha("RASCUNHO", { materialId: "m1" });
    expect(dica("Edição travada")).toBe(TRAVA_LINHA_PECA);
    desmontar();
    await abrirLinha("RASCUNHO", {}, SO_VE);
    expect($("[data-editar-no-contexto]")).toBeNull();
  });

  it("documento: o lápis só existe na tela do escritório (edicaoLinhas) e fica fora da impressão; o do cliente não tem", async () => {
    const { OrcamentoDocumento } = await import("@/components/orcamento/orcamento-documento");
    const orcamento = {
      codigo: "2026-0001", nome: "Orçamento", status: "RASCUNHO", criadoEm: new Date("2026-11-01"), totalServicos: 300, totalProdutos: 45, totalGeral: 345, desconto: 0, tipoDesconto: "VALOR",
      servicos: [{ id: "l1", descricao: "Limpeza", quantidade: 2, valorUnitario: 150, valorTotal: 300, observacao: null }],
      produtos: [{ id: "p1", descricao: "Fita", quantidade: 3, valorUnitario: 15, valorTotal: 45, observacao: null }, { id: "p2", descricao: "Capacitor", quantidade: 1, valorUnitario: 80, valorTotal: 80, materialId: "m1" }],
    };
    const empresa = { nome: "Clima Total", cnpj: "12.345.678/0001-90" }, cliente = { nome: "Hospital", cpfCnpj: "22.101.333/0001-11" };
    await montar(createElement(OrcamentoDocumento as any, { orcamento, empresa, cliente, versao: "interna", edicaoLinhas: { orcamentoId: "o1", faturado: false } }));
    const celulas = $$("[data-editar-linha]");
    expect(celulas).toHaveLength(3);
    for (const c of celulas) expect(c.className).toContain("print:hidden");
    expect($$("[data-editar-linha] [data-editar-no-contexto]").map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false, true]);
    await clicar($("[data-editar-linha] [data-editar-no-contexto]"));
    expect(tituloDoPainel()).toBe("Editando este item do orçamento");
    desmontar();
    await montar(createElement(OrcamentoDocumento as any, { orcamento, empresa, cliente, versao: "cliente" }));
    expect($$("[data-linha-item]")).toHaveLength(3);
    expect($$("[data-editar-linha], [data-editar-no-contexto]")).toHaveLength(0);
  });
});

/* ═════════ Onde está ligado ═════════ */
describe("central da OS: cliente e local (referência)", () => {
  const OS = {
    id: "os1", cliente: { id: "c1", nome: "Hospital Santa Luzia" }, unidade: { id: "un1", nome: "Matriz", cidade: "São Paulo", estado: "SP" }, descricao: "Preventiva",
    criadoEm: new Date("2026-11-01T10:00:00Z"), previsaoConclusao: null, historico: [], atividades: [], prazos: [], status: "CONCLUIDA",
  };
  const central: any = { falta: [], prazoOs: { situacao: "SEM_PRAZO" }, prazosAtividades: [] };

  it("lápis no cliente e no endereço — mesmo com a OS concluída (a trava é das linhas, não do cadastro)", async () => {
    const { ResumoOs } = await import("@/components/os/central/resumo-os");
    await montar(createElement(ResumoOs, { os: OS, central, onAba: () => {} }));
    const cartao = $("[data-cartao='informacoes']")!;
    const lapis = $$("[data-editar-no-contexto]", cartao) as HTMLButtonElement[];
    expect(lapis.map((b) => [b.getAttribute("aria-label"), b.disabled])).toEqual([["Editar o cadastro do cliente", false], ["Editar o cadastro da unidade", false]]);
    respostas["GET /api/clientes/c1"] = { status: 200, corpo: { id: "c1", telefone: "1", celular: null, email: null } };
    await clicar(lapis[0]);
    expect(tituloDoPainel()).toBe("Editando o cadastro do cliente");
  });

  it("corrigir a unidade daqui atualiza o que a OS mostra; quem só vê clientes não tem lápis", async () => {
    const { ResumoOs } = await import("@/components/os/central/resumo-os");
    const aoAtualizar = vi.fn();
    respostas["GET /api/unidades/un1"] = { status: 200, corpo: { id: "un1", nome: "Matriz", cidade: "São Paulo", estado: "SP" } };
    respostas["PATCH /api/unidades/un1"] = { status: 200, corpo: { id: "un1", nome: "Matriz — Bloco B", cidade: "São Paulo", estado: "SP" } };
    await montar(createElement(ResumoOs, { os: OS, central, onAba: () => {}, onAtualizado: aoAtualizar }));
    await clicar($$("[data-editar-no-contexto]", $("[data-cartao='informacoes']")!)[1]);
    expect(tituloDoPainel()).toBe("Editando o cadastro da unidade");
    await digitar(campo("Nome do local"), "Matriz — Bloco B");
    await salvar();
    expect(aoAtualizar).toHaveBeenCalledWith({ unidade: { id: "un1", nome: "Matriz — Bloco B", cidade: "São Paulo", estado: "SP" } });
    desmontar();
    await montar(createElement(ResumoOs, { os: OS, central, onAba: () => {} }), SO_OPERA);
    expect(txt($("[data-cartao='informacoes']"))).toContain("Hospital Santa Luzia");
    expect($$("[data-editar-no-contexto]")).toHaveLength(0);
  });
});

describe("onde a edição no contexto está ligada (telas de OS e de orçamento)", () => {
  const vezes = (src: string, trecho: string) => src.split(trecho).length - 1;
  it("OS — abertura: cliente, endereço, equipamento da solicitação e a lista de equipamentos atendidos", () => {
    const src = fonte("app/(dashboard)/ordens/nova/page.tsx");
    expect(vezes(src, "edicao={CLIENTE.edicao()}")).toBe(1);
    expect(vezes(src, "edicao={UNIDADE.edicao<UnidadeItem>(clienteId,")).toBe(1);
    expect(vezes(src, "EQUIPAMENTO.edicao<EquipItem>(")).toBe(1);
    expect(vezes(src, "<EditarNoContexto id={e.id}")).toBe(1);
    expect(vezes(src, "EQUIPAMENTO.edicao<EquipamentoResumo>(")).toBe(1);
  });

  it("OS — central e atividades: itens com a situação da OS; equipamento vinculado com o lápis", () => {
    const detalhe = fonte("components/os/os-detalhe.tsx");
    expect(detalhe).toContain("situacao={situacaoDaOs({ status: os.status, aceite: os.aceite, faturada: !!os.fatura, notaEmitida: !!os.notaEmitida })}");
    expect(detalhe).toContain("onAtualizado={(d) => setOs((prev: any) => ({ ...prev, ...d }))} />}");
    expect(fonte("app/(dashboard)/ordens/[id]/page.tsx")).toContain("const notaEmitida = await osTemNotaEmitida(os.id, fatura?.id);");
    const equip = fonte("components/os/atividade-equipamentos.tsx");
    expect(vezes(equip, "<EditarNoContexto id={e.equipamento.id}")).toBe(1);
    expect(equip).toContain("edicao={EQUIPAMENTO.edicao(() => carregar())}");
  });

  it("orçamento — formulário: cliente, unidade do 'Para:' e contato A/C; as tabelas dizem que as linhas valem só ali", () => {
    const src = fonte("components/forms/orcamento-form.tsx");
    expect(vezes(src, "edicao={CLIENTE.edicao({ aoMudarContatos: recarregarDestinos })}")).toBe(1);
    expect(vezes(src, "edicao={UNIDADE.edicao(clienteId, recarregarDestinos)}")).toBe(1);
    expect(vezes(src, "edicao={CONTATO.edicao(clienteId, destinos.contatos, recarregarDestinos)}")).toBe(1);
    expect(vezes(src, "dica={DICA_LINHAS}")).toBe(2);
    expect(src).toContain('const DICA_LINHAS = "Descrição, quantidade e preço valem só neste orçamento. O catálogo não muda.";');
    expect(src).toContain("}, [clienteId, versaoDestinos]);");
    expect(fonte("app/(dashboard)/orcamentos/[id]/page.tsx")).toContain("edicaoLinhas={{ orcamentoId: orcamento.id, faturado: temFaturas }}");
  });

  it("o caso perigoso: a edição da linha nunca oferece editar o serviço nem o produto do catálogo", () => {
    for (const f of ["components/os/os-orcamento.tsx", "components/orcamento/editar-linha-orcamento.tsx"]) {
      const src = fonte(f);
      expect(src, f).not.toMatch(/escopo: "referencia"/);
      expect(src, f).not.toMatch(/SERVICO\.edicao|PRODUTO\.edicao|linkCadastroCompleto: (?!undefined)/);
      expect(src, f).not.toMatch(/method: "(PATCH|PUT|POST)"[^\n]*\/api\/(servicos|produtos|cadastros)/);
      expect(src, f).not.toMatch(/fetch\(`?["'`]?\/api\/(servicos|produtos|cadastros\/(servicos|produtos))/);
    }
    // e as definições de serviço e produto continuam só com o criar (o cadastro-mãe fica na tela do catálogo)
    const defs = fonte("components/cadastro-rapido/definicoes.ts");
    const bloco = (nome: string) => defs.slice(defs.indexOf(`export const ${nome} = {`), defs.indexOf("};", defs.indexOf(`export const ${nome} = {`)));
    for (const nome of ["PRODUTO", "SERVICO"]) expect(bloco(nome), nome).not.toMatch(/edicao|alterar\(/);
  });
});
