// @vitest-environment happy-dom
/**
 * Padronização — leva 1, nas telas (DOM real).
 *
 * PARTE A — componentes compartilhados:
 *  - EDITAR NO CONTEXTO, no mesmo componente do cadastro rápido (SelectCadastroRapido › `edicao`):
 *    o lápis ao lado do seletor abre os campos do item escolhido sem sair da tela; o painel diz SEMPRE
 *    o que está sendo editado — "Editando o cadastro do …" (referência: vale em todo lugar) ou
 *    "Editando este item da OS" (uso: vale só ali); registro fechado vira cadeado com o motivo; sem a
 *    permissão o lápis nem existe; salvou → toast, e o formulário principal continua como estava;
 *  - SeletorCadastro › `editavel`: o mesmo para os cadastros do registro padrão;
 *  - a ajuda é sempre o ⓘ único (components/ui/dica).
 *
 * PARTE B — telas pequenas no padrão:
 *  - Tipos de OS e Tipos de problema no cadastro padrão: Novo / Editar / Inativar conforme a permissão,
 *    abas com contagem, lista em tabela e em cartões (celular), explicação no ⓘ, toast em toda gravação;
 *  - o mesmo esqueleto (TelaCadastroApoio) em todas as telas de cadastro de apoio.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { TRAVA_CONCLUIDA, TRAVA_NOTA, motivoDaTrava } from "@/lib/edicao-contexto";
import type { EdicaoDoSelecionado } from "@/components/ui/select-cadastro-rapido";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/configuracoes", useSearchParams: () => new URLSearchParams(),
}));
// O toast é o da casa (de verdade); só é observado
vi.mock("@/components/ui/avisos", async (original) => {
  const real = await original<typeof import("@/components/ui/avisos")>();
  return { ...real, toast: vi.fn(real.toast) };
});

const RAIZ = path.resolve(__dirname, "../..");
let root: Root, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const SEM_CONFIG = montarPermissoes({ ordens: ["ver", "criar", "editar"], clientes: ["ver", "criar"], equipamentos: ["ver"] });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (t: string, dentro: ParentNode = document) => [...dentro.querySelectorAll("button")].filter((b) => txt(b) === t).at(-1);
async function digitar(el: Element | null | undefined, v: string) {
  expect(el, "campo a preencher").toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
/** O painel aberto (o último diálogo na tela) */
const painel = () => $$('[role="dialog"]').at(-1) ?? null;
const tituloDoPainel = () => txt(painel()?.querySelector("h3, h2"));
/** O campo do painel pelo rótulo */
const campo = (rotulo: string) => {
  const l = [...(painel()?.querySelectorAll("label") ?? [])].find((x) => txt(x.querySelector("span")).replace(/ \*$/, "") === rotulo);
  return (l?.querySelector("input, textarea, select") ?? null) as HTMLInputElement | null;
};
const lapis = () => $("[data-editar-no-contexto]") as HTMLButtonElement | null;
/** Texto do balão de um ⓘ pelo nome acessível ("Ajuda: <rótulo>") */
const dica = (rotulo: string) => {
  const b = $$("[data-dica]").find((d) => d.getAttribute("aria-label") === `Ajuda: ${rotulo}`);
  return b ? txt(document.getElementById(b.getAttribute("aria-describedby")!)) : null;
};
const toastMock = async () => vi.mocked((await import("@/components/ui/avisos")).toast);
const toasts = async () => (await toastMock()).mock.calls.map((c) => c[0]);
const pagina = (itens: any[], contagens?: { ativos: number; inativos: number; todos: number }) => ({
  status: 200, corpo: { itens, total: itens.length, pagina: 1, porPagina: 50, contagens: contagens ?? { ativos: itens.length, inativos: 0, todos: itens.length } },
});

beforeAll(async () => {
  await Promise.all([
    import("@/components/ui/select-cadastro-rapido"), import("@/components/cadastros/seletor-cadastro"), import("@/components/cadastros/cadastro-padrao"),
    import("@/components/config/telas/tipos-os"), import("@/components/config/telas/portal"), import("@/components/providers/permissoes-provider"),
  ]);
}, 120_000);
beforeEach(async () => {
  chamadas.length = 0;
  respostas = {};
  (await toastMock()).mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const padrao = metodo !== "GET" ? {} : url.includes("sugestoes=1") ? { sugestoes: [] } : url.includes("pagina=") ? pagina([]).corpo : [];
    const r = chave ? respostas[chave] : { status: 200, corpo: padrao };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

/* ═════════ PARTE A — editar no contexto ═════════ */
const TIPOS = [
  { value: "t1", label: "Manutenção preventiva" }, { value: "t2", label: "Visita técnica" },
];
const DADOS: Record<string, Record<string, string>> = {
  t1: { nome: "Manutenção preventiva", descricao: "Visita mensal", cor: "#16a34a" },
  t2: { nome: "Visita técnica", descricao: "", cor: "#2563eb" },
};
const CAMPOS = [
  { nome: "nome", label: "Nome do tipo", obrigatorio: true }, { nome: "descricao", label: "Descrição", tipo: "textarea" as const },
];
/** Um formulário principal de mentira: um campo digitado, o seletor com edição e um submit que não pode disparar */
async function montarFormulario(opts: { edicao?: Partial<EdicaoDoSelecionado> | null; inicial?: string; permissoes?: Permissoes; disabled?: boolean } = {}) {
  const { SelectCadastroRapido } = await import("@/components/ui/select-cadastro-rapido");
  const salvar = vi.fn(async (id: string, v: Record<string, string>) => ({ value: id, label: v.nome }));
  const aoMudar = vi.fn();
  const aoEnviar = vi.fn((e: Event) => e.preventDefault());
  const edicao: EdicaoDoSelecionado | undefined = opts.edicao === null ? undefined : {
    escopo: "referencia", alvo: "do tipo de OS", campos: CAMPOS, valores: (id) => DADOS[id], salvar,
    permissao: { modulo: "configuracoes", acao: "gerenciar" }, linkCadastroCompleto: "/configuracoes?secao=tipos-os", mensagemSucesso: "Tipo de OS atualizado.",
    ...opts.edicao,
  };
  function Formulario() {
    const [tipo, setTipo] = useState(opts.inicial ?? "t1");
    const [obs, setObs] = useState("");
    return createElement("form", { onSubmit: aoEnviar, "data-form-principal": true },
      createElement("input", { "data-principal": true, value: obs, onChange: (e: any) => setObs(e.target.value) }),
      createElement(SelectCadastroRapido, {
        value: tipo, onChange: (v: string) => { aoMudar(v); setTipo(v); }, opcoes: TIPOS, entidade: { singular: "tipo de OS", plural: "tipos de OS" },
        campos: [{ nome: "nome", label: "Nome do tipo", obrigatorio: true }], criar: async () => ({ value: "novo", label: "Novo" }),
        permissao: { modulo: "configuracoes", acao: "gerenciar" }, disabled: opts.disabled, edicao,
      }),
      createElement("button", { type: "submit", "data-enviar": true }, "Enviar"));
  }
  await montar(createElement(Formulario), opts.permissoes);
  return { salvar, aoMudar, aoEnviar };
}

describe("editar no contexto — SelectCadastroRapido › edicao", () => {
  it("sem `edicao`, o seletor é o de sempre: nenhum lápis, nenhum invólucro novo", async () => {
    await montarFormulario({ edicao: null });
    expect(lapis()).toBeNull();
    expect($("[data-select-com-edicao]")).toBeNull();
    expect(painel()).toBeNull();
  });

  it("o lápis só existe com um item escolhido; o nome dele diz o que edita", async () => {
    await montarFormulario({ inicial: "" });
    expect($("[data-select-com-edicao]")).not.toBeNull();
    expect(lapis()).toBeNull();
    // escolhe um tipo na lista
    await clicar($("[data-select-com-edicao] button"));
    await clicar($$("[data-select-com-edicao] button").find((b) => txt(b) === "Visita técnica"));
    expect(lapis()!.getAttribute("aria-label")).toBe("Editar o tipo de OS selecionado");
    expect(lapis()!.disabled).toBe(false);
    expect(lapis()!.type).toBe("button");
  });

  it("REFERÊNCIA: o painel diz 'Editando o cadastro do tipo de OS' e que vale em todo lugar; abre com os dados atuais", async () => {
    await montarFormulario();
    expect(painel()).toBeNull();
    await clicar(lapis());
    expect(tituloDoPainel()).toBe("Editando o cadastro do tipo de OS");
    const faixa = painel()!.querySelector("[data-faixa-edicao]")!;
    expect(faixa.getAttribute("data-faixa-edicao")).toBe("referencia");
    expect(txt(faixa.querySelector("[data-alcance-edicao]"))).toBe("Vale em todo lugar onde este cadastro é usado.");
    expect(campo("Nome do tipo")!.value).toBe("Manutenção preventiva");
    expect(campo("Descrição")!.value).toBe("Visita mensal");
    // edição complexa: link para o cadastro completo, em outra aba (não perde este formulário)
    const link = [...painel()!.querySelectorAll("a")].find((a) => txt(a) === "Abrir cadastro completo")!;
    expect(link.getAttribute("href")).toBe("/configuracoes?secao=tipos-os");
    expect(link.getAttribute("target")).toBe("_blank");
    // o botão diz só "Salvar" (não "Salvar e selecionar": nada é selecionado aqui)
    expect(botao("SalvarSalvar", painel()!) ?? botao("Salvar", painel()!)).toBeTruthy();
    expect(txt(painel())).not.toContain("Salvar e selecionar");
  });

  it("USO: o painel diz 'Editando este item da OS' e que vale só ali — o cadastro não muda", async () => {
    await montarFormulario({ edicao: { escopo: "uso", alvo: "este item da OS", mensagemSucesso: undefined, linkCadastroCompleto: undefined } });
    await clicar(lapis());
    expect(tituloDoPainel()).toBe("Editando este item da OS");
    const faixa = painel()!.querySelector("[data-faixa-edicao]")!;
    expect(faixa.getAttribute("data-faixa-edicao")).toBe("uso");
    expect(txt(faixa)).toBe("Vale só aqui. O cadastro não muda.");
    expect(txt(painel())).not.toContain("cadastro completo");
    await digitar(campo("Descrição"), "Só nesta OS");
    await clicar(botao("SalvarSalvar", painel()!));
    // sem mensagem própria, o toast é o padrão
    expect(await toasts()).toEqual(["Alterações salvas."]);
  });

  it("salvar: manda os valores e a lista do que mudou (apagar um campo é mudança), avisa com toast e fecha", async () => {
    const { salvar, aoMudar } = await montarFormulario();
    await clicar(lapis());
    await digitar(campo("Nome do tipo"), "  Preventiva mensal ");
    await digitar(campo("Descrição"), "");
    await clicar(botao("SalvarSalvar", painel()!));
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(salvar.mock.calls[0]).toEqual(["t1", { nome: "Preventiva mensal", descricao: "" }, ["nome", "descricao"]]);
    expect(await toasts()).toEqual(["Tipo de OS atualizado."]);
    // o toast aparece na tela, no aviso da casa
    expect($$("[data-toast]").map(txt)).toContain("Tipo de OS atualizado.");
    expect(painel()).toBeNull();
    // editar não troca a seleção
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("nada mudou: fecha sem chamar o servidor e sem dizer que salvou", async () => {
    const { salvar } = await montarFormulario();
    await clicar(lapis());
    await digitar(campo("Nome do tipo"), "Manutenção preventiva  ");
    await clicar(botao("SalvarSalvar", painel()!));
    expect(salvar).not.toHaveBeenCalled();
    expect(await toasts()).toEqual([]);
    expect(painel()).toBeNull();
  });

  it("campo obrigatório vazio não sai da tela; erro do servidor aparece no painel, sem toast, e dá para tentar de novo", async () => {
    const salvar = vi.fn(async () => { throw new Error("Já existe um tipo de OS com este nome."); });
    await montarFormulario({ edicao: { salvar } });
    await clicar(lapis());
    await digitar(campo("Nome do tipo"), "   ");
    await clicar(botao("SalvarSalvar", painel()!));
    expect(salvar).not.toHaveBeenCalled();
    expect(txt(painel())).toContain("Preencha os campos obrigatórios.");
    await digitar(campo("Nome do tipo"), "Visita técnica");
    await clicar(botao("SalvarSalvar", painel()!));
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(txt(painel())).toContain("Já existe um tipo de OS com este nome.");
    expect(await toasts()).toEqual([]);
    // o que foi digitado continua lá
    expect(campo("Nome do tipo")!.value).toBe("Visita técnica");
  });

  it("o formulário principal não é enviado nem perde o que já tinha: o painel só tem botões comuns", async () => {
    const { aoEnviar } = await montarFormulario();
    await digitar($("[data-principal]"), "Cliente pediu urgência");
    await clicar(lapis());
    expect([...painel()!.querySelectorAll("button")].every((b) => b.type === "button")).toBe(true);
    expect(painel()!.querySelector("form")).toBeNull();
    await digitar(campo("Descrição"), "Visita quinzenal");
    await clicar(botao("SalvarSalvar", painel()!));
    expect(aoEnviar).not.toHaveBeenCalled();
    expect(($("[data-principal]") as HTMLInputElement).value).toBe("Cliente pediu urgência");
    // cancelar também não mexe em nada
    await clicar(lapis());
    await digitar(campo("Nome do tipo"), "Descartado");
    await clicar(botao("Cancelar", painel()!));
    expect(painel()).toBeNull();
    expect(aoEnviar).not.toHaveBeenCalled();
    expect(($("[data-principal]") as HTMLInputElement).value).toBe("Cliente pediu urgência");
    // e reabrir começa do valor atual, não do que foi descartado
    await clicar(lapis());
    expect(campo("Nome do tipo")!.value).toBe("Manutenção preventiva");
  });

  it("RBAC: sem a permissão de editar, o lápis não existe (e o seletor continua funcionando)", async () => {
    await montarFormulario({ permissoes: SEM_CONFIG });
    expect($("[data-select-com-edicao]")).not.toBeNull();
    expect(lapis()).toBeNull();
    expect(painel()).toBeNull();
    await clicar($("[data-select-com-edicao] button"));
    expect($$("[data-select-com-edicao] button").some((b) => txt(b) === "Visita técnica")).toBe(true);
    // sem a permissão de criar, também não há "+ Novo"
    expect($$("[data-select-com-edicao] button").some((b) => /Novo tipo de OS/.test(txt(b)))).toBe(false);
  });

  it("lista de permissões: qualquer uma libera; sem permissão declarada, quem vê o seletor edita", async () => {
    await montarFormulario({ permissoes: SEM_CONFIG, edicao: { permissao: [{ modulo: "configuracoes", acao: "gerenciar" }, { modulo: "ordens", acao: "editar" }] } });
    expect(lapis()).not.toBeNull();
    act(() => root.unmount()); caixa.remove();
    await montarFormulario({ permissoes: SEM_CONFIG, edicao: { permissao: undefined } });
    expect(lapis()).not.toBeNull();
  });

  it("registro FECHADO: o lápis vira cadeado desabilitado, com o motivo no ⓘ, e o painel não abre", async () => {
    const motivo = motivoDaTrava({ statusOs: "CONCLUIDA" })!;
    const { salvar } = await montarFormulario({ edicao: { escopo: "uso", alvo: "este item da OS", travado: motivo } });
    const trava = $("[data-edicao-travada]")!;
    expect(trava).not.toBeNull();
    expect(lapis()!.disabled).toBe(true);
    expect(lapis()!.getAttribute("aria-label")).toBe("Editar o tipo de OS selecionado: edição travada");
    expect(dica("Edição travada")).toBe(TRAVA_CONCLUIDA);
    await clicar(lapis());
    expect(painel()).toBeNull();
    expect(salvar).not.toHaveBeenCalled();
  });

  it("seletor desabilitado: sem lápis", async () => {
    await montarFormulario({ disabled: true });
    expect(lapis()).toBeNull();
  });

  it("o link do cadastro completo pode depender do item escolhido", async () => {
    await montarFormulario({ inicial: "t2", edicao: { linkCadastroCompleto: (id: string) => `/clientes/${id}` } });
    await clicar(lapis());
    expect([...painel()!.querySelectorAll("a")].find((a) => txt(a) === "Abrir cadastro completo")!.getAttribute("href")).toBe("/clientes/t2");
  });
});

describe("editar no contexto — o painel sozinho (EdicaoNoContextoModal) e o botão", () => {
  it("registro fechado: o painel mostra o rótulo e o motivo, sem campo e sem salvar", async () => {
    const { EdicaoNoContextoModal } = await import("@/components/ui/select-cadastro-rapido");
    const salvar = vi.fn(), fechar = vi.fn();
    await montar(createElement(EdicaoNoContextoModal, {
      aberto: true, onFechar: fechar, escopo: "uso", alvo: "esta linha do orçamento", campos: CAMPOS, valores: DADOS.t1, salvar, onSalvo: () => {}, travado: TRAVA_NOTA,
    }));
    expect(tituloDoPainel()).toBe("Editando esta linha do orçamento");
    expect(txt(painel()!.querySelector("[data-edicao-travada-modal]"))).toContain(TRAVA_NOTA);
    expect(painel()!.querySelectorAll("input, textarea, select")).toHaveLength(0);
    expect(botao("Salvar", painel()!)).toBeUndefined();
    await clicar(botao("Fechar", painel()!));
    expect(fechar).toHaveBeenCalledTimes(1);
    expect(salvar).not.toHaveBeenCalled();
  });

  it("aberto para edição: salva só quando algo muda e devolve o que o servidor respondeu", async () => {
    const { EdicaoNoContextoModal } = await import("@/components/ui/select-cadastro-rapido");
    const salvar = vi.fn(async () => ({ value: "t1", label: "Novo nome" })), aoSalvo = vi.fn();
    await montar(createElement(EdicaoNoContextoModal, {
      aberto: true, onFechar: () => {}, escopo: "referencia", alvo: "da unidade", campos: CAMPOS, valores: DADOS.t1, salvar, onSalvo: aoSalvo,
    }));
    expect(tituloDoPainel()).toBe("Editando o cadastro da unidade");
    await digitar(campo("Nome do tipo"), "Novo nome");
    await clicar(botao("SalvarSalvar", painel()!));
    expect(salvar).toHaveBeenCalledWith({ nome: "Novo nome", descricao: "Visita mensal" }, ["nome"]);
    expect(aoSalvo).toHaveBeenCalledWith({ value: "t1", label: "Novo nome" });
    expect(await toasts()).toEqual(["Alterações salvas."]);
  });

  it("fechado, o painel não existe na tela", async () => {
    const { EdicaoNoContextoModal } = await import("@/components/ui/select-cadastro-rapido");
    await montar(createElement(EdicaoNoContextoModal, { aberto: false, onFechar: () => {}, escopo: "uso", alvo: "este item", campos: CAMPOS, valores: {}, salvar: vi.fn(), onSalvo: () => {} }));
    expect(painel()).toBeNull();
  });

  it("botão: lápis clicável quando aberto; cadeado com motivo quando travado", async () => {
    const { BotaoEditarNoContexto } = await import("@/components/ui/select-cadastro-rapido");
    const aoClicar = vi.fn();
    await montar(createElement("div", null,
      createElement("span", { "data-livre": true }, createElement(BotaoEditarNoContexto, { rotulo: "Editar o cliente", onClick: aoClicar })),
      createElement("span", { "data-fechado": true }, createElement(BotaoEditarNoContexto, { rotulo: "Editar o item", travado: TRAVA_NOTA, onClick: aoClicar }))));
    const livre = $("[data-livre] [data-editar-no-contexto]") as HTMLButtonElement, fechado = $("[data-fechado] [data-editar-no-contexto]") as HTMLButtonElement;
    expect(livre.getAttribute("aria-label")).toBe("Editar o cliente");
    expect($("[data-livre] [data-edicao-travada]")).toBeNull();
    await clicar(livre);
    expect(aoClicar).toHaveBeenCalledTimes(1);
    expect(fechado.disabled).toBe(true);
    expect($("[data-fechado] [data-edicao-travada]")).not.toBeNull();
    expect(dica("Edição travada")).toBe(TRAVA_NOTA);
    await clicar(fechado);
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });
});

describe("editar no contexto — Tipo de OS de dentro da OS (TIPO_OS.edicao)", () => {
  const tipos = [
    { id: "t1", nome: "Manutenção preventiva", descricao: "Visita mensal", cor: "#16a34a" },
    { id: "t2", nome: "Visita técnica", descricao: null, cor: "#2563eb" },
  ];
  async function montarTipo(aoSalvar = vi.fn(), permissoes?: Permissoes) {
    const { SelectCadastroRapido } = await import("@/components/ui/select-cadastro-rapido");
    const { TIPO_OS } = await import("@/components/cadastro-rapido/definicoes");
    await montar(createElement(SelectCadastroRapido, {
      value: "t1", onChange: () => {}, opcoes: tipos.map((t) => ({ value: t.id, label: t.nome })), entidade: TIPO_OS.entidade, campos: TIPO_OS.campos,
      criar: TIPO_OS.criar, permissao: TIPO_OS.permissao, edicao: TIPO_OS.edicao(tipos, aoSalvar),
    }), permissoes);
    return aoSalvar;
  }

  it("é edição do CADASTRO (referência), com nome, descrição e cor — e manda ao servidor só o que mudou", async () => {
    respostas["PATCH /api/cadastros/tipos-os/t1"] = { status: 200, corpo: { ...tipos[0], descricao: "Visita quinzenal" } };
    const aoSalvar = await montarTipo();
    await clicar(lapis());
    expect(tituloDoPainel()).toBe("Editando o cadastro do tipo de OS");
    expect(painel()!.querySelector("[data-faixa-edicao]")!.getAttribute("data-faixa-edicao")).toBe("referencia");
    expect([...painel()!.querySelectorAll("label > span")].map((s) => txt(s).replace(/ \*$/, ""))).toEqual(["Nome do tipo", "Descrição", "Cor"]);
    expect((painel()!.querySelector('input[type="color"]') as HTMLInputElement).value).toBe("#16a34a");
    await digitar(campo("Descrição"), "Visita quinzenal");
    await clicar(botao("SalvarSalvar", painel()!));
    const patch = chamadas.filter((c) => c.metodo !== "GET");
    expect(patch).toEqual([{ url: "/api/cadastros/tipos-os/t1", metodo: "PATCH", corpo: { descricao: "Visita quinzenal" } }]);
    // a tela recebe o registro atualizado para trocar na lista dela
    expect(aoSalvar).toHaveBeenCalledWith({ ...tipos[0], descricao: "Visita quinzenal" });
    expect(await toasts()).toEqual(["Tipo de OS atualizado."]);
    expect(painel()).toBeNull();
  });

  it("recusa do servidor: a mensagem da API aparece no painel e a tela não é avisada", async () => {
    respostas["PATCH /api/cadastros/tipos-os/t1"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    const aoSalvar = await montarTipo();
    await clicar(lapis());
    await digitar(campo("Nome do tipo"), "Outro nome");
    await clicar(botao("SalvarSalvar", painel()!));
    expect(txt(painel())).toContain("Sem permissão para esta ação");
    expect(aoSalvar).not.toHaveBeenCalled();
    expect(await toasts()).toEqual([]);
  });

  it("quem não tem Configurações › gerenciar não vê o lápis dentro da OS", async () => {
    await montarTipo(vi.fn(), SEM_CONFIG);
    expect(lapis()).toBeNull();
  });

  it("as telas de OS usam essa edição no seletor de tipo", () => {
    // nova atividade e editar atividade (2) na OS aberta; o tipo na abertura da OS (1)
    for (const [f, vezes] of [["components/os/os-atividades.tsx", 2], ["app/(dashboard)/ordens/nova/page.tsx", 1]] as const) {
      expect(readFileSync(path.join(RAIZ, f), "utf8").split("edicao={TIPO_OS.edicao(tiposOs,").length - 1, f).toBe(vezes);
    }
  });
});

describe("editar no contexto — SeletorCadastro › editavel (cadastros do registro padrão)", () => {
  const cargos = [
    { id: "c1", nome: "Técnico de refrigeração", descricao: "Executa preventivas", ativo: true },
    { id: "c2", nome: "Ajudante", descricao: null, ativo: true },
  ];
  async function montarSeletor(props: Record<string, unknown> = {}, permissoes?: Permissoes) {
    const { SeletorCadastro } = await import("@/components/cadastros/seletor-cadastro");
    const aoEditar = vi.fn(), aoMudar = vi.fn();
    await montar(createElement(SeletorCadastro, { entidade: "cargos", valor: "c1", onChange: aoMudar, itens: cargos, editavel: true, aoEditar, ...props } as any), permissoes);
    return { aoEditar, aoMudar };
  }

  it("sem `editavel` não há lápis; com ele, só quando há um item escolhido", async () => {
    await montarSeletor({ editavel: false });
    expect(lapis()).toBeNull();
    expect($("[data-seletor-com-edicao]")).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await montarSeletor({ valor: "" });
    expect(lapis()).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await montarSeletor();
    expect(lapis()!.getAttribute("aria-label")).toBe("Editar o cargo selecionado");
    expect($("[data-seletor-com-edicao]")).not.toBeNull();
  });

  it("edita o cadastro-mãe sem sair da tela: rótulo de referência, PATCH só do que mudou, nome novo no seletor e toast", async () => {
    respostas["PATCH /api/cadastros/cargos/c1"] = { status: 200, corpo: { ...cargos[0], nome: "Técnico sênior" } };
    const { aoEditar, aoMudar } = await montarSeletor();
    await clicar(lapis());
    expect(tituloDoPainel()).toBe("Editando o cadastro do cargo");
    expect(txt(painel()!.querySelector("[data-alcance-edicao]"))).toBe("Vale em todo lugar onde este cadastro é usado.");
    expect(campo("Nome")!.value).toBe("Técnico de refrigeração");
    expect(campo("Descrição")!.value).toBe("Executa preventivas");
    expect([...painel()!.querySelectorAll("a")].find((a) => txt(a) === "Abrir cadastro completo")!.getAttribute("href")).toBe("/configuracoes/cargos");
    await digitar(campo("Nome"), "Técnico sênior");
    await clicar(botao("SalvarSalvar", painel()!));
    expect(chamadas.filter((c) => c.metodo !== "GET")).toEqual([{ url: "/api/cadastros/cargos/c1", metodo: "PATCH", corpo: { nome: "Técnico sênior" } }]);
    expect(await toasts()).toEqual(["Cargo atualizado."]);
    expect(painel()).toBeNull();
    // o seletor mostra o nome novo, com o mesmo item escolhido
    const select = $("[data-seletor-cadastro='cargos']") as HTMLSelectElement;
    expect(select.value).toBe("c1");
    expect(txt(select.selectedOptions[0])).toBe("Técnico sênior");
    expect(aoEditar).toHaveBeenCalledWith({ ...cargos[0], nome: "Técnico sênior" });
    expect(aoMudar).not.toHaveBeenCalled();
    // reabrir parte do que foi salvo
    await clicar(lapis());
    expect(campo("Nome")!.value).toBe("Técnico sênior");
  });

  it("cadastro feminino: 'Editando o cadastro da categoria' e 'Categoria atualizada.'", async () => {
    const cat = { id: "k1", nome: "Contrato mensal", cor: "#16a34a", ativo: true };
    respostas["PATCH /api/cadastros/categorias-financeiras/k1"] = { status: 200, corpo: { ...cat, nome: "Contrato" } };
    await montarSeletor({ entidade: "categorias-financeiras", valor: "k1", itens: [cat] });
    expect(lapis()!.getAttribute("aria-label")).toBe("Editar a categoria selecionada");
    await clicar(lapis());
    expect(tituloDoPainel()).toBe("Editando o cadastro da categoria");
    await digitar(campo("Nome"), "Contrato");
    await clicar(botao("SalvarSalvar", painel()!));
    expect(await toasts()).toEqual(["Categoria atualizada."]);
  });

  it("recusa do servidor: mensagem no painel, nada muda no seletor", async () => {
    respostas["PATCH /api/cadastros/cargos/c1"] = { status: 400, corpo: { erro: "Nome é obrigatório." } };
    const { aoEditar } = await montarSeletor();
    await clicar(lapis());
    await digitar(campo("Descrição"), "Outra");
    await clicar(botao("SalvarSalvar", painel()!));
    expect(txt(painel())).toContain("Nome é obrigatório.");
    expect(aoEditar).not.toHaveBeenCalled();
    expect(await toasts()).toEqual([]);
  });

  it("RBAC: sem Configurações › gerenciar não há lápis; cadastro de editor próprio também não (segue no cadastro completo)", async () => {
    await montarSeletor({}, SEM_CONFIG);
    expect(lapis()).toBeNull();
    act(() => root.unmount()); caixa.remove();
    const { CADASTROS } = await import("@/lib/cadastros/registro");
    expect(CADASTROS["tipos-equipamento"].editorProprio).toBe(true);
    await montarSeletor({ entidade: "tipos-equipamento", valor: "te1", itens: [{ id: "te1", nome: "Split", ativo: true }] });
    expect(lapis()).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await montarSeletor({ disabled: true });
    expect(lapis()).toBeNull();
  });

  it("o formulário do cadastro padrão liga a edição no contexto nos campos que apontam para outro cadastro", () => {
    expect(readFileSync(path.join(RAIZ, "components/cadastros/cadastro-padrao.tsx"), "utf8")).toMatch(/<SeletorCadastro [^\n]*\beditavel \/>/);
  });
});

/* ═════════ PARTE B — telas no padrão ═════════ */
const T1 = { id: "t1", nome: "Manutenção preventiva", descricao: "Visita mensal do contrato", cor: "#16a34a", ativo: true, exigeEquipamento: true, _count: { atividades: 3 } };
const T2 = { id: "t2", nome: "Visita técnica", descricao: null, cor: "#2563eb", ativo: true, exigeEquipamento: false, _count: { atividades: 1 } };
const T3 = { id: "t3", nome: "Instalação antiga", descricao: null, cor: "#64748b", ativo: false, exigeEquipamento: true, _count: { atividades: 0 } };
const linhas = () => $$("table tbody tr[data-linha]");

describe("Tipos de OS no padrão", () => {
  async function abrir(permissoes?: Permissoes, itens: any[] = [T1, T2]) {
    respostas["GET /api/cadastros/tipos-os"] = pagina(itens, { ativos: 2, inativos: 1, todos: 3 });
    const { TelaTiposOs } = await import("@/components/config/telas/tipos-os");
    await montar(createElement(TelaTiposOs), permissoes);
  }

  it("esqueleto: cabeçalho, cartão, abas com contagem, busca e a explicação no ⓘ (nenhum parágrafo de instrução)", async () => {
    await abrir();
    const tela = $("[data-tela-cadastro-apoio]")!;
    expect(txt(tela.querySelector("h1"))).toBe("Tipos de OS");
    expect(txt(tela)).toContain("Tipos de serviço executados pela empresa");
    expect(tela.querySelector("[data-voltar]")!.getAttribute("href")).toBe("/configuracoes");
    expect(tela.querySelector("[data-cadastro='tipos-os']")).not.toBeNull();
    expect($$("[role='tab']").map(txt)).toEqual(["Ativos (2)", "Inativos (1)", "Todos (3)"]);
    expect($("[role='tab'][aria-selected='true']")!.getAttribute("data-aba")).toBe("ativos");
    expect($("input[placeholder='Pesquisar tipos de OS…']")).not.toBeNull();
    // a explicação fica no ⓘ, não solta na tela
    expect(dica("Sobre tipos de OS")).toContain("Inativar um tipo o retira das novas escolhas");
    const naTela = txt(tela);
    expect(naTela).not.toContain("retira das novas escolhas");
    for (const p of tela.querySelectorAll("p")) if (!p.closest("[role='tooltip']")) expect(txt(p).length, txt(p)).toBeLessThan(110);
    // a lista vem paginada do servidor, só os ativos
    const lista = chamadas.find((c) => c.metodo === "GET" && c.url.startsWith("/api/cadastros/tipos-os?") && !c.url.includes("sugestoes"))!;
    expect(lista.url).toContain("pagina=1");
    expect(lista.url).toContain("ativo=sim");
  });

  it("lista: tipo com a cor, descrição, regra do equipamento e uso — em tabela e em cartões (celular)", async () => {
    await abrir();
    expect($$("table thead th").map(txt).filter(Boolean)).toEqual(expect.arrayContaining(["Tipo", "Descrição", "Equipamento", "Em uso"]));
    expect(linhas().map((l) => [...l.querySelectorAll("td")].slice(0, 4).map(txt))).toEqual([
      ["Manutenção preventiva", "Visita mensal do contrato", "Exige para concluir", "3 atividades"],
      ["Visita técnica", "—", "Não exige", "1 atividade"],
    ]);
    const cartoes = $$("[data-cartoes] [data-cartao]");
    expect(cartoes.map((c) => c.getAttribute("data-cartao"))).toEqual(["t1", "t2"]);
    expect(txt(cartoes[1])).toContain("Visita técnica");
    expect(cartoes[1].querySelector("[data-exige-equipamento='nao']")).not.toBeNull();
    // os cartões são só do celular e a tabela só do desktop
    expect($("[data-cartoes]")!.className).toContain("sm:hidden");
    // as ações existem nos dois
    expect(cartoes[0].querySelector("button[aria-label='Editar Manutenção preventiva']")).not.toBeNull();
    expect(cartoes[0].querySelector("button[aria-label='Inativar tipo de OS']")).not.toBeNull();
  });

  it("com permissão: Novo, Editar e Inativar à vista; sem Configurações › gerenciar, a lista aparece sem nenhum deles", async () => {
    await abrir();
    expect(txt($("[data-acao='novo-cadastro']"))).toBe("Novo tipo de OS");
    expect($$("table button[aria-label^='Editar ']")).toHaveLength(2);
    expect($$("table button[aria-label='Inativar tipo de OS']")).toHaveLength(2);
    act(() => root.unmount()); caixa.remove();
    await abrir(SEM_CONFIG);
    expect(linhas()).toHaveLength(2);
    expect($("[data-acao='novo-cadastro']")).toBeNull();
    expect($$("button[aria-label^='Editar ']")).toHaveLength(0);
    expect($$("button[aria-label='Inativar tipo de OS']")).toHaveLength(0);
    expect($$("button[aria-label='Reativar tipo de OS']")).toHaveLength(0);
  });

  it("criar: POST na rota padrão, toast 'Tipo de OS criado.' e a lista recarrega", async () => {
    await abrir();
    await clicar($("[data-acao='novo-cadastro']"));
    expect(tituloDoPainel()).toBe("Novo tipo de OS");
    await digitar([...painel()!.querySelectorAll("input")].find((i) => i.placeholder?.startsWith("Ex:")), "Higienização");
    const antes = chamadas.filter((c) => c.metodo === "GET" && c.url.includes("pagina=")).length;
    respostas["POST /api/cadastros/tipos-os"] = { status: 201, corpo: { id: "t9", nome: "Higienização", ativo: true } };
    await clicar(botao("Salvar"));
    const post = chamadas.find((c) => c.metodo === "POST")!;
    expect(post.url).toBe("/api/cadastros/tipos-os");
    expect(post.corpo).toMatchObject({ nome: "Higienização", exigeEquipamento: "true" });
    expect(await toasts()).toEqual(["Tipo de OS criado."]);
    expect(chamadas.filter((c) => c.metodo === "GET" && c.url.includes("pagina=")).length).toBeGreaterThan(antes);
  });

  it("editar: abre com os dados, manda só o que mudou e avisa 'Tipo de OS atualizado.'", async () => {
    await abrir();
    await clicar($("table button[aria-label='Editar Manutenção preventiva']"));
    expect(tituloDoPainel()).toBe("Editar Manutenção preventiva");
    const descricao = painel()!.querySelector("textarea")!;
    expect(descricao.value).toBe("Visita mensal do contrato");
    await digitar(descricao, "Visita quinzenal");
    respostas["PATCH /api/cadastros/tipos-os/t1"] = { status: 200, corpo: { ...T1, descricao: "Visita quinzenal" } };
    await clicar(botao("Salvar"));
    expect(chamadas.filter((c) => c.metodo === "PATCH")).toEqual([{ url: "/api/cadastros/tipos-os/t1", metodo: "PATCH", corpo: { descricao: "Visita quinzenal" } }]);
    expect(await toasts()).toEqual(["Tipo de OS atualizado."]);
  });

  it("erro ao salvar: a mensagem fica no painel e não há toast de sucesso", async () => {
    await abrir();
    await clicar($("table button[aria-label='Editar Visita técnica']"));
    await digitar(painel()!.querySelector("textarea"), "Qualquer");
    respostas["PATCH /api/cadastros/tipos-os/t2"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar(botao("Salvar"));
    expect(txt(painel()!.querySelector("[role='alert']"))).toBe("Sem permissão para esta ação");
    expect(await toasts()).toEqual([]);
  });

  it("inativar: mostra o impacto antes, só inativa ao confirmar e avisa; inativo oferece Reativar", async () => {
    await abrir(undefined, [T1, T3]);
    respostas["GET /api/cadastros/tipos-os/t1/impacto"] = { status: 200, corpo: { bloqueio: null, avisos: ["Em uso: 3 atividades de OS."], usos: [{ rotulo: "3 atividades de OS", total: 3 }] } };
    await clicar($("table tr[data-linha='t1'] button[aria-label='Inativar tipo de OS']"));
    expect(tituloDoPainel()).toBe("Inativar tipo de OS Manutenção preventiva?");
    expect(txt(painel()!.querySelector("[data-avisos]"))).toContain("Em uso: 3 atividades de OS.");
    expect(chamadas.some((c) => c.metodo === "DELETE")).toBe(false);
    respostas["DELETE /api/cadastros/tipos-os/t1"] = { status: 200, corpo: { ok: true } };
    await clicar(botao("Sim, inativar"));
    expect(chamadas.filter((c) => c.metodo === "DELETE").map((c) => c.url)).toEqual(["/api/cadastros/tipos-os/t1"]);
    expect(await toasts()).toEqual(["Tipo de OS inativado."]);
    // o inativo: sem "Inativar", com "Reativar"
    const inativo = $("table tr[data-linha='t3']")!;
    expect(inativo.querySelector("button[aria-label='Inativar tipo de OS']")).toBeNull();
    respostas["PATCH /api/cadastros/tipos-os/t3"] = { status: 200, corpo: { ...T3, ativo: true } };
    await clicar(inativo.querySelector("button[aria-label='Reativar tipo de OS']"));
    await clicar(botao("Reativar"));
    expect(chamadas.filter((c) => c.metodo === "PATCH")).toEqual([{ url: "/api/cadastros/tipos-os/t3", metodo: "PATCH", corpo: { ativo: true } }]);
    expect(await toasts()).toEqual(["Tipo de OS inativado.", "Tipo de OS reativado."]);
  });

  it("desistir de inativar não grava nem avisa", async () => {
    await abrir();
    respostas["GET /api/cadastros/tipos-os/t1/impacto"] = { status: 200, corpo: { bloqueio: null, avisos: ["Não está em uso em nenhum registro."], usos: [] } };
    await clicar($("table tr[data-linha='t1'] button[aria-label='Inativar tipo de OS']"));
    expect(txt(painel())).toContain("Não está em uso em nenhum registro.");
    await clicar(botao("Voltar"));
    expect(painel()).toBeNull();
    expect(chamadas.some((c) => c.metodo === "DELETE")).toBe(false);
    expect(await toasts()).toEqual([]);
  });
});

describe("Tipos de problema (portal) no padrão", () => {
  const P1 = { id: "p1", nome: "Ar não gela", ativo: true }, P2 = { id: "p2", nome: "Vazamento", ativo: true };
  async function abrir(permissoes?: Permissoes) {
    respostas["GET /api/cadastros/tipos-problema"] = pagina([P1, P2], { ativos: 2, inativos: 0, todos: 2 });
    const { TiposProblemaTela } = await import("@/components/cadastros/telas/tipos-problema");
    await montar(createElement(TiposProblemaTela), permissoes);
  }

  it("lista, abas, ⓘ e botões conforme a permissão", async () => {
    await abrir();
    expect($("[data-cadastro='tipos-problema']")).not.toBeNull();
    expect(linhas().map((l) => txt(l.querySelector("td")))).toEqual(["Ar não gela", "Vazamento"]);
    expect($$("[role='tab']").map(txt)).toEqual(["Ativos (2)", "Inativos (0)", "Todos (2)"]);
    expect(dica("Sobre tipos de problema")).toContain("As opções que o cliente escolhe ao abrir um chamado pelo portal");
    expect(txt($("[data-acao='novo-cadastro']"))).toBe("Novo tipo de problema");
    expect($$("table button[aria-label^='Editar ']")).toHaveLength(2);
    expect($$("table button[aria-label='Inativar tipo de problema']")).toHaveLength(2);
    expect($$("[data-cartoes] [data-cartao]")).toHaveLength(2);
    act(() => root.unmount()); caixa.remove();
    await abrir(SEM_CONFIG);
    expect(linhas()).toHaveLength(2);
    expect($("[data-acao='novo-cadastro']")).toBeNull();
    expect($$("button[aria-label^='Editar '], button[aria-label='Inativar tipo de problema']")).toHaveLength(0);
  });

  it("criar e editar gravam na rota padrão e avisam com toast", async () => {
    await abrir();
    await clicar($("[data-acao='novo-cadastro']"));
    await digitar(painel()!.querySelector("input"), "Ruído");
    respostas["POST /api/cadastros/tipos-problema"] = { status: 201, corpo: { id: "p9", nome: "Ruído", ativo: true } };
    await clicar(botao("Salvar"));
    expect(chamadas.find((c) => c.metodo === "POST")).toEqual({ url: "/api/cadastros/tipos-problema", metodo: "POST", corpo: { nome: "Ruído" } });
    await clicar($("table button[aria-label='Editar Vazamento']"));
    await digitar(painel()!.querySelector("input"), "Vazamento de água");
    respostas["PATCH /api/cadastros/tipos-problema/p2"] = { status: 200, corpo: { ...P2, nome: "Vazamento de água" } };
    await clicar(botao("Salvar"));
    expect(chamadas.find((c) => c.metodo === "PATCH")).toEqual({ url: "/api/cadastros/tipos-problema/p2", metodo: "PATCH", corpo: { nome: "Vazamento de água" } });
    expect(await toasts()).toEqual(["Tipo de problema criado.", "Tipo de problema atualizado."]);
  });

  it("na tela do portal, a seção 'Tipos de problema' é o cadastro padrão", async () => {
    respostas["GET /api/cadastros/tipos-problema"] = pagina([P1, P2]);
    const { TelaPortal } = await import("@/components/config/telas/portal");
    await montar(createElement(TelaPortal));
    const secao = $("[data-secao-tipos-problema]")!;
    expect(txt(secao.querySelector("h2"))).toBe("Tipos de problema");
    expect(secao.querySelector("[data-cadastro='tipos-problema']")).not.toBeNull();
    expect(secao.querySelectorAll("table tbody tr[data-linha]")).toHaveLength(2);
    // a lista antiga chamava /api/tipos-problema e listava tudo de uma vez
    expect(chamadas.some((c) => c.url.startsWith("/api/tipos-problema"))).toBe(false);
  });
});

describe("o mesmo esqueleto em todas as telas de cadastro de apoio", () => {
  const TELAS = [
    ["tipos-os", "TelaTiposOs", "Tipos de OS", "tipos-os", "/configuracoes"],
    ["tipos-equipamento", "TelaTiposEquipamento", "Tipos de equipamento", "tipos-equipamento", "/configuracoes"],
    ["categorias-produto", "TelaCategoriasProduto", "Categorias de produto", "categorias-produto", "/configuracoes"],
    ["categorias-financeiras", "TelaCategoriasFinanceiras", "Categorias financeiras", "categorias-financeiras", "/configuracoes"],
    ["centros-custo", "TelaCentrosCusto", "Centros de custo", "centros-custo", "/configuracoes/financeiras"],
    ["cargos", "TelaCargos", "Cargos", "cargos", "/configuracoes"],
    ["kits-material", "TelaKitsMaterial", "Kits de material", "kits-material", "/configuracoes"],
  ] as const;

  it.each(TELAS)("%s: cabeçalho → cartão → cadastro padrão; Novo só com permissão; nenhuma instrução solta", async (arquivo, exportado, titulo, entidade, voltar) => {
    const mod: any = await import(/* @vite-ignore */ `@/components/config/telas/${arquivo}`);
    await montar(createElement(mod[exportado]));
    const tela = $("[data-tela-cadastro-apoio]")!;
    expect(tela, "usa TelaCadastroApoio").not.toBeNull();
    // ordem do esqueleto: o cabeçalho vem antes do cartão, e o cadastro está dentro do cartão
    const [cabecalho, cartao] = [...tela.children];
    expect(tela.children).toHaveLength(2);
    expect(txt(cabecalho.querySelector("h1"))).toBe(titulo);
    expect(cabecalho.querySelector("[data-voltar]")!.getAttribute("href")).toBe(voltar);
    expect(txt(cabecalho.querySelector("p")).length).toBeGreaterThan(5);
    expect(cartao.className).toContain("rounded-card");
    expect(cartao.className).toContain("p-4 sm:p-6");
    expect(cartao.querySelector(`[data-cadastro='${entidade}']`)).not.toBeNull();
    // o padrão de lista: abas, busca e Novo
    expect($$("[role='tab']").map((t) => t.getAttribute("data-aba"))).toEqual(["ativos", "inativos", "todos"]);
    expect(cartao.querySelector("input[placeholder^='Pesquisar ']")).not.toBeNull();
    expect(txt($("[data-acao='novo-cadastro']"))).toMatch(/^Nov[oa] /);
    for (const p of tela.querySelectorAll("p")) if (!p.closest("[role='tooltip']")) expect(txt(p).length, txt(p)).toBeLessThan(110);
    // largura: nenhuma tela mais estreita que as outras
    for (let n: Element | null = tela; n && n !== caixa; n = n.parentElement) expect(n.className, "tela mais estreita que as outras").not.toMatch(/max-w-/);
    act(() => root.unmount()); caixa.remove();
    await montar(createElement(mod[exportado]), SEM_CONFIG);
    expect($("[data-tela-cadastro-apoio]")).not.toBeNull();
    expect($("[data-acao='novo-cadastro']")).toBeNull();
  });

  it("a lista antiga (CrudCadastro) não existe mais e ninguém a importa", () => {
    expect(existsSync(path.join(RAIZ, "components/config/crud-cadastro.tsx"))).toBe(false);
    const fontes: string[] = [];
    const andar = (dir: string) => {
      for (const n of readdirSync(dir)) {
        if (n === "node_modules" || n.startsWith(".")) continue;
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) andar(p); else if (/\.tsx?$/.test(n)) fontes.push(p);
      }
    };
    for (const d of ["app", "components", "lib"]) andar(path.join(RAIZ, d));
    const usam = fontes.filter((f) => /crud-cadastro|CrudCadastro\b/.test(readFileSync(f, "utf8"))).map((f) => path.relative(RAIZ, f));
    expect(usam).toEqual([]);
  });

  it("as rotas antigas de tipos só delegam ao cadastro padrão (uma regra só)", () => {
    for (const [f, entidade] of [["app/api/tipos-os/route.ts", "tipos-os"], ["app/api/tipos-os/[id]/route.ts", "tipos-os"], ["app/api/tipos-problema/route.ts", "tipos-problema"], ["app/api/tipos-problema/[id]/route.ts", "tipos-problema"]]) {
      const src = readFileSync(path.join(RAIZ, f), "utf8");
      expect(src, f).toMatch(new RegExp(`rotas(Colecao|Item)\\("${entidade}"`));
      expect(src, f).not.toMatch(/prisma\./);
    }
  });
});
