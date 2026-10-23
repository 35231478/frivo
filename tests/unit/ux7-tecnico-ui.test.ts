// @vitest-environment happy-dom
/**
 * UX-7 "Polimento do app técnico" — num DOM de verdade:
 *  - Y10: a miniatura de foto tem botão REMOVER com rótulo honesto ("Remover foto 1",
 *    não "Tirar foto 1", que soa como fotografar) e hitbox ampliada;
 *  - Y11: a tela de Usuários avisa quando um usuário com papel Técnico não tem técnico
 *    ativo com o mesmo e-mail (cairia no sistema comum "vazio", não no app do técnico).
 *
 * Y8 (pendência do banner clicável), Y9 (Foto ✓), G11 (legenda do progresso) e G13 (local
 * no select do extra) são cobertos no fluxo real em app-tecnico-ui.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => {
  let sp = new URLSearchParams("");
  const ouvintes = new Set<() => void>();
  return {
    get sp() { return sp; },
    definir(qs: string) { sp = new URLSearchParams(qs); ouvintes.forEach((f) => f()); },
    assinar(f: () => void) { ouvintes.add(f); return () => { ouvintes.delete(f); }; },
  };
});
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSearchParams: () => useSyncExternalStore(nav.assinar, () => nav.sp, () => nav.sp),
    usePathname: () => "/configuracoes/usuarios",
    useRouter: () => ({ replace: (u: string) => nav.definir(u.split("?")[1] ?? ""), push: () => {}, refresh: () => {} }),
  };
});

let root: Root; let caixa: HTMLDivElement;
const esperar = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];

async function montar(el: any) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

describe("Y10: miniatura de foto", () => {
  it("o botão da miniatura REMOVE (rótulo honesto) e chama onRemover", async () => {
    const { Miniatura } = await import("@/components/tecnico/captura");
    const removeu = vi.fn();
    await montar(createElement(Miniatura, { src: "data:image/jpeg;base64,Zm90bw==", alt: "foto 1", onRemover: removeu }));
    expect($('button[aria-label="Tirar foto 1"]')).toBeNull(); // "Tirar" soava como fotografar
    const botao = $('button[aria-label="Remover foto 1"]');
    expect(botao).not.toBeNull();
    expect(botao!.className).toContain("before:-inset"); // hitbox ampliada para o dedo
    await act(async () => { botao!.click(); });
    expect(removeu).toHaveBeenCalledTimes(1);
  });
});

describe("Y11: tela de Usuários", () => {
  const USUARIOS = [
    // Caixa diferente de propósito: a comparação não pode diferenciar maiúsculas
    { id: "u1", nome: "Fernanda Técnica", email: "Fernanda@X.com", role: "TECNICO", ativo: true, perfilAcesso: null, ultimoAcesso: null },
    { id: "u2", nome: "Carlos Técnico", email: "carlos@x.com", role: "TECNICO", ativo: true, perfilAcesso: null, ultimoAcesso: null },
    { id: "u3", nome: "Olivia Operadora", email: "olivia@x.com", role: "OPERADOR", ativo: true, perfilAcesso: { id: "pf1", nome: "Operação", cor: "#0EA5E9", ativo: true }, ultimoAcesso: null },
    // Inativo não precisa de aviso: não entra em lugar nenhum mesmo
    { id: "u4", nome: "Tiago Inativo", email: "tiago@x.com", role: "TECNICO", ativo: false, perfilAcesso: null, ultimoAcesso: null },
  ];
  const pagina = { itens: USUARIOS, total: 4, pagina: 1, porPagina: 25, contagens: { ativos: 3, inativos: 1, todos: 4 } };

  it("avisa SÓ o papel Técnico sem técnico ativo com o mesmo e-mail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => pagina })));
    const { UsuariosTela } = await import("@/components/cadastros/telas/usuarios");
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    const { permissoesTotais } = await import("@/lib/permissoes");
    await montar(createElement(PermissoesProvider, {
      role: "ADMIN", permissoes: permissoesTotais(),
      children: createElement(UsuariosTela, { usuarioAtualId: "u3", emailsTecnicos: ["fernanda@x.com"] }),
    } as any));
    await esperar(10);

    // O CadastroPadrao renderiza tabela (desktop) E cartões (celular): o que importa é que
    // TODO aviso esteja na linha do Carlos — e nenhuma linha da Fernanda ou da Olívia tenha um.
    const avisos = $$("[data-aviso-tecnico]");
    expect(avisos.length).toBeGreaterThan(0);
    expect(caixa.textContent).toContain("sem técnico vinculado");
    for (const a of avisos) expect(a.closest("tr, li")!.textContent).toContain("Carlos Técnico");
    for (const l of $$("tr, li")) {
      if (/Fernanda Técnica|Olivia Operadora|Tiago Inativo/.test(l.textContent!)) {
        expect(l.querySelector("[data-aviso-tecnico]")).toBeNull();
      }
    }
  });
});
