// @vitest-environment happy-dom
/**
 * COM-1 — "Minhas comissões" no app do técnico (Perfil): só aparece quando a empresa usa comissão; abre o
 * mesmo extrato do Meu perfil do painel; dentro de "Meus dados" a aba Comissões NÃO se repete.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EstadoSync } from "@/lib/tecnico/offline/motor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/push/notificacoes-aparelho", () => ({ NotificacoesAparelho: () => null }));

const EXTRATO = {
  ativo: true, totais: { prevista: 10, liberada: 5, paga: 0 },
  vendas: [{ chave: "o1", tipo: "VENDA", orcamentoId: "o1", codigo: "ORC-1", nome: "Limpeza fictícia", cliente: "Cliente Fictício", osNumero: null, prevista: 10, liberada: 5, paga: 0, itens: [{ descricao: "Limpeza", regra: "Todos · Todos os serviços · 5% da venda", valor: 15 }] }],
};

let root: Root; let caixa: HTMLDivElement;
let ativo = true;
const urls: string[] = [];
beforeEach(() => {
  urls.length = 0; ativo = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(String(url));
    const corpo = String(url) === "/api/perfil/comissoes?so=ativo" ? { ativo } : String(url) === "/api/perfil/comissoes" ? EXTRATO : {};
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

const esperar = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); }); };
const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const botao = (t: string) => [...caixa.querySelectorAll<HTMLButtonElement>("button")].find((b) => texto(b) === t);
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const estado = (): EstadoSync => ({ situacao: "sincronizado", pendentes: 0, erros: 0, ultimoSync: null, versao: 0 });
const motorFalso = () => ({ assinar: (fn: (e: EstadoSync) => void) => { fn(estado()); return () => {}; }, banco: { fila: async () => [], retratos: async () => [] } }) as any;

async function abrirPerfil() {
  const { ProvedorTecnico } = await import("@/components/tecnico/contexto");
  const { PerfilTecnico } = await import("@/components/tecnico/perfil");
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  root = createRoot(caixa);
  const perfilInicial = { nome: "João", email: "j@ficticio.test", avatar: null, empresaNome: "Clima Fictícia", perfilNome: null, cargo: "Técnico" } as any;
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: { id: "uTec", nome: "João", email: "j@ficticio.test", empresaNome: "Clima Fictícia", podeGravar: true }, motorPronto: motorFalso(), children: createElement(PerfilTecnico, { perfilInicial }) })); });
  await esperar();
}

describe("app do técnico › Perfil › Minhas comissões", () => {
  it("com comissão na empresa: a seção aparece fechada; abrir carrega o extrato (sem custo nem margem)", async () => {
    await abrirPerfil();
    expect(caixa.querySelector("[data-comissoes-app]")).toBeTruthy();
    expect(caixa.querySelector("[data-minhas-comissoes]")).toBeNull();
    expect(urls).not.toContain("/api/perfil/comissoes"); // o extrato (que recalcula) só quando abre
    await clicar(botao("Minhas comissões"));
    expect(urls).toContain("/api/perfil/comissoes");
    expect(texto(caixa.querySelector("[data-venda-comissao='o1']"))).toContain("ORC-1 · Limpeza fictícia");
    expect(texto(caixa.querySelector("[data-minhas-comissoes]"))).not.toMatch(/custo|margem/i);
  });

  it("dentro de Meus dados a aba Comissões não se repete (uma consulta só, a do Perfil do app)", async () => {
    await abrirPerfil();
    await clicar(botao("Meus dados"));
    expect([...caixa.querySelectorAll("[data-meus-dados-app] [data-aba]")].map((b) => b.textContent)).not.toContain("Comissões");
    expect(urls.filter((u) => u === "/api/perfil/comissoes?so=ativo")).toHaveLength(1);
  });

  it("empresa sem comissão: nada de comissão no app", async () => {
    ativo = false;
    await abrirPerfil();
    expect(caixa.querySelector("[data-comissoes-app]")).toBeNull();
    expect(texto(caixa)).not.toMatch(/comiss/i);
  });
});
