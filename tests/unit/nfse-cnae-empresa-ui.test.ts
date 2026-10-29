// @vitest-environment happy-dom
/**
 * NFS-e — "CNAE principal" em Configurações › Dados da empresa, num DOM de verdade:
 * mostra formatado (4322-3/02), salva junto com o resto da empresa; sem Financeiro › Fiscal fica
 * só leitura (o servidor confere de novo); ADMIN edita.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(),
}));

const GESTOR = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
const GESTOR_FISCAL = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], financeiro: ["visualizar", "fiscal"] });
const EMPRESA: any = {
  id: "e1", nome: "Clima Total", nomeFantasia: null, cnpj: "12345678000190", email: "e@x.com", telefone: null, celular: null, site: null, logo: null,
  endereco: null, numero: null, complemento: null, bairro: null, cidade: null, estado: null, cep: null, latitude: null, longitude: null,
  bancoNome: null, bancoAgencia: null, bancoConta: null, bancoTipoConta: null, bancoTitular: null, pixChave: null,
  inscricaoEstadual: null, inscricaoMunicipal: null, cnaePrincipal: "4322302", responsavelTecnicoId: null,
};

let root: Root;
let caixa: HTMLDivElement;
let enviados: any[];
beforeEach(() => {
  enviados = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") enviados.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(permissoes: Permissoes, empresa = EMPRESA, role = "OPERADOR") {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { ConfiguracoesClient } = await import("@/components/forms/configuracoes-client");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role, permissoes, children: createElement(ConfiguracoesClient, { empresa, config: { issAliquota: 0 } as any, parte: "empresa" }) }));
  });
  await esperar();
}
const cnae = () => caixa.querySelector('[data-campo="cnae-principal"]') as HTMLInputElement;
const ajuda = () => (cnae().closest(".flex-col")!.querySelector(":scope > p")?.textContent ?? "");
async function salvarEmpresa() {
  const b = [...caixa.querySelectorAll("button")].find((x) => /Salvar/.test(x.textContent ?? ""))!;
  await act(async () => { b.click(); });
  await esperar();
}

describe("CNAE principal da empresa", () => {
  it("formatado, editável com o Fiscal, vai no salvar", async () => {
    await montar(GESTOR_FISCAL);
    expect(cnae().value).toBe("4322-3/02");
    expect(cnae().disabled).toBe(false);
    expect(ajuda()).toBe("Os serviços sem CNAE próprio usam este na NFS-e. Ex.: 4322-3/02");
    const label = caixa.querySelector(`label[for="${cnae().id}"]`);
    expect(label?.textContent).toBe("CNAE principal");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(cnae(), "4321-5/00");
      cnae().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await salvarEmpresa();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ nome: "Clima Total", cnaePrincipal: "4321-5/00" });
  });

  it("empresa sem CNAE: campo vazio", async () => {
    await montar(GESTOR_FISCAL, { ...EMPRESA, cnaePrincipal: null });
    expect(cnae().value).toBe("");
    expect(cnae().placeholder).toBe("Ex.: 4322-3/02");
  });

  it("sem Financeiro › Fiscal: só leitura com o aviso; o valor gravado volta igual (o servidor aceita)", async () => {
    await montar(GESTOR);
    expect(cnae().disabled).toBe(true);
    expect(ajuda()).toBe("Só leitura: alterar exige a permissão Financeiro › Fiscal (NFS-e).");
    await salvarEmpresa();
    expect(enviados[0].cnaePrincipal).toBe("4322-3/02");
  });

  it("ver o Financeiro não basta: precisa do Fiscal", async () => {
    await montar(montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], financeiro: ["visualizar", "medicoes", "contasReceber"] }));
    expect(cnae().disabled).toBe(true);
  });

  it("ADMIN edita mesmo sem o Fiscal no perfil", async () => {
    await montar(GESTOR, EMPRESA, "ADMIN");
    expect(cnae().disabled).toBe(false);
  });
});
