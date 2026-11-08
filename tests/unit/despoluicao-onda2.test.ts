// @vitest-environment happy-dom
/**
 * Despoluição — Onda 2 (Contratos): o que a onda garante além do ratchet.
 *  - contrato-form usa o toast da casa (sem toast local, sem "!") e o texto do reajuste é impessoal;
 *  - lista de contratos: cartões de resumo neutros; cor só nos alertas e só quando há o que alertar;
 *    botão "Novo contrato" em caixa de frase;
 *  - relatório: as cores do donut e da legenda são os tokens de status (nenhum hex solto).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { acento, status } from "@/lib/ui/tokens";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/contratos",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("@/components/acoes-massa/selecao", () => ({
  useAcoesMassaDisponiveis: () => false,
  CheckboxLinha: () => null,
  CheckboxPagina: () => null,
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

let root: Root, caixa: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); });
async function montar(el: any) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(el); });
}
const $ = (sel: string) => caixa.querySelector(sel) as HTMLElement | null;

describe("contrato-form", () => {
  const src = ler("components/forms/contrato-form.tsx");
  it("toast da casa, sem toast local e sem exclamação", () => {
    expect(src).toContain('import { toast } from "@/components/ui/avisos";');
    expect(src).not.toMatch(/setToast|mostrarToast|fixed top-5 right-5/);
    expect(src).toContain('toast(isEditing ? "Contrato salvo." : "Contrato criado.")');
    expect(src).not.toMatch(/toast\([^)]*!["'`]/);
  });
  it("reajuste: descrição e dica impessoais, sem 'você' nem 'pra'; a dica guarda as regras", () => {
    const dica = src.match(/label="Reajuste anual"\s+description="([^"]+)"\s+dica="([^"]+)"/)!;
    expect(dica, "ToggleSwitch do reajuste").toBeTruthy();
    const [, descricao, texto] = dica;
    expect(descricao).toBe("No aniversário, o sistema sugere o valor novo; a aplicação é manual.");
    for (const regra of ["Contratos › Reajustes", "sino", "manual", "já cobrado não muda", "12 meses"]) expect(texto).toContain(regra);
    expect(`${descricao} ${texto}`).not.toMatch(/(?<![\wÀ-ú])(?:você|pra)(?![\wÀ-ú])/i);
  });
  it("o local sugerido do cliente é uma caixa neutra (sem acento de orientação)", () => {
    const caixaLocal = src.match(/<div className="([^"]+)" data-local-pendente>/)![1];
    expect(caixaLocal).toContain("border-surface-border");
    expect(caixaLocal).not.toMatch(/primary|acento/);
  });
});

describe("lista de contratos", () => {
  const base = { contratos: [], total: 0, pagina: 1, porPagina: 25, somaMensalFiltrada: 0, opcoesClientes: [] };
  it("cartões neutros; alerta colorido só quando há vencendo/vencidos; 'Novo contrato' em caixa de frase", async () => {
    const { ContratosListaClient } = await import("@/components/contratos/contratos-lista-client");
    await montar(createElement(ContratosListaClient, { ...base, resumo: { ativos: 3, valorMensalTotal: 1000, valorAnualTotal: 12000, vencendo: 0, vencidos: 0 } } as any));
    for (const rotulo of ["Contratos ativos", "Valor mensal total", "Valor anual total", "Vencendo em 30 dias", "Vencidos"]) {
      const c = $(`[data-card-resumo="${rotulo}"]`)!;
      expect(c, rotulo).toBeTruthy();
      expect(c.innerHTML, rotulo).not.toMatch(/success|primary|atencao|atrasado|font-bold/);
    }
    expect(caixa.textContent).toContain("Novo contrato");
    expect(caixa.textContent).not.toContain("Novo Contrato");
    act(() => root.unmount()); caixa.remove();
    await montar(createElement(ContratosListaClient, { ...base, resumo: { ativos: 3, valorMensalTotal: 1000, valorAnualTotal: 12000, vencendo: 2, vencidos: 1 } } as any));
    expect($('[data-card-resumo="Vencendo em 30 dias"]')!.innerHTML).toContain("atencao");
    expect($('[data-card-resumo="Vencidos"]')!.innerHTML).toContain("atrasado");
    expect($('[data-card-resumo="Valor mensal total"]')!.innerHTML).not.toMatch(/success|primary/);
  });
});

describe("relatório de contratos", () => {
  it("donut e legenda com os tokens de status (sem hex solto no componente)", async () => {
    expect(ler("components/contratos/relatorio-contratos-client.tsx")).not.toMatch(/#[0-9A-Fa-f]{6}/);
    const { RelatorioContratosClient } = await import("@/components/contratos/relatorio-contratos-client");
    const item = (id: string, statusMes: string) => ({ contratoId: id, numero: `CT-${id}`, cliente: "Cliente", clienteId: "c", periodicidade: "MENSAL", valorMensal: 100, statusMes, progresso: 0, dataAgendada: new Date().toISOString(), os: null, ultimaManutencao: null });
    await montar(createElement(RelatorioContratosClient, { mes: 11, ano: 2026, itens: [item("1", "CONCLUIDO"), item("2", "EM_ANDAMENTO"), item("3", "PENDENTE"), item("4", "ATRASADO")], tecnicos: [], clientes: [] } as any));
    const cores = [...caixa.querySelectorAll("span.w-3.h-3.rounded-sm")].map((e) => (e.getAttribute("style") ?? "").toLowerCase());
    expect(cores).toHaveLength(4);
    const esperadas = [status.ok.DEFAULT, acento.DEFAULT, status.atencao.DEFAULT, status.atrasado.DEFAULT].map((c) => c.toLowerCase());
    esperadas.forEach((cor, i) => expect(cores[i], `legenda ${i}`).toContain(cor));
  });
});
