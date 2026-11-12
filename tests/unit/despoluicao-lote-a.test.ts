/**
 * Despoluição — Lote A (Financeiro + Cadastros): o que o lote garante além do ratchet.
 *  - paleta de dado harmonizada e única: a seleção de cor das equipes vem de lib/ui/tokens.ts (sem hex nos componentes);
 *  - cliente-form usa o toast da casa (sem toast local, sem "!");
 *  - mensagens de permissão no formato único; sem frases de assistente nos cadastros;
 *  - painéis de ação da medição e caixas de orientação neutros (cor só com função);
 *  - títulos das páginas do financeiro e dos cadastros em caixa de frase.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { contraste, corDado, paletaSelecao } from "@/lib/ui/tokens";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");
const TITLE_CASE = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?: (?:de|da|do|das|dos|e|a|em|por))? [A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+/;

describe("paleta de dado", () => {
  it("seleção de cor das equipes: 8 cores da paleta única, distintas e visíveis sobre branco", () => {
    expect(paletaSelecao).toHaveLength(8);
    expect(new Set(paletaSelecao).size).toBe(8);
    const todas = new Set<string>(Object.values(corDado));
    for (const c of paletaSelecao) { expect(todas.has(c), c).toBe(true); expect(contraste(c, "#FFFFFF"), c).toBeGreaterThanOrEqual(3); }
  });
  it("equipe-form, montador e a rota do montador não carregam hex: usam a paleta", () => {
    for (const f of ["components/forms/equipe-form.tsx", "components/equipes/montador-equipes.tsx", "app/api/equipes/montador/route.ts"]) {
      const src = ler(f);
      expect(src, f).not.toMatch(/"#[0-9A-Fa-f]{6}"/);
      expect(src, f).toMatch(/paletaSelecao|corDado/);
    }
  });
});

describe("cadastros", () => {
  it("cliente-form: toast da casa, sem toast local nem exclamação", () => {
    const src = ler("components/forms/cliente-form.tsx");
    expect(src).toContain('import { toast } from "@/components/ui/avisos";');
    expect(src).not.toMatch(/setToast|mostrarToast|fixed top-5 right-5/);
    expect(src).toContain('toast("Cliente cadastrado.")');
    expect(src).not.toMatch(/toast\([^)]*!["'`]/);
  });
  it("sem frases de assistente; mensagem de permissão no formato único", () => {
    const forms = ["components/forms/equipamento-form.tsx", "components/forms/veiculo-form.tsx", "components/forms/colaborador-form.tsx", "components/equipes/montador-equipes.tsx", "components/equipamentos/cadastro-por-foto.tsx", "components/veiculos/crlv-por-foto.tsx", "components/veiculos/checklist-preenchimento.tsx"];
    for (const f of forms) {
      const src = ler(f);
      expect(src, f).not.toMatch(/Tudo pronto|Tudo certo|Bom trabalho|A IA lê|não tem permissão|Somente consulta/);
    }
    for (const f of ["components/forms/veiculo-form.tsx", "components/forms/colaborador-form.tsx", "components/equipes/montador-equipes.tsx"]) {
      expect(ler(f), f).toMatch(/Somente leitura: requer a permissão [A-ZÀ-Ú][a-zà-ú]+ › [a-z]+\./);
    }
  });
});

describe("financeiro", () => {
  it("painéis de ação da medição e caixas de orientação neutros (cor só com função)", () => {
    const m = ler("components/medicao/medicao-acoes.tsx");
    const paineis = [...m.matchAll(/<div className="([^"]+)">\s*<h4 className="([^"]+)">Registrar [^<]+<\/h4>/g)];
    expect(paineis).toHaveLength(4);
    for (const [, caixa, titulo] of paineis) { expect(caixa).toContain("border-surface-border"); expect(`${caixa} ${titulo}`).not.toMatch(/primary|success/); }
    expect(ler("components/medicao/relatorio-mensal-contrato.tsx")).not.toMatch(/bg-primary-50 border border-primary-100/);
    expect(ler("components/forms/cliente-form.tsx")).not.toMatch(/bg-success-50/);
  });
  it("mensagens ao cliente sem 'Olá'; títulos de página em caixa de frase", () => {
    expect(ler("components/financeiro/conta-receber-acoes.tsx")).not.toMatch(/Olá/);
    expect(ler("components/medicao/medicao-envio.tsx")).not.toMatch(/Olá/);
    const paginas = ["app/(dashboard)/financeiro/page.tsx", "app/(dashboard)/financeiro/fluxo-caixa/page.tsx", "app/(dashboard)/financeiro/contas-receber/page.tsx", "app/(dashboard)/financeiro/contas-pagar/page.tsx", "app/(dashboard)/financeiro/contas-receber/nova/page.tsx", "app/(dashboard)/financeiro/contas-bancarias/page.tsx", "app/(dashboard)/clientes/novo/page.tsx", "app/(dashboard)/colaboradores/novo/page.tsx", "app/(dashboard)/equipes/novo/page.tsx", "components/financeiro/contas-receber-view.tsx", "components/financeiro/contas-pagar-view.tsx"];
    for (const f of paginas) {
      const titulos = [...ler(f).matchAll(/(?:title[:=]\s*|page-title[^>]*>)"?([^"<}]+)/g)].map((x) => x[1].trim());
      expect(titulos.length, f).toBeGreaterThan(0);
      for (const t of titulos) expect(TITLE_CASE.test(t), `${f}: ${t}`).toBe(false);
    }
  });
});
