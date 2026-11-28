// @vitest-environment happy-dom
/**
 * PJ4 — pontas soltas do colaborador (Leva J): as telas num DOM de verdade (happy-dom), API simulada, dados fictícios.
 *  - J5: a ficha não salva RT sem CREA (o campo é marcado obrigatório) — a mesma mensagem da rota;
 *  - J3: "Novo colaborador" da lista usa as duas chaves da ficha (sem o "Função" de 5 opções) e manda o par coerente;
 *  - J7: o celular do preenchimento automático com +55 não perde o fim;
 *  - J1: o código que não sai mostra uma mensagem amiga (nunca o erro do provedor);
 *  - J6: o "confirme o e-mail" do fim leva de volta à etapa Dados.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { DOCUMENTOS_PADRAO, MSG_EMAIL_NAO_VERIFICADO, formVazio } from "@/lib/admissao/admissao";
import { MSG_RT_SEM_CREA, ROTULO_CAMPO, ROTULO_RT } from "@/lib/colaborador/funcao";
import type { AdmissaoPublica } from "@/lib/admissao/admissao-server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/colaboradores", useSearchParams: () => new URLSearchParams(),
}));

let root: Root | null = null, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }> = {};
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = (sel: string, dentro: ParentNode = document) => dentro.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string, dentro: ParentNode = document) => [...dentro.querySelectorAll(sel)] as HTMLElement[];
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
async function escolher(el: Element | null, v: string) {
  expect(el, "select").toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET" && !c.url.startsWith("/api/preferencias"));

async function montar(el: ReactElement, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el })); });
  await esperar();
}

beforeAll(async () => {
  for (const m of [
    () => import("@/components/providers/permissoes-provider"), () => import("@/components/forms/colaborador-form"),
    () => import("@/app/(dashboard)/colaboradores/colaboradores-lista-client"), () => import("@/components/acoes-massa/selecao"),
    () => import("@/components/admissao/admissao-publica"),
  ]) await m();
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

describe("J5: a ficha não salva responsável técnico sem CREA", () => {
  it("RT ligado: o CREA é obrigatório (marca *); vazio não grava e diz o que falta; preenchido grava", async () => {
    const { ColaboradorForm } = await import("@/components/forms/colaborador-form");
    await montar(createElement(ColaboradorForm, { initialData: COLAB } as any));
    await clicar($("[data-aba='profissionais']"));
    await clicar($("[data-responsavel-tecnico] [role='switch']"));
    const rotulo = $$("label").find((l) => txt(l).startsWith("CREA / Registro profissional"));
    expect(txt(rotulo)).toBe("CREA / Registro profissional*");
    await clicar(botao("Salvar alterações"));
    expect(gravacoes()).toEqual([]);
    expect(document.body.textContent).toContain(MSG_RT_SEM_CREA);
    await digitar($("input[name='crea']"), "5012345-D/SP");
    await clicar(botao("Salvar alterações"));
    expect(gravacoes()[0].corpo).toMatchObject({ tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "CAMPO", crea: "5012345-D/SP" });
  });
});

describe("J3: 'Novo colaborador' da lista usa as duas chaves da ficha", () => {
  const FILTROS = { q: "", status: "todos", funcoes: [], cargo: "", equipe: "", aviso: "", ordem: "nome", dir: "asc", pagina: 1, porPagina: 50 };
  const RESUMO = { ativos: 0, inativos: 0, tecnicos: 0, semEquipe: 0, ausentes: 0, docVencido: 0, docVencendo: 0 };
  async function abrirNovo() {
    const { ColaboradoresListaClient } = await import("@/app/(dashboard)/colaboradores/colaboradores-lista-client");
    const { SelecaoMassaProvider } = await import("@/components/acoes-massa/selecao");
    const funcoes = ["TECNICO_CAMPO", "RESPONSAVEL_TECNICO", "ADMINISTRATIVO", "MOTORISTA", "OUTRO"].map((v) => ({ value: v, label: v }));
    await montar(createElement(SelecaoMassaProvider, { entidade: "colaboradores", idsPagina: [], total: 0, children: createElement(ColaboradoresListaClient, {
      itens: [], total: 0, filtros: FILTROS as any, opcoes: { funcoes, cargos: [], equipes: [] }, resumo: RESUMO,
    }) }), montarPermissoes({ equipes: ["visualizar", "gerenciar"] }));
    await clicar($("[data-novo-colaborador]"));
  }
  const dialogo = () => $$('[role="dialog"]').at(-1)!;
  const campo = (rotulo: string, tag = "input") => {
    const l = $$("label", dialogo()).find((x) => txt($("span", x)).replace(" *", "") === rotulo);
    expect(l, `rótulo "${rotulo}"`).toBeTruthy();
    return l!.querySelector(tag) as HTMLElement;
  };
  // o botão traz "Salvar" no celular e "Cadastrar colaborador" na tela larga
  const cadastrar = () => $$("button", dialogo()).find((b) => txt(b).endsWith("Cadastrar colaborador"));
  async function preencher() {
    await digitar(campo("Nome completo"), "Ana Souza");
    await digitar(campo("CPF"), "52998224725");
    await digitar(campo("Telefone"), "(11) 95555-5555");
  }

  it("sem o 'Função' de 5 opções; 'Usa o app de campo: Não' grava ADMINISTRATIVO/ADMINISTRATIVO", async () => {
    await abrirNovo();
    expect($$("label", dialogo()).map((l) => txt($("span", l)))).not.toContain("Função");
    expect($$("select", dialogo()).some((s) => [...(s as HTMLSelectElement).options].some((o) => o.value === "MOTORISTA"))).toBe(false);
    await preencher();
    await escolher(campo(ROTULO_CAMPO, "select"), "nao");
    respostas["POST /api/tecnicos"] = { status: 201, corpo: { id: "t9", nome: "Ana Souza" } };
    await clicar(cadastrar());
    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0].corpo).toMatchObject({ tipo: "ADMINISTRATIVO", tipoEquipe: "ADMINISTRATIVO" });
  });

  it("RT sem CREA não vai à rota; com o CREA vai coerente (de campo e RT)", async () => {
    await abrirNovo();
    await preencher();
    await escolher(campo(ROTULO_RT, "select"), "sim");
    await clicar(cadastrar());
    expect(gravacoes()).toEqual([]);
    expect(txt(dialogo())).toContain(MSG_RT_SEM_CREA);
    await digitar(campo("CREA (do responsável técnico)"), " 7001-D/SP ");
    respostas["POST /api/tecnicos"] = { status: 201, corpo: { id: "t9", nome: "Ana Souza" } };
    await clicar(cadastrar());
    expect(gravacoes()[0].corpo).toMatchObject({ tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "CAMPO", crea: "7001-D/SP" });
  });
});

const PUBLICA = (extra: Partial<AdmissaoPublica> = {}): AdmissaoPublica => ({
  situacao: "PREENCHENDO", etapa: null, expiraEm: "2026-11-23T12:00:00.000Z",
  empresa: "Clima Total", empresaLogo: null,
  colaborador: { nome: "Marina Alves", cpfMascarado: "***.982.247-**", cargo: "Técnica" },
  consentidoEm: "2026-11-16T12:00:00.000Z",
  form: { ...formVazio(), nome: "Marina Alves" },
  documentos: DOCUMENTOS_PADRAO, enviados: [], emailVerificado: null,
  faltando: [], etapaPendente: "DADOS", contrato: null, assinaturaEm: null, assinaturaNome: null,
  orientacoes: null,
  ...extra,
});
const abrirLink = async (inicial: AdmissaoPublica) => {
  const { AdmissaoPublicaCliente } = await import("@/components/admissao/admissao-publica");
  await montar(createElement(AdmissaoPublicaCliente, { token: "tok-abc", inicial }));
};

describe("o link da admissão", () => {
  it("J7: o celular do preenchimento automático '+55 11 98765-4321' fica 11 98765-4321 (antes: 55119876543)", async () => {
    await abrirLink(PUBLICA());
    await digitar($("[data-campo='telefone']"), "+55 11 98765-4321");
    expect($("[data-campo='telefone']")).toHaveProperty("value", "(11) 98765-4321");
    // digitado sem o país continua igual
    await digitar($("[data-campo='telefone']"), "11 98765-4321");
    expect($("[data-campo='telefone']")).toHaveProperty("value", "(11) 98765-4321");
  });

  it("J1: o código que não sai mostra a mensagem amiga, não o erro do provedor", async () => {
    const { MSG_CODIGO_NAO_ENVIADO } = await import("@/components/admissao/campos-admissao");
    await abrirLink(PUBLICA({ form: { ...formVazio(), nome: "Marina Alves", email: "marina@exemplo.com" } }));
    respostas["POST /api/publico/admissao/tok-abc/codigo"] = { status: 200, corpo: { enviado: false, para: "marina@exemplo.com", expiraEm: "", erro: "Template inativo." } };
    await clicar($("[data-pedir-codigo]"));
    expect(txt($("[data-email-aviso]"))).toBe(MSG_CODIGO_NAO_ENVIADO);
    expect(document.body.textContent).not.toContain("Template inativo");
  });

  it("J6: o 'confirme o e-mail' do fim volta à etapa Dados, onde está o código", async () => {
    const form = {
      ...formVazio(), nome: "Marina Alves Pereira", cpf: "52998224725", rg: "33.444.555-6", dataNascimento: "1995-04-12",
      nomeMae: "Rosa Alves", telefone: "11988887777", email: "marina@exemplo.com",
    };
    const inicial = PUBLICA({ form, etapa: "DEPENDENTES", etapaPendente: null });
    respostas["PUT /api/publico/admissao/tok-abc/rascunho"] = { status: 200, corpo: inicial };
    respostas["POST /api/publico/admissao/tok-abc/concluir"] = { status: 409, corpo: { erro: MSG_EMAIL_NAO_VERIFICADO } };
    await abrirLink(inicial);
    expect($("[data-admissao-etapa='DEPENDENTES']")).toBeTruthy();
    await clicar($("[data-concluir]"));
    expect(chamadas.some((c) => c.url.endsWith("/concluir"))).toBe(true);
    expect($("[data-admissao-etapa='DADOS']"), "voltou à etapa Dados").toBeTruthy();
    expect(txt($("[data-admissao-erro]"))).toBe(MSG_EMAIL_NAO_VERIFICADO);
    expect($("[data-pedir-codigo]"), "o botão do código à vista").toBeTruthy();
  });
});
