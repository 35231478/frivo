// @vitest-environment happy-dom
/**
 * UX-3 "Toast da casa" (Y1/Y2/G12): toast() e confirmar() próprios no lugar dos
 * alert()/confirm() nativos, em todo o sistema.
 *  - toast: aparece, tem o tipo certo, fecha no X e some sozinho;
 *  - confirmar: diálogo da casa (role=dialog), resolve true/false (botões e Esc);
 *    sem host montado, cai no confirm() nativo para nunca travar;
 *  - varredura: uma ação real (inativar equipamento) usa o diálogo da casa (não o
 *    window.confirm) e o erro da API vira toast (não alert);
 *  - gravações mudas: salvar template de e-mail e gerar OS do contrato avisam no erro;
 *  - G12: técnico redirecionado de área do escritório chega com ?aviso=restrito.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";
import { destinoModoTecnico } from "@/lib/tecnico/modo";
import { Avisos, confirmar, toast } from "@/components/ui/avisos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

let root: Root; let caixa: HTMLDivElement;
const esperar = async (n = 4) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };

async function montar(el: any) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: el })); });
  await esperar();
}
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

describe("toast da casa", () => {
  it("aparece com o tipo certo, fecha no X e some sozinho", async () => {
    await montar(createElement(Avisos));
    await act(async () => { toast("Salvo com sucesso!"); });
    expect($("[data-toast=sucesso]")!.textContent).toContain("Salvo com sucesso!");
    await act(async () => { toast("Deu ruim.", "erro"); });
    expect($("[data-toast=erro]")!.textContent).toContain("Deu ruim.");
    // fecha no X
    await clicar($("[data-toast=erro] button"));
    expect($("[data-toast=erro]")).toBeNull();
    // o de sucesso some sozinho (4s)
    await act(async () => { await new Promise((r) => setTimeout(r, 4200)); });
    expect($("[data-toast=sucesso]")).toBeNull();
  }, 20000);

  it("confirmar(): diálogo da casa resolve true/false (botões e Esc); sem host cai no nativo", async () => {
    await montar(createElement(Avisos));
    let resultado: Promise<boolean> = confirmar({ mensagem: "Cancelar esta conta?", perigo: true, confirmarTexto: "Cancelar conta" });
    await esperar();
    const dialogo = $("[data-confirmacao]")!;
    expect(dialogo.textContent).toContain("Cancelar esta conta?");
    expect($("[data-confirmar-sim]")!.textContent).toBe("Cancelar conta");
    await clicar($("[data-confirmar-sim]"));
    expect(await resultado).toBe(true);
    expect($("[data-confirmacao]")).toBeNull();

    resultado = confirmar("Remover?");
    await esperar();
    await clicar($("[data-confirmar-nao]"));
    expect(await resultado).toBe(false);

    resultado = confirmar("Sair?");
    await esperar();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(await resultado).toBe(false);

    // sem host: nunca trava — usa o confirm nativo
    await act(async () => root.unmount()); caixa.remove();
    const nativo = vi.fn(() => true);
    vi.stubGlobal("confirm", nativo);
    expect(await confirmar("Fallback?")).toBe(true);
    expect(nativo).toHaveBeenCalledWith("Fallback?");
  });
});

describe("varredura: as ações usam o diálogo e o toast da casa", () => {
  it("inativar equipamento: confirmação da casa (sem window.confirm) e erro da API vira toast", async () => {
    const nativo = vi.fn(() => true);
    vi.stubGlobal("confirm", nativo);
    vi.stubGlobal("alert", vi.fn());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ erro: "Equipamento tem OS aberta." }), { status: 400, headers: { "content-type": "application/json" } })));
    const { EquipamentoAtivoBotao } = await import("@/components/equipamentos/equipamento-ativo-botao");
    await montar(createElement("div", null, createElement(Avisos), createElement(EquipamentoAtivoBotao, { id: "e1", nome: "Split Sala 1", ativo: true, variante: "botao" })));

    await clicar($$("button").find((b) => b.textContent!.includes("Inativar")));
    // diálogo da casa, não o nativo
    expect(nativo).not.toHaveBeenCalled();
    expect($("[data-confirmacao]")!.textContent).toContain('Inativar o equipamento "Split Sala 1"?');
    await clicar($("[data-confirmar-sim]"));
    // erro da API aparece como toast (não alert)
    expect($("[data-toast=erro]")!.textContent).toContain("Equipamento tem OS aberta.");
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("cancelar no diálogo não grava nada", async () => {
    const chamadas: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: any) => { chamadas.push(String(u)); return new Response("{}", { status: 200 }); }));
    const { EquipamentoAtivoBotao } = await import("@/components/equipamentos/equipamento-ativo-botao");
    await montar(createElement("div", null, createElement(Avisos), createElement(EquipamentoAtivoBotao, { id: "e1", nome: "Split", ativo: true, variante: "botao" })));
    await clicar($$("button").find((b) => b.textContent!.includes("Inativar")));
    await clicar($("[data-confirmar-nao]"));
    expect(chamadas).toEqual([]);
    expect($("[data-confirmacao]")).toBeNull();
  });
});

describe("gravações mudas restantes avisam (Y2)", () => {
  it("salvar template de e-mail com erro mostra o motivo", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: any, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify([{ id: "t1", tipo: "OS_CONCLUIDA", assunto: "A", corpo: "B", ativo: true }]), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ erro: "Corpo muito grande." }), { status: 400, headers: { "content-type": "application/json" } });
    }));
    const { EmailTemplatesClient } = await import("@/components/config/email-templates-client");
    await montar(createElement("div", null, createElement(Avisos), createElement(EmailTemplatesClient)));
    // abre o primeiro template e tenta salvar
    await clicar($$("button").find((b) => b.textContent!.includes("Editar")) ?? $$("button")[0]);
    await clicar($$("button").find((b) => b.textContent!.trim() === "Salvar"));
    // (o toast de erro do teste anterior pode ainda estar vivo — basta o novo existir)
    expect($$("[data-toast=erro]").some((t) => t.textContent!.includes("Corpo muito grande."))).toBe(true);
  });
});

describe("G12: redirect do técnico avisa", () => {
  it("área do escritório → /tecnico?aviso=restrito; raiz e execução sem aviso", () => {
    expect(destinoModoTecnico("/financeiro/contas-receber")).toBe("/tecnico?aviso=restrito");
    expect(destinoModoTecnico("/")).toBe("/tecnico");
    expect(destinoModoTecnico("/ordens/os1/atividades/a1/executar")).toBe("/tecnico?ver=os&a=a1");
  });
});
