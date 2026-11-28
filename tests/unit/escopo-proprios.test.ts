/**
 * COM-1 — "Ver só os próprios": a regra pura do escopo e a marca nos perfis.
 *  - a marca LIMITA (sem ela, nada muda); o ADMIN nunca é limitado, nem com a marca ligada;
 *  - o filtro dos orçamentos (vendedor) e o das OS (vendedor da OS, do orçamento de origem ou quem criou);
 *  - fica de fora de "todas as permissões" (perfil Administrador): acesso total nunca nasce limitado;
 *  - o preset "Vendas" das empresas NOVAS nasce com a marca, sem ganhar acesso novo (OS continua sem "visualizar").
 */
import { describe, expect, it } from "vitest";
import { ACOES_LABEL, ACOES_RESTRITIVAS, MODULOS, PRESETS, ehRestritiva, montarPermissoes, permissoesTotais } from "@/lib/permissoes";
import { PRESET_VENDAS, perfisPadrao } from "@/lib/empresa/padroes";
import { comEscopo, filtroOrcamentos, filtroOrdens, soProprios } from "@/lib/escopo/proprios";

const COM_MARCA = montarPermissoes({ orcamentos: ["visualizar", "verSoProprios"], ordens: ["visualizar", "verSoProprios"] });
const SEM_MARCA = montarPermissoes({ orcamentos: ["visualizar"], ordens: ["visualizar"] });

describe("o escopo", () => {
  it("só limita quem tem a marca; o ADMIN (e o SUPER_ADMIN) nunca; sem sessão, nada", () => {
    expect(soProprios({ id: "u1", role: "OPERADOR", permissoes: COM_MARCA }, "orcamentos")).toBe(true);
    expect(soProprios({ id: "u1", role: "OPERADOR", permissoes: COM_MARCA }, "ordens")).toBe(true);
    expect(soProprios({ id: "u1", role: "OPERADOR", permissoes: SEM_MARCA }, "orcamentos")).toBe(false);
    expect(soProprios({ id: "u1", role: "ADMIN", permissoes: COM_MARCA }, "orcamentos")).toBe(false);
    expect(soProprios({ id: "u1", role: "SUPER_ADMIN", permissoes: COM_MARCA }, "ordens")).toBe(false);
    expect(soProprios(null, "orcamentos")).toBe(false);
    // Marca só num módulo: o outro segue livre
    const soOrc = montarPermissoes({ orcamentos: ["visualizar", "verSoProprios"], ordens: ["visualizar"] });
    expect([soProprios({ id: "u", permissoes: soOrc }, "orcamentos"), soProprios({ id: "u", permissoes: soOrc }, "ordens")]).toEqual([true, false]);
  });

  it("os filtros: orçamento pelo vendedor; OS pelo vendedor dela, pelo do orçamento de origem ou por quem criou", () => {
    const u = { id: "uAna", role: "OPERADOR", permissoes: COM_MARCA };
    expect(filtroOrcamentos(u)).toEqual({ vendedorId: "uAna" });
    expect(filtroOrdens(u)).toEqual({ OR: [{ vendedorId: "uAna" }, { orcamentoOrigem: { vendedorId: "uAna" } }, { criadoPorId: "uAna" }] });
    expect(filtroOrcamentos({ ...u, permissoes: SEM_MARCA })).toEqual({});
    expect(filtroOrdens({ ...u, role: "ADMIN" })).toEqual({});
    // Sem id não há "próprios": a lista fica vazia, nunca aberta
    expect(filtroOrcamentos({ ...u, id: null })).toEqual({ vendedorId: "__sem_usuario__" });
  });

  it("comEscopo junta com AND (os ORs da busca não se misturam com o do escopo); sem escopo, o where fica igual", () => {
    const where = { empresaId: "e1", OR: [{ codigo: "A" }, { nome: "B" }] };
    expect(comEscopo(where, {})).toBe(where);
    expect(comEscopo<object>(where, { vendedorId: "u" })).toEqual({ AND: [where, { vendedorId: "u" }] });
  });
});

describe("a marca nos perfis", () => {
  it("existe em Orçamentos e em OS, com o nome da tela, e é a única restritiva", () => {
    expect(ACOES_LABEL.verSoProprios).toBe("Ver só os próprios");
    expect(ACOES_RESTRITIVAS).toEqual(["verSoProprios"]);
    expect(ehRestritiva("verSoProprios")).toBe(true);
    expect(ehRestritiva("visualizar")).toBe(false);
    const com = MODULOS.filter((m) => m.acoes.includes("verSoProprios")).map((m) => m.id).sort();
    expect(com).toEqual(["orcamentos", "ordens"]);
  });

  it("'todas as permissões' (perfil Administrador) NÃO liga a marca: acesso total nunca nasce limitado", () => {
    const tudo = permissoesTotais();
    expect(tudo.orcamentos.verSoProprios).toBe(false);
    expect(tudo.ordens.verSoProprios).toBe(false);
    expect(tudo.orcamentos.trocarVendedor).toBe(true);
    expect(PRESETS.ADMINISTRADOR.orcamentos.verSoProprios).toBe(false);
    // Nenhum outro preset existente ganhou a marca
    for (const [nome, p] of Object.entries(PRESETS)) {
      expect([nome, p.orcamentos?.verSoProprios ?? false, p.ordens?.verSoProprios ?? false]).toEqual([nome, false, false]);
    }
  });

  it("o preset Vendas das empresas novas nasce com a marca — sem ganhar acesso novo (OS continua sem 'visualizar')", () => {
    expect(PRESET_VENDAS.orcamentos.verSoProprios).toBe(true);
    expect(PRESET_VENDAS.ordens.verSoProprios).toBe(true);
    expect(PRESET_VENDAS.ordens.visualizar).toBe(false);
    expect(PRESET_VENDAS.orcamentos.aprovar).toBe(false);
    const vendas = perfisPadrao().find((p) => p.nome === "Vendas")!;
    expect(vendas.permissoes.orcamentos.verSoProprios).toBe(true);
    // Os outros perfis padrão continuam sem a marca
    for (const p of perfisPadrao().filter((x) => x.nome !== "Vendas")) expect([p.nome, p.permissoes.orcamentos?.verSoProprios ?? false]).toEqual([p.nome, false]);
  });
});
