/**
 * Reorganização das Configurações (só navegação): 3 seções com subgrupos, sem quebrar rotas.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRESETS, montarPermissoes, permissoesTotais } from "@/lib/permissoes";
import { SECOES_CONFIGURACOES, secoesVisiveis } from "@/lib/navegacao/configuracoes";

const raiz = path.join(__dirname, "../../app/(dashboard)");
const paginaExiste = (href: string) => existsSync(path.join(raiz, href.split("#")[0], "page.tsx"));
const hrefs = SECOES_CONFIGURACOES.flatMap((s) => s.subgrupos.flatMap((g) => g.itens.map((i) => i.href)));

/** Os itens que o menu "Configurações" tinha antes da reorganização (nenhum pode sumir). */
const ANTES = [
  "/configuracoes/tipos-os", "/configuracoes/tipos-equipamento", "/configuracoes/formularios", "/configuracoes/servicos",
  "/configuracoes/produtos", "/configuracoes/tabelas-preco", "/configuracoes/termos", "/configuracoes/prazos",
  "/configuracoes/financeiro/categorias", "/configuracoes", "/configuracoes/perfis", "/configuracoes/usuarios",
  "/configuracoes/cargos", "/configuracoes#preferencias", "/configuracoes/email", "/configuracoes/portal", "/configuracoes/qr-code",
];

describe("estrutura", () => {
  it("3 seções, cada uma com tela própria que existe", () => {
    expect(SECOES_CONFIGURACOES.map((s) => s.label)).toEqual(["Configurações operacionais", "Configurações financeiras", "Configurações da conta"]);
    for (const s of SECOES_CONFIGURACOES) expect(paginaExiste(s.href), s.href).toBe(true);
  });

  it("todos os itens de antes continuam, sem duplicar, e cada um aponta para uma página que existe", () => {
    expect([...hrefs].sort()).toEqual([...ANTES].sort());
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) expect(paginaExiste(h), h).toBe(true);
  });

  it("subgrupos pedidos; Categorias financeiras saiu das operacionais e foi para as financeiras", () => {
    const sub = (id: string) => SECOES_CONFIGURACOES.find((s) => s.id === id)!.subgrupos.map((g) => [g.titulo, g.itens.map((i) => i.label)]);
    expect(sub("operacionais")).toEqual([
      ["Ordens de serviço", ["Tipos de OS", "Formulários", "Termos de referência", "Modelos de prazo"]],
      ["Catálogo", ["Tipos de equipamento", "Serviços", "Produtos", "Tabelas de preços"]],
    ]);
    expect(sub("financeiras")).toEqual([["Classificação", ["Categorias financeiras"]]]);
    expect(sub("conta")).toEqual([
      ["Empresa", ["Dados da empresa", "Preferências"]],
      ["Acesso e pessoas", ["Usuários", "Perfis de acesso", "Cargos"]],
      ["Integrações", ["E-mail transacional", "Portal do cliente", "Config. QR Code"]],
    ]);
  });

  it("Acesso e pessoas explica cada item (também no menu)", () => {
    const itens = SECOES_CONFIGURACOES.find((s) => s.id === "conta")!.subgrupos.find((g) => g.titulo === "Acesso e pessoas")!.itens;
    expect(itens.map((i) => [i.label, i.dica, i.dicaNoMenu])).toEqual([
      ["Usuários", "Quem faz login no sistema", true],
      ["Perfis de acesso", "O que cada um pode fazer", true],
      ["Cargos", "Cargo do funcionário (usado no Custo de Pessoal)", true],
    ]);
  });
});

describe("permissão (quem não pode não vê o item nem a seção)", () => {
  it("administrador vê as 3 seções completas", () => {
    expect(secoesVisiveis(permissoesTotais(), "ADMIN").map((s) => s.id)).toEqual(["operacionais", "financeiras", "conta"]);
  });

  it("sem 'Configurações › visualizar' (ex.: técnico) não vê nenhuma seção", () => {
    expect(secoesVisiveis(PRESETS.TECNICO, "TECNICO")).toEqual([]);
    expect(secoesVisiveis(montarPermissoes({ financeiro: ["visualizar"] }))).toEqual([]);
  });

  it("com 'Configurações › visualizar' vê as seções (as mesmas rotas de antes, mesma regra)", () => {
    const s = secoesVisiveis(montarPermissoes({ configuracoes: ["visualizar"] }));
    expect(s.map((x) => x.id)).toEqual(["operacionais", "financeiras", "conta"]);
  });
});
