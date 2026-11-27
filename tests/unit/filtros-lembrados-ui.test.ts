// @vitest-environment happy-dom
/**
 * Filtros lembrados na tela (components/listagem/use-filtros-lembrados), num DOM de verdade:
 *  - sair e voltar no MESMO DIA: a lista abre com o filtro escolhido (uma troca só de URL, sem a página);
 *  - outro dia: abre no padrão; outro usuário ou outra empresa no mesmo navegador: não herda;
 *  - link com parâmetros (compartilhado, do sino) vence o lembrado e passa a ser o lembrado;
 *  - "Limpar filtros" também é lembrado (volta limpa); sem sessão, não lembra; navegador sem armazenamento, não quebra;
 *  - todas as listas da barra de filtros ganham (nenhuma desliga o lembrado).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { permissoesTotais } from "@/lib/permissoes";
import { instanteBR } from "@/lib/fuso";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ replace: vi.fn(), qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: () => {}, replace: nav.replace, back: () => {} }),
  usePathname: () => "/ordens", useSearchParams: () => new URLSearchParams(nav.qs),
}));

const CHAVE = "frivo:filtros:e1:u1:ordens";
/** A lista (o mesmo componente o tempo todo: trocar a URL não remonta, como no app) */
let Lista: () => null;
let root: Root | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instanteBR(2026, 10, 27, 12)); // 27/11/2026, meio-dia em Brasília
  nav.replace.mockClear(); nav.qs = "";
  window.localStorage.clear();
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

async function abrir(qs = "", ids: { usuarioId?: string; empresaId?: string } = { usuarioId: "u1", empresaId: "e1" }) {
  nav.qs = qs;
  const { useFiltrosLembrados } = await import("@/components/listagem/use-filtros-lembrados");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  Lista ??= () => { useFiltrosLembrados("ordens"); return null; };
  if (root) act(() => root!.unmount());
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(), ...ids } as any, createElement(Lista))); });
}
/** A pessoa mudou o filtro: a URL nova chega ao hook */
async function mudarUrl(qs: string) {
  nav.qs = qs;
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  await act(async () => { root!.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(), usuarioId: "u1", empresaId: "e1" } as any, createElement(Lista))); });
}
const guardado = (chave = CHAVE) => JSON.parse(window.localStorage.getItem(chave) ?? "null");

describe("filtros lembrados (hook único das listas)", () => {
  it("escolheu o filtro, saiu e voltou no mesmo dia: abre com ele (sem a página), numa troca só de URL", async () => {
    await abrir();
    expect(nav.replace).not.toHaveBeenCalled();
    await mudarUrl("mes=2026-10&status=AGENDADA&tecnico=t1&q=bom&sort=numero&dir=asc&por=50&pagina=3");
    expect(guardado()).toEqual({ q: "mes=2026-10&status=AGENDADA&tecnico=t1&q=bom&sort=numero&dir=asc&por=50", dia: "2026-11-27" });
    // saiu e voltou (horas depois, no mesmo dia)
    vi.setSystemTime(instanteBR(2026, 10, 27, 23, 50));
    await abrir();
    expect(nav.replace.mock.calls).toEqual([["/ordens?mes=2026-10&status=AGENDADA&tecnico=t1&q=bom&sort=numero&dir=asc&por=50", { scroll: false }]]);
    // enquanto a URL ainda está vazia (restaurando), não grava o vazio por cima
    expect(guardado().q).toBe("mes=2026-10&status=AGENDADA&tecnico=t1&q=bom&sort=numero&dir=asc&por=50");
  });

  it("no dia seguinte (novo login de um dia para o outro): abre no padrão", async () => {
    window.localStorage.setItem(CHAVE, JSON.stringify({ q: "periodo=todos&status=CONCLUIDA", dia: "2026-11-27" }));
    vi.setSystemTime(instanteBR(2026, 10, 28, 0, 10));
    await abrir();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("outro usuário ou outra empresa no mesmo navegador não herda; sem sessão, não lembra nem grava", async () => {
    window.localStorage.setItem(CHAVE, JSON.stringify({ q: "periodo=todos", dia: "2026-11-27" }));
    await abrir("", { usuarioId: "u2", empresaId: "e1" });
    await abrir("", { usuarioId: "u1", empresaId: "e2" });
    expect(nav.replace).not.toHaveBeenCalled();
    // cada um grava na chave dele; a do u1 na e1 continua a mesma
    expect(Object.keys(window.localStorage).sort()).toEqual([CHAVE, "frivo:filtros:e1:u2:ordens", "frivo:filtros:e2:u1:ordens"]);
    expect(guardado().q).toBe("periodo=todos");
    window.localStorage.clear();
    await abrir("status=ABERTA", {});
    expect([nav.replace.mock.calls.length, window.localStorage.length]).toEqual([0, 0]);
  });

  it("link com parâmetros vence o lembrado e passa a ser o lembrado", async () => {
    window.localStorage.setItem(CHAVE, JSON.stringify({ q: "periodo=todos&status=CONCLUIDA", dia: "2026-11-27" }));
    await abrir("tecnico=sem&periodo=todos");
    expect(nav.replace).not.toHaveBeenCalled();
    expect(guardado()).toEqual({ q: "tecnico=sem&periodo=todos", dia: "2026-11-27" });
  });

  it("'Limpar filtros' também fica lembrado: voltar abre no padrão", async () => {
    await abrir("status=ABERTA");
    await mudarUrl("");
    expect(guardado()).toEqual({ q: "", dia: "2026-11-27" });
    await abrir();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("itens por página preferidos entram quando a URL não diz outro (na mesma troca)", async () => {
    const { CHAVE_TAMANHO_PAGINA } = await import("@/lib/listagem");
    window.localStorage.setItem(CHAVE_TAMANHO_PAGINA, "100");
    window.localStorage.setItem(CHAVE, JSON.stringify({ q: "status=ABERTA", dia: "2026-11-27" }));
    await abrir();
    expect(nav.replace.mock.calls).toEqual([["/ordens?status=ABERTA&por=100", { scroll: false }]]);
  });

  it("navegador sem armazenamento (modo privado, bloqueado): a lista abre no padrão, sem erro", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    await abrir();
    await mudarUrl("status=ABERTA");
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("um jeito só: todas as listas da barra de filtros ganham", () => {
  it("o hook é o do useListagemUrl (que serve o <ListaUrl>) e o da lista de OS; nenhuma lista desliga o lembrado", () => {
    const raiz = path.resolve(__dirname, "../..");
    expect(readFileSync(path.join(raiz, "components/listagem/use-listagem-url.ts"), "utf8")).toContain("useFiltrosLembrados(chave, lembrarFiltros)");
    expect(readFileSync(path.join(raiz, "components/ordens/ordens-lista-client.tsx"), "utf8")).toContain('useFiltrosLembrados("ordens")');
    const desligadas = execFileSync("sh", ["-c", "grep -rln 'lembrarFiltros: false\\|lembrarFiltros={false}' components app || true"], { cwd: raiz, encoding: "utf8" }).trim();
    expect(desligadas).toBe("");
  });
});
