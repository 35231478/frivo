// @vitest-environment happy-dom
/**
 * Leva I.2 — grupo A, as telas num DOM de verdade (dados fictícios):
 *  1 — Empresas › "Nova senha do admin" (tabela e cartão do celular): confirmação, a senha aparece UMA vez com Copiar,
 *      Fechar descarta; cancelar não chama o servidor; erro do servidor vira aviso;
 *  2 — Empresas › "Editar": carrega os dados e o Histórico, máscara e validação do CNPJ, salva e atualiza a lista,
 *      erro do servidor (CNPJ em uso) aparece no modal;
 *  3 — a mensagem clara do e-mail já usado aparece na tela de acesso ao portal (o texto vem do servidor).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const avisos = vi.hoisted(() => ({ confirma: true, perguntas: [] as string[], toasts: [] as [string, string | undefined][] }));
vi.mock("@/components/ui/avisos", async (orig) => ({
  ...(await orig<typeof import("@/components/ui/avisos")>()),
  confirmar: vi.fn(async (o: { mensagem: string }) => { avisos.perguntas.push(o.mensagem); return avisos.confirma; }),
  toast: vi.fn((m: string, t?: string) => { avisos.toasts.push([m, t]); }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/admin/empresas", useSearchParams: () => new URLSearchParams(),
}));

let raiz: Root | null = null; let caixa: HTMLDivElement;
let pedidos: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, { status: number; corpo: unknown }> = {};
let copiado: string[] = [];
beforeEach(() => {
  pedidos = []; respostas = {}; copiado = []; avisos.confirma = true; avisos.perguntas = []; avisos.toasts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    pedidos.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
    const r = respostas[`${metodo} ${url}`] ?? { status: 404, corpo: { erro: "não mapeado" } };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { copiado.push(t); } } });
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, origin: "https://app.exemplo.test" } });
  caixa = document.createElement("div"); document.body.appendChild(caixa); raiz = createRoot(caixa);
});
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = null; caixa.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const digitar = async (sel: string, v: string) => {
  const el = $(sel) as HTMLInputElement;
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const enviar = async (sel: string) => { await act(async () => { ($(sel) as HTMLFormElement).requestSubmit(); }); await esperar(); };

const EMPRESAS = [
  { id: "e1", nome: "Frivo (fictícia)", nomeFantasia: null, cnpj: "45.723.174/0001-10", ativo: true, criadoEm: "2026-01-02T12:00:00.000Z", usuarios: 3 },
  { id: "e2", nome: "Refrigeração Aurora Ltda (fictícia)", nomeFantasia: "Aurora Clima", cnpj: "11.222.333/0001-81", ativo: true, criadoEm: "2026-11-27T12:00:00.000Z", usuarios: 1 },
];
async function montarEmpresas() {
  const { EmpresasAdmin } = await import("@/components/admin/empresas-admin");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  await act(async () => {
    raiz!.render(createElement(PermissoesProvider, { role: "SUPER_ADMIN", permissoes: permissoesTotais(), children: createElement(EmpresasAdmin, { inicial: EMPRESAS, empresaDoDono: "e1" }) }));
  });
  await esperar();
}

/* ───────────────────────── 1 ───────────────────────── */
describe("Empresas › Nova senha do admin", () => {
  const URL = "/api/admin/empresas/e2/nova-senha-admin";

  it("está na tabela e no cartão do celular de cada empresa", async () => {
    await montarEmpresas();
    expect(document.querySelectorAll('[data-lista-empresas] [data-nova-senha-admin]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-cartoes-empresas] [data-nova-senha-admin]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-cartoes-empresas] [data-editar-empresa]')).toHaveLength(2);
  });

  it("cancelar a confirmação não chama o servidor", async () => {
    await montarEmpresas();
    avisos.confirma = false;
    await clicar($('[data-lista-empresas] [data-nova-senha-admin="e2"]'));
    expect(avisos.perguntas[0]).toContain("Aurora Clima");
    expect(avisos.perguntas[0]).toContain("A senha atual deixa de valer.");
    expect(pedidos).toEqual([]);
  });

  it("confirma, gera e mostra a senha UMA vez com Copiar; Fechar descarta (não fica na tela)", async () => {
    respostas[`POST ${URL}`] = { status: 200, corpo: { ok: true, senha: "Abc23456defg", admin: { nome: "Marina Teste", email: "marina@aurora.teste" } } };
    await montarEmpresas();
    await clicar($('[data-cartoes-empresas] [data-nova-senha-admin="e2"]'));
    expect(pedidos).toEqual([{ url: URL, metodo: "POST", corpo: null }]);
    expect(texto($("[data-senha-admin]"))).toBe("Abc23456defg");
    expect(texto($("[data-senha-admin-gerada]"))).toContain("login marina@aurora.teste");
    expect(texto($("[data-aviso-senha-admin]"))).toContain("Aparece só agora. Copie e entregue ao administrador.");
    // O porquê fica na dica (ⓘ): a troca obrigatória e as sessões encerradas
    expect(texto($('[role="tooltip"]'))).toContain("No próximo acesso, o sistema pede que ele crie a própria senha.");
    expect(texto($("[data-senha-admin-gerada]"))).not.toMatch(/você/i);
    await clicar($("[data-copiar-senha-admin]"));
    expect(copiado).toEqual(["Abc23456defg"]);
    expect(texto($("[data-copiar-senha-admin]"))).toBe("Copiada");
    await clicar($("[data-fechar-senha-admin]"));
    expect($("[data-senha-admin]")).toBeNull();
    expect(texto()).not.toContain("Abc23456defg");
  });

  it("erro do servidor (sem administrador ativo) vira aviso e nenhuma senha aparece", async () => {
    respostas[`POST ${URL}`] = { status: 409, corpo: { erro: "A empresa não tem administrador ativo." } };
    await montarEmpresas();
    await clicar($('[data-lista-empresas] [data-nova-senha-admin="e2"]'));
    expect(avisos.toasts).toContainEqual(["A empresa não tem administrador ativo.", "erro"]);
    expect($("[data-senha-admin]")).toBeNull();
  });
});

/* ───────────────────────── 2 ───────────────────────── */
describe("Empresas › Editar", () => {
  const URL = "/api/admin/empresas/e2";
  const DADOS = { razaoSocial: "Refrigeração Aurora Ltda (fictícia)", nomeFantasia: "Aurora Clima", cnpj: "11.222.333/0001-81", email: "aurora@ficticio.test", telefone: null };
  const EVENTOS = [
    { id: "ev2", tipo: "DADOS_EDITADOS", detalhe: "Telefone: (vazio) → (11) 4000-0000\nE-mail: a@x.test → aurora@ficticio.test", criadoEm: "2026-11-27T15:00:00.000Z", autor: "Dono do Frivo" },
    { id: "ev1", tipo: "NOVA_SENHA_ADMIN", detalhe: "Para Marina Teste (marina@aurora.teste).", criadoEm: "2026-11-26T15:00:00.000Z", autor: "Dono do Frivo" },
  ];

  it("abre com os dados e o Histórico (mais novo primeiro, com quem fez)", async () => {
    respostas[`GET ${URL}`] = { status: 200, corpo: { empresa: DADOS, eventos: EVENTOS } };
    await montarEmpresas();
    await clicar($('[data-lista-empresas] [data-editar-empresa="e2"]'));
    expect(($('[data-editar-campo="razaoSocial"]') as HTMLInputElement).value).toBe(DADOS.razaoSocial);
    expect(($('[data-editar-campo="cnpj"]') as HTMLInputElement).value).toBe(DADOS.cnpj);
    expect(($('[data-editar-campo="telefone"]') as HTMLInputElement).value).toBe("");
    const itens = [...document.querySelectorAll("[data-evento-empresa]")].map((e) => e.getAttribute("data-evento-empresa"));
    expect(itens).toEqual(["DADOS_EDITADOS", "NOVA_SENHA_ADMIN"]);
    expect(texto($("[data-historico-empresa]"))).toContain("Dados editados");
    expect(texto($("[data-historico-empresa]"))).toContain("Dono do Frivo");
    expect(texto($("[data-historico-empresa]"))).toContain("Telefone: (vazio) → (11) 4000-0000");
  });

  it("máscara do CNPJ; CNPJ inválido não vai ao servidor; salvar manda os dados e atualiza a linha da lista", async () => {
    respostas[`GET ${URL}`] = { status: 200, corpo: { empresa: DADOS, eventos: [] } };
    respostas[`PUT ${URL}`] = { status: 200, corpo: { ok: true, alterado: true, empresa: { ...DADOS, razaoSocial: "Aurora Serviços Ltda (fictícia)", nomeFantasia: null, cnpj: "11.444.777/0001-61" } } };
    await montarEmpresas();
    await clicar($('[data-cartoes-empresas] [data-editar-empresa="e2"]'));
    expect($("[data-historico-vazio]")).toBeTruthy();
    await digitar('[data-editar-campo="cnpj"]', "11444777000100");
    expect(($('[data-editar-campo="cnpj"]') as HTMLInputElement).value).toBe("11.444.777/0001-00");
    await enviar("[data-form-editar-empresa]");
    expect(texto($("[data-erro-editar-empresa]"))).toBe("CNPJ inválido.");
    expect(pedidos.filter((p) => p.metodo === "PUT")).toEqual([]);

    await digitar('[data-editar-campo="cnpj"]', "11444777000161");
    await digitar('[data-editar-campo="razaoSocial"]', "Aurora Serviços Ltda (fictícia)");
    await digitar('[data-editar-campo="nomeFantasia"]', "");
    await enviar("[data-form-editar-empresa]");
    expect(pedidos.at(-1)).toEqual({ url: URL, metodo: "PUT", corpo: { razaoSocial: "Aurora Serviços Ltda (fictícia)", nomeFantasia: null, cnpj: "11.444.777/0001-61", email: "aurora@ficticio.test", telefone: null } });
    expect(avisos.toasts).toContainEqual(["Dados da empresa salvos.", undefined]);
    expect($("[data-form-editar-empresa]")).toBeNull();
    const linha = $('[data-lista-empresas] [data-empresa="e2"]');
    expect(texto(linha)).toContain("Aurora Serviços Ltda (fictícia)");
    expect(texto(linha)).toContain("11.444.777/0001-61");
  });

  it("erro do servidor (CNPJ de outra empresa) aparece no modal, que continua aberto", async () => {
    respostas[`GET ${URL}`] = { status: 200, corpo: { empresa: DADOS, eventos: [] } };
    respostas[`PUT ${URL}`] = { status: 409, corpo: { erro: "Já existe uma empresa com este CNPJ." } };
    await montarEmpresas();
    await clicar($('[data-lista-empresas] [data-editar-empresa="e2"]'));
    await digitar('[data-editar-campo="cnpj"]', "45723174000110");
    await enviar("[data-form-editar-empresa]");
    expect(texto($("[data-erro-editar-empresa]"))).toBe("Já existe uma empresa com este CNPJ.");
    expect($("[data-form-editar-empresa]")).toBeTruthy();
  });
});

/* ───────────────────────── 3 ───────────────────────── */
describe("E-mail já usado: a mensagem clara chega à tela", () => {
  it("acesso ao portal: o 409 do servidor aparece como está, e nenhuma senha é mostrada", async () => {
    const MSG = "Este e-mail já é acesso ao portal de outro contato do Frivo. Use outro e-mail.";
    respostas["PUT /api/clientes/cli1/contatos/ct1/acesso-portal"] = { status: 409, corpo: { erro: MSG } };
    const { PortalAcessoContato } = await import("@/components/forms/portal-acesso-contato");
    await act(async () => {
      raiz!.render(createElement(PortalAcessoContato, { clienteId: "cli1", contatoId: "ct1", contatoNome: "Paula Fictícia", emailInicial: "paula@clinica.test", whatsappInicial: null, temAcesso: false } as any));
    });
    await clicar([...document.querySelectorAll("button")].find((b) => texto(b).includes("Dar acesso ao portal")));
    await clicar([...document.querySelectorAll("button")].find((b) => texto(b).includes("Liberar acesso")));
    expect(texto()).toContain(MSG);
    expect($("[data-senha-gerada]")).toBeNull();
  });
});
