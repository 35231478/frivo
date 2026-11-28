// @vitest-environment happy-dom
/**
 * ERRO NO CAMPO — ficha do colaborador e acesso ao app (colaborador-form + acesso-app-colaborador), num DOM de verdade:
 *  - salvar com erro marca o campo (aria-invalid + mensagem logo abaixo, ligada por aria-describedby) e foca o 1º;
 *  - o erro em OUTRA aba (CREA do responsável técnico em "Dados profissionais"): a aba ganha o ponto vermelho, abre
 *    sozinha e o campo recebe o foco; some assim que a pessoa digita;
 *  - o erro do servidor ({ erro, campos }) cai no campo certo (CPF já cadastrado → CPF), mesmo estando em outra aba;
 *  - formato ao sair do campo (CPF incompleto);
 *  - acesso ao app: senha inicial que falta e e-mail de login em uso ficam nos campos.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";
import { MSG_RT_SEM_CREA } from "@/lib/colaborador/funcao";
import { MSG_FORMATO } from "@/lib/forms/erros";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/colaboradores", useSearchParams: () => new URLSearchParams(),
}));

let root: Root | null = null, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }> = {};
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 40)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (t: string) => [...document.querySelectorAll("button")].filter((b) => txt(b) === t).at(-1) ?? null;
async function digitar(el: Element | null, v: string) {
  expect(el, "campo").toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
const sair = (el: Element) => act(async () => { el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET" && !c.url.startsWith("/api/preferencias"));
const mensagemDe = (el: Element) => txt(document.getElementById(el.getAttribute("aria-describedby")!.split(" ").find((id) => id.endsWith("-erro"))!));

async function montar(el: ReactElement) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: el })); });
  await esperar();
}

beforeAll(async () => {
  await import("@/components/providers/permissoes-provider");
  await import("@/components/forms/colaborador-form");
}, 120_000);
beforeEach(() => {
  chamadas.length = 0; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).find((k) => { const [m, u] = k.split(" "); return m === metodo && url.split("?")[0] === u; });
    const r = chave ? respostas[chave] : { status: 200, corpo: String(url).startsWith("/api/cadastros") || url === "/api/tipos-os" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); root = null; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const COLAB: any = {
  id: "t1", nome: "Carlos Oliveira", cpf: "529.982.247-25", telefone: "(11) 3333-4444", ativo: true, statusColaborador: "ATIVO",
  tipo: "TECNICO_CAMPO", tipoEquipe: "CAMPO", competencias: [], documentos: [], especialidades: [],
  jornadaFaixas: null, jornadaEntrada: "08:00", jornadaSaida: "18:00", jornadaDias: ["SEG"],
};
const painel = (id: string) => $(`[data-aba-painel="${id}"]`)!;
const escondido = (id: string) => painel(id).className.split(/\s+/).includes("hidden");

describe("ficha do colaborador", () => {
  it("cadastro novo vazio: os campos obrigatórios ficam marcados, com a mensagem abaixo, e o 1º recebe o foco", async () => {
    const { ColaboradorForm } = await import("@/components/forms/colaborador-form");
    await montar(createElement(ColaboradorForm, {} as any));
    await clicar(botao("Cadastrar colaborador"));
    expect(gravacoes()).toEqual([]);
    const nome = $("input[name='nome']")!;
    expect(nome.getAttribute("aria-invalid")).toBe("true");
    expect(mensagemDe(nome)).toBe("Nome deve ter pelo menos 2 caracteres");
    expect(nome.closest("[data-campo-nome='nome']")!.querySelector("[data-erro-campo]")).toBeTruthy();
    expect($("input[name='cpf']")!.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(nome);
    // a faixa é o resumo; a aba Dados pessoais conta os erros
    expect(txt($("[data-resumo-erros]"))).toContain("campos para corrigir");
    expect(Number(txt($("[data-aba='pessoais'] [data-erro-aba]")).replace(/\D/g, ""))).toBeGreaterThanOrEqual(3);
    // corrigiu o nome: o erro dele some na hora
    await digitar(nome, "Ana Souza");
    expect(nome.getAttribute("aria-invalid")).toBeNull();
  });

  it("CREA que falta, salvando de outra aba: a aba Profissionais ganha o ponto, abre sozinha e o CREA recebe o foco", async () => {
    const { ColaboradorForm } = await import("@/components/forms/colaborador-form");
    await montar(createElement(ColaboradorForm, { initialData: COLAB } as any));
    await clicar($("[data-aba='profissionais']"));
    await clicar($("[data-responsavel-tecnico] [role='switch']"));
    await clicar($("[data-aba='pessoais']"));
    expect(escondido("profissionais")).toBe(true);
    await clicar(botao("Salvar alterações"));
    expect(gravacoes()).toEqual([]);
    expect(txt($("[data-aba='profissionais'] [data-erro-aba]"))).toBe("1 erro");
    expect(escondido("profissionais")).toBe(false);
    const crea = $("input[name='crea']")!;
    expect(crea.getAttribute("aria-invalid")).toBe("true");
    expect(mensagemDe(crea)).toBe(MSG_RT_SEM_CREA);
    expect(document.activeElement).toBe(crea);
    expect(txt($("[data-resumo-erros]"))).toBe(MSG_RT_SEM_CREA);
    await digitar(crea, "5012345-D/SP");
    expect(crea.getAttribute("aria-invalid")).toBeNull();
    expect($("[data-aba='profissionais'] [data-erro-aba]")).toBeNull();
    expect($("[data-resumo-erros]")).toBeNull();
  });

  it("erro do servidor no campo certo: CPF já cadastrado marca o CPF (abrindo Dados pessoais)", async () => {
    const { ColaboradorForm } = await import("@/components/forms/colaborador-form");
    await montar(createElement(ColaboradorForm, { initialData: COLAB } as any));
    respostas["PUT /api/tecnicos/t1"] = { status: 409, corpo: { erro: "CPF já cadastrado", campos: { cpf: "CPF já cadastrado" } } };
    await clicar($("[data-aba='profissionais']"));
    await clicar(botao("Salvar alterações"));
    expect(gravacoes()).toHaveLength(1);
    expect(escondido("pessoais")).toBe(false);
    const cpf = $("input[name='cpf']")!;
    expect(cpf.getAttribute("aria-invalid")).toBe("true");
    expect(mensagemDe(cpf)).toBe("CPF já cadastrado");
    expect(document.activeElement).toBe(cpf);
    expect(txt($("[data-aba='pessoais'] [data-erro-aba]"))).toBe("1 erro");
  });

  it("CPF incompleto: acusa ao SAIR do campo (não enquanto digita)", async () => {
    const { ColaboradorForm } = await import("@/components/forms/colaborador-form");
    await montar(createElement(ColaboradorForm, {} as any));
    const cpf = $("input[name='cpf']")!;
    await digitar(cpf, "529.982");
    expect(cpf.getAttribute("aria-invalid")).toBeNull();
    await sair(cpf);
    expect(cpf.getAttribute("aria-invalid")).toBe("true");
    expect(mensagemDe(cpf)).toBe(MSG_FORMATO.cpfIncompleto);
    await digitar(cpf, "529.982.247-25");
    expect(cpf.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("acesso ao app", () => {
  const props = (temLogin = false) => ({ tecnicoId: "t1", emailSalvo: "carlos@polar.ficticio", inicial: { temLogin, acessoAtivo: false, role: null } });

  it("ligar sem a senha inicial: a senha fica marcada, com foco; digitar tira o erro", async () => {
    const { AcessoAppColaborador } = await import("@/components/forms/acesso-app-colaborador");
    await montar(createElement(AcessoAppColaborador, props()));
    await clicar($("[data-acesso-app] [role='switch']"));
    await clicar($("[data-acesso-salvar]"));
    expect(gravacoes()).toEqual([]);
    const senha = $("[data-acesso-senha]")!;
    expect(senha.getAttribute("aria-invalid")).toBe("true");
    expect(mensagemDe(senha)).toBe("Defina uma senha inicial para liberar o acesso.");
    expect(document.activeElement).toBe(senha);
    await digitar(senha, "Polar2027!");
    expect(senha.getAttribute("aria-invalid")).toBeNull();
  });

  it("e-mail de login em uso (servidor): cai no e-mail de login, não só numa faixa", async () => {
    const { AcessoAppColaborador } = await import("@/components/forms/acesso-app-colaborador");
    await montar(createElement(AcessoAppColaborador, props()));
    respostas["PUT /api/tecnicos/t1/acesso"] = { status: 409, corpo: { erro: "E-mail já usado.", campos: { email: "E-mail já usado." } } };
    await clicar($("[data-acesso-app] [role='switch']"));
    await digitar($("[data-acesso-senha]"), "Polar2027!");
    await clicar($("[data-acesso-salvar]"));
    expect(gravacoes()).toHaveLength(1);
    const email = $("[data-acesso-email]")!;
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(mensagemDe(email)).toBe("E-mail já usado.");
    expect(txt($("[data-resumo-erros]"))).toBe("E-mail já usado.");
  });
});
