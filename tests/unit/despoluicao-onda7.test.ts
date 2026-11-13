/**
 * Despoluição — Onda 7 (vocabulário + shell): o que a onda garante além do ratchet.
 *  - glossário aplicado nos rótulos: Excluir (nunca Remover), Pesquisar (nunca Buscar), Novo <entidade> para criar,
 *    Salvar no diálogo de edição, "Em aberto" como status não pago, "Anexos" para arquivos anexados na OS/cliente;
 *  - chip de ícone do cabeçalho neutro em todo o app (nenhum bg-primary-50/bg-acento-claro no padrão do chip);
 *  - saudação do dashboard por hora do dia, sem "Olá, …!"; rótulos do shell em caixa de frase.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { LABELS_STATUS_CONTA_RECEBER } from "@/lib/utils";
import { LABELS_STATUS_CONTA_PAGAR } from "@/lib/financeiro-status";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");
function arquivos(dir: string): string[] {
  const abs = path.join(RAIZ, dir);
  return readdirSync(abs).flatMap((n) => {
    const p = path.join(abs, n); const rel = path.posix.join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : arquivos(rel);
    return /\.(tsx?|jsx?)$/.test(n) && !/\.(test|spec)\./.test(n) ? [rel] : [];
  });
}
const UI = [...arquivos("components"), ...arquivos("app")];
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("glossário nos rótulos", () => {
  it("nenhum 'Remover' nem 'Buscar' (com maiúscula: rótulo) no código de UI", () => {
    const sobras = UI.flatMap((f) => {
      const src = semComentarios(ler(f));
      return [...src.matchAll(/\b(Remover|Buscar)\b/g)].map((m) => `${f}: ${m[1]}`);
    });
    expect(sobras).toEqual([]);
  });
  it("botão principal de criar é 'Novo/Nova <entidade>'; o diálogo de edição salva com 'Salvar'", () => {
    for (const f of ["components/forms/contatos-manager.tsx", "components/forms/unidades-manager.tsx", "components/forms/contatos-local.tsx", "components/forms/unidades-local.tsx"]) {
      const src = ler(f);
      expect(src, f).toMatch(/Nov[oa] (contato|endereço)/);
      expect(src, f).not.toMatch(/Adicionar (contato|endereço)/);
      expect(src, f).not.toMatch(/"Adicionar" : "Salvar"/);
    }
    for (const f of ["components/cadastros/cadastro-padrao.tsx", "components/os/os-orcamento.tsx"]) expect(ler(f), f).not.toMatch(/\? "Salvar" : "Adicionar"|"Adicionar" : "Salvar"/);
    // sub-item dentro do formulário continua "Adicionar"
    expect(ler("components/compras/editor-pedido.tsx")).toContain("Adicionar item");
    expect(ler("components/os/os-fotos-anexos.tsx")).toContain("Adicionar foto");
  });
  it("arquivos anexados são 'Anexos'; status não pago é 'Em aberto'", () => {
    expect(ler("components/os/os-fotos-anexos.tsx")).toContain(">Anexos<");
    expect(ler("components/os/os-fotos-anexos.tsx")).not.toMatch(/Adicionar documento|Documento excluído/);
    // A aba "Anexos e mídia" virou só "Anexos" (a logo foi para Dados gerais) — fica no glossário.
    expect(ler("components/forms/cliente-form.tsx")).toContain('label: "Anexos"');
    expect(LABELS_STATUS_CONTA_RECEBER.A_RECEBER).toBe("Em aberto");
    expect(LABELS_STATUS_CONTA_PAGAR.PENDENTE).toBe("Em aberto");
    expect(ler("lib/os/central.ts")).toContain('A_RECEBER: "Em aberto"');
  });
  it("Alterar → Editar nos rótulos de ação; senha e status com verbo próprio", () => {
    expect(ler("lib/financeiro/acoes-lote.ts")).toContain('rotulo: "Editar vencimento"');
    expect(ler("app/(dashboard)/ordens/nova/page.tsx")).toContain('"Editar equipamentos"');
    const sobras = UI.flatMap((f) => [...semComentarios(ler(f)).matchAll(/"Alterar [^"]*"|>Alterar [^<]*</g)].map((m) => `${f}: ${m[0]}`));
    expect(sobras).toEqual([]);
  });
});

describe("shell", () => {
  it("chip de ícone do cabeçalho neutro em todo o app", () => {
    const coloridos = UI.flatMap((f) => [...ler(f).matchAll(/className="p-2(?:\.5)? (?:bg-primary-50|bg-acento-claro) rounded-(?:lg|card)[^"]*"><\w+ className="[^"]*"/g)].map(() => f));
    expect(coloridos).toEqual([]);
    const neutros = UI.filter((f) => /className="p-2(?:\.5)? bg-surface-alt rounded-(?:lg|card)[^"]*"><\w+ className="[^"]*text-ink-muted[^"]*"/.test(ler(f)));
    expect(neutros.length).toBeGreaterThanOrEqual(25);
  });
  it("saudação do dashboard por hora do dia; rótulos do shell em caixa de frase", () => {
    const dash = ler("app/(dashboard)/dashboard/page.tsx");
    expect(dash).toMatch(/hora < 12 \? "Bom dia" : hora < 18 \? "Boa tarde" : "Boa noite"/);
    expect(dash).not.toMatch(/Olá/);
    for (const f of ["components/layout/header.tsx", "components/layout/sidebar.tsx"]) {
      expect(ler(f), f).not.toMatch(/"(?:Ordens de Serviço|Leads do Site|Checklists de Veículo|Contas Bancárias|Tipos de Equipamento|Tabelas de Preços|Custo de Pessoal)"/);
    }
    expect(ler("components/layout/header.tsx")).toContain('"Pesquisar..."');
  });
});
