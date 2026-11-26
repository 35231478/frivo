// @vitest-environment happy-dom
/**
 * ACESSO ATUAL nas telas: o que a pessoa vê quando o administrador concede ou retira acesso com a
 * sessão dela aberta (as regras estão em acesso-atual.test.ts e sessao-acesso-atual.test.ts).
 *
 *  - /sem-permissao: veio barrada pelo portão (cookie antigo), mas o cadastro JÁ libera o endereço?
 *    Mostra "Atualizando o seu acesso…", regrava o cookie e volta para lá. Não libera? A recusa de
 *    sempre. `de` de fora do sistema é ignorado; módulo desligado não muda;
 *  - LiberarAcesso: uma tentativa por endereço (se falhar, a recusa — nunca um laço);
 *  - SincronizarAcesso (no layout do painel): com o aviso do servidor, regrava o cookie e recarrega;
 *    sem aviso, confere ao navegar (a cada 30 s no máximo) e ao voltar para a aba;
 *  - editor de perfil: "Módulos visíveis" conta Admissão digital e Documentos (não têm "visualizar").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { montarPermissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const RAIZ = path.resolve(__dirname, "../..");
const fonte = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");

const nav = vi.hoisted(() => ({ refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), push: vi.fn(), pathname: "/ordens" }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav, usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(),
  redirect: (u: string) => { throw new Error(`NEXT_REDIRECT ${u}`); }, notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: any) => { sessao.atual = { user: { id: "u1", empresaId: "e1", role: "OPERADOR", permissoes } }; };
const RH = montarPermissoes({ admissao: ["gerenciar"] });

let root: Root | null = null, caixa: HTMLDivElement | null = null;
async function montar(el: any) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(el); });
  return caixa;
}
async function desmontar() { await act(async () => root?.unmount()); caixa?.remove(); root = null; caixa = null; }
const esperar = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let respostaSessao: any;
const fetchMock = vi.fn(async () => ({ ok: true, json: async () => respostaSessao }) as any);
let substituir: ReturnType<typeof vi.fn>;
beforeEach(() => {
  respostaSessao = { user: { acessoMudou: false } };
  fetchMock.mockClear(); nav.refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  substituir = vi.fn();
  vi.spyOn(window.location, "replace").mockImplementation(substituir as any);
  sessionStorage.clear();
  localStorage.setItem("frivo:sessao-renovada", String(Date.now())); // por padrão, renovada agora
});
afterEach(async () => { await desmontar(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

/* ───────────────────────── /sem-permissao ───────────────────────── */

const paginaSemPermissao = async (sp: Record<string, string>) => {
  const { default: P } = await import("@/app/(dashboard)/sem-permissao/page");
  return P({ searchParams: Promise.resolve(sp) });
};

describe("/sem-permissao confere no cadastro de onde a pessoa veio", () => {
  it("o portão barrou com o cookie antigo, mas o cadastro já libera: atualiza o acesso e volta ao endereço", async () => {
    como(RH);
    await montar(await paginaSemPermissao({ de: "/admissoes" }));
    expect(caixa!.querySelector("[data-liberando-acesso]")?.textContent).toContain("Atualizando o seu acesso");
    await esperar();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({ cache: "no-store" }));
    expect(substituir).toHaveBeenCalledWith("/admissoes");
  });

  it("o cadastro também não libera: a recusa de sempre, sem tentar nada", async () => {
    como(montarPermissoes({ equipes: ["visualizar"] }));
    const html = renderToStaticMarkup(await paginaSemPermissao({ de: "/admissoes" }));
    expect(html).toContain("Sem permissão para esta área");
    expect(html).not.toContain("data-liberando-acesso");
  });

  it("`de` de fora do sistema é ignorado: nada de redirecionar para outro site", async () => {
    como(RH);
    for (const de of ["//outro.com/admissoes", "https://outro.com", "/sem-permissao"]) {
      const html = renderToStaticMarkup(await paginaSemPermissao({ de }));
      expect(html, de).toContain("Sem permissão para esta área");
      expect(html, de).not.toContain("data-liberando-acesso");
    }
  });

  it("módulo desligado pela empresa continua sendo outra conversa (nem consulta a sessão)", async () => {
    como(RH);
    const html = renderToStaticMarkup(await paginaSemPermissao({ modulo: "frota", de: "/veiculos" }));
    expect(html).not.toContain("data-liberando-acesso");
  });

  it("sem `de` (a página que se guarda sozinha mandou para cá): a recusa", async () => {
    como(RH);
    expect(renderToStaticMarkup(await paginaSemPermissao({}))).toContain("Sem permissão para esta área");
  });
});

describe("LiberarAcesso: uma tentativa por endereço, nunca um laço", () => {
  it("se voltou para cá logo depois de tentar, mostra a recusa em vez de tentar de novo", async () => {
    const { LiberarAcesso } = await import("@/components/acesso/liberar-acesso");
    sessionStorage.setItem("frivo:liberar-acesso:/admissoes", String(Date.now()));
    await montar(createElement(LiberarAcesso, { destino: "/admissoes", children: createElement("p", { "data-recusa": true }, "Sem permissão") }));
    await esperar();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(substituir).not.toHaveBeenCalled();
    expect(caixa!.querySelector("[data-recusa]")).not.toBeNull();
  });

  it("sem conexão: a recusa (não fica girando)", async () => {
    const { LiberarAcesso } = await import("@/components/acesso/liberar-acesso");
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await montar(createElement(LiberarAcesso, { destino: "/admissoes", children: createElement("p", { "data-recusa": true }, "Sem permissão") }));
    await esperar();
    expect(substituir).not.toHaveBeenCalled();
    expect(caixa!.querySelector("[data-recusa]")).not.toBeNull();
  });
});

/* ───────────────────────── SincronizarAcesso ───────────────────────── */

describe("SincronizarAcesso: o cookie (que o portão lê) acompanha o cadastro", () => {
  const montarSinc = async (mudou: boolean) => {
    const { SincronizarAcesso } = await import("@/components/acesso/sincronizar-acesso");
    await montar(createElement(SincronizarAcesso, { mudou }));
    await esperar();
    return SincronizarAcesso;
  };

  it("o servidor avisou que o cookie está desatualizado: regrava (lê a sessão) e recarrega os dados", async () => {
    await montarSinc(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("sem aviso e sessão renovada há menos de 1 hora: não consulta nada ao abrir a página", async () => {
    localStorage.setItem("frivo:sessao-renovada", String(Date.now() - 10 * 60_000));
    await montarSinc(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("renovação: ao abrir o painel sem renovação na última hora, lê a sessão uma vez (o middleware não regrava o cookie)", async () => {
    localStorage.setItem("frivo:sessao-renovada", String(Date.now() - 61 * 60_000));
    await montarSinc(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(nav.refresh, "nada mudou: não recarrega").not.toHaveBeenCalled();
    expect(Number(localStorage.getItem("frivo:sessao-renovada"))).toBeGreaterThan(Date.now() - 5_000);
  });

  it("ao navegar depois de 30 s confere; só recarrega se o acesso mudou", async () => {
    const agora = Date.now();
    const relogio = vi.spyOn(Date, "now").mockReturnValue(agora);
    const S = await montarSinc(false);
    // navegação logo em seguida: não confere
    nav.pathname = "/clientes";
    await act(async () => { root!.render(createElement(S, { mudou: false })); });
    expect(fetchMock).not.toHaveBeenCalled();
    // 31 s depois: confere; nada mudou → não recarrega
    relogio.mockReturnValue(agora + 31_000);
    nav.pathname = "/equipamentos";
    await act(async () => { root!.render(createElement(S, { mudou: false })); });
    await esperar();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(nav.refresh).not.toHaveBeenCalled();
    // mais 31 s, e o administrador mudou o perfil nesse meio-tempo → recarrega
    respostaSessao = { user: { acessoMudou: true } };
    relogio.mockReturnValue(agora + 62_000);
    nav.pathname = "/ordens";
    await act(async () => { root!.render(createElement(S, { mudou: false })); });
    await esperar();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("ao voltar para a aba depois de 10 s confere; sessão encerrada (usuário inativado) recarrega para sair", async () => {
    const agora = Date.now();
    const relogio = vi.spyOn(Date, "now").mockReturnValue(agora);
    await montarSinc(false);
    relogio.mockReturnValue(agora + 11_000);
    respostaSessao = null;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await esperar();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("o middleware não regrava o cookie em /api/auth/* (competiria com o cookie novo da sessão)", () => {
    const m = fonte("middleware.ts");
    expect(m).toMatch(/"\/\(\(\?!_next\/static\|_next\/image\|api\/auth\/\|/);
  });

  it("o middleware lê a sessão mas não regrava o cookie dela (regra em acesso-atual.test.ts)", () => {
    const m = fonte("middleware.ts");
    expect(m).toContain("return res ? semCookieDaSessao(res) : res;");
  });

  it("está no layout do painel — no escritório e no modo técnico", () => {
    const layout = fonte("app/(dashboard)/layout.tsx");
    expect(layout.match(/<SincronizarAcesso mudou=\{session\.user\.acessoMudou === true\} \/>/g)?.length).toBe(2);
  });
});

/* ───────────────────────── menu e editor de perfil ───────────────────────── */

describe("menu e editor de perfil seguem a regra do portão", () => {
  it("o menu decide com a mesma função do portão (podeEntrarNoModulo), não com \"visualizar\" fixo", () => {
    const menu = fonte("components/layout/sidebar.tsx");
    expect(menu).toContain("return podeEntrarNoModulo(permissoes, m, role) && (!i.acao || pode(permissoes, m, i.acao, role));");
    expect(menu).not.toContain('pode(permissoes, m, "visualizar", role)');
  });

  it("\"Módulos visíveis com este perfil\" conta Admissão digital e Documentos (antes nunca apareciam)", async () => {
    const { EditorPerfil } = await import("@/components/cadastros/editores/editor-perfil");
    const item = { id: "p1", nome: "RH", tipo: "PERSONALIZADO", cor: "#8B5CF6", descricao: "", permissoes: montarPermissoes({ admissao: ["gerenciar"], documentos: ["enviar"] }) };
    await montar(createElement(EditorPerfil, { item, aberto: true, onFechar: () => {}, onSalvo: () => {} } as any));
    const resumo = document.body.querySelector("[data-resumo-visibilidade]")!.textContent!;
    expect(resumo).toContain("Admissão digital");
    expect(resumo).toContain("Documentos do colaborador");
    expect(resumo).not.toContain("apenas o Dashboard");
  });
});
