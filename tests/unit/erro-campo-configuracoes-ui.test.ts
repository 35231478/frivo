// @vitest-environment happy-dom
/**
 * ERRO NO CAMPO — Configurações › Dados da empresa e Preferências, num DOM de verdade:
 *  - CNPJ trocado e incompleto: o campo do CNPJ fica marcado (borda vermelha, aria-invalid) com a mensagem abaixo,
 *    recebe o foco, e nada vai para o servidor; corrigido, o erro some;
 *  - o CNPJ antigo (mesmo inválido) não trava o salvar dos outros campos (a regra do servidor);
 *  - e-mail vazio/errado fica no e-mail; dois erros: a faixa diz "2 campos para corrigir";
 *  - o erro do SERVIDOR ({ erro, campos }: CNPJ de outra empresa) cai no campo do CNPJ;
 *  - Preferências: ISS inválido marcado no campo; o erro do zod do servidor (detalhes/campos) também.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(),
}));

const GESTOR = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
const EMPRESA: any = {
  id: "e1", nome: "Polar Demo", nomeFantasia: null, cnpj: "12345678000190", email: "contato@polar.ficticio", telefone: null, celular: null, site: null, logo: null,
  endereco: null, numero: null, complemento: null, bairro: null, cidade: null, estado: null, cep: null, latitude: null, longitude: null,
  bancoNome: null, bancoAgencia: null, bancoConta: null, bancoTipoConta: null, bancoTitular: null, pixChave: null,
  inscricaoEstadual: null, inscricaoMunicipal: null, cnaePrincipal: null, responsavelTecnicoId: null,
};

let root: Root;
let caixa: HTMLDivElement;
let enviados: any[];
let resposta: { status: number; corpo: unknown };
beforeEach(() => {
  enviados = [];
  resposta = { status: 200, corpo: {} };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") enviados.push(JSON.parse(String(init.body)));
    const r = init?.method === "PUT" ? resposta : { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 40)); });
async function montar(parte: "empresa" | "preferencias") {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { ConfiguracoesClient } = await import("@/components/forms/configuracoes-client");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: GESTOR, children: createElement(ConfiguracoesClient, { empresa: EMPRESA, config: { issAliquota: 0 } as any, parte }) }));
  });
  await esperar();
}
const campo = (nome: string) => caixa.querySelector(`[data-campo-nome="${nome}"]`) as HTMLElement;
const controle = (nome: string) => campo(nome).querySelector("input, select, textarea") as HTMLInputElement;
const mensagem = (nome: string) => campo(nome).querySelector("[data-erro-campo]")?.textContent ?? null;
function digitar(el: HTMLInputElement, v: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function clicar(sel: string) {
  await act(async () => { caixa.querySelector<HTMLButtonElement>(sel)!.click(); });
  await esperar();
}

describe("Dados da empresa", () => {
  it("CNPJ trocado e incompleto: marcado no campo, com foco, e nada vai para o servidor; corrigido, some", async () => {
    await montar("empresa");
    digitar(controle("cnpj"), "11.222.333/0001");
    await clicar("[data-salvar-empresa]");
    expect(enviados).toHaveLength(0);
    const cnpj = controle("cnpj");
    expect(cnpj.getAttribute("aria-invalid")).toBe("true");
    expect(cnpj.className).toContain("border-atrasado");
    expect(mensagem("cnpj")).toBe("Informe os 14 dígitos do CNPJ.");
    expect(document.getElementById(cnpj.getAttribute("aria-describedby")!)!.textContent).toBe("Informe os 14 dígitos do CNPJ.");
    expect(document.activeElement).toBe(cnpj);
    // a faixa do topo repete o texto (um erro só) e o rótulo não fica vermelho
    expect(caixa.querySelector("[data-resumo-erros]")!.textContent).toBe("Informe os 14 dígitos do CNPJ.");
    expect(campo("cnpj").querySelector("label")!.className).not.toContain("atrasado");
    digitar(cnpj, "11.222.333/0001-81");
    expect(cnpj.getAttribute("aria-invalid")).toBeNull();
    expect(mensagem("cnpj")).toBeNull();
    expect(caixa.querySelector("[data-resumo-erros]")).toBeNull();
    await clicar("[data-salvar-empresa]");
    expect(enviados).toHaveLength(1);
  });

  it("o CNPJ antigo (mesmo inválido) não trava o salvar dos outros campos", async () => {
    await montar("empresa");
    digitar(controle("nomeFantasia"), "Polar");
    await clicar("[data-salvar-empresa]");
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ nomeFantasia: "Polar" });
  });

  it("dois erros (e-mail vazio + CNPJ errado): a faixa diz \"2 campos para corrigir\" e o foco vai no primeiro", async () => {
    await montar("empresa");
    digitar(controle("cnpj"), "11.222.333/0001-80");
    digitar(controle("email"), "");
    await clicar("[data-salvar-empresa]");
    expect(enviados).toHaveLength(0);
    const faixa = caixa.querySelector("[data-resumo-erros]")!;
    expect(faixa.textContent).toContain("2 campos para corrigir");
    expect(mensagem("cnpj")).toBe("CNPJ inválido: confira os dígitos.");
    expect(mensagem("email")).toBe("Informe o e-mail da empresa.");
    expect(document.activeElement).toBe(controle("cnpj"));
  });

  it("o erro do servidor cai no campo certo: CNPJ de outra empresa", async () => {
    await montar("empresa");
    digitar(controle("cnpj"), "11.222.333/0001-81");
    resposta = { status: 409, corpo: { erro: "Este CNPJ já é de outra empresa.", campos: { cnpj: "Este CNPJ já é de outra empresa." } } };
    await clicar("[data-salvar-empresa]");
    expect(enviados).toHaveLength(1);
    expect(mensagem("cnpj")).toBe("Este CNPJ já é de outra empresa.");
    expect(controle("cnpj").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(controle("cnpj"));
  });

  it("e-mail com formato errado: acusa ao sair do campo (não enquanto digita)", async () => {
    await montar("empresa");
    const email = controle("email");
    digitar(email, "contato@");
    expect(email.getAttribute("aria-invalid")).toBeNull();
    act(() => { email.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(mensagem("email")).toBe("E-mail inválido: confira o endereço.");
  });
});

describe("Preferências", () => {
  it("ISS que não é número: marcado no campo, sem ir ao servidor", async () => {
    await montar("preferencias");
    digitar(controle("issAliquota"), "5,0,1");
    await clicar("[data-salvar-preferencias]");
    expect(enviados).toHaveLength(0);
    expect(mensagem("issAliquota")).toBe("Valor inválido: use só números (ex.: 1.250,00).");
    expect(document.activeElement).toBe(controle("issAliquota"));
  });

  it("o erro do zod no servidor (`campos`) cai no ISS", async () => {
    await montar("preferencias");
    digitar(controle("issAliquota"), "150");
    resposta = { status: 400, corpo: { erro: "A alíquota de ISS vai de 0 a 100%", campos: { issAliquota: "A alíquota de ISS vai de 0 a 100%" } } };
    await clicar("[data-salvar-preferencias]");
    expect(enviados).toHaveLength(1);
    expect(mensagem("issAliquota")).toBe("A alíquota de ISS vai de 0 a 100%");
    expect(caixa.querySelector("[data-resumo-erros]")!.textContent).toBe("A alíquota de ISS vai de 0 a 100%");
  });
});
