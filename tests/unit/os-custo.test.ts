/**
 * Custo na OS — regras puras:
 *  - quem vê custo de compra na sessão (regra única do #241 + técnico NUNCA);
 *  - o custo que o servidor grava em cada material do item da OS (nunca o do navegador);
 *  - o custo some (a CHAVE some) dos itens que vão a quem não pode ver.
 */
import { describe, expect, it } from "vitest";
import { montarPermissoes, permissoesTotais } from "@/lib/permissoes";
import { usuarioVeCustoDeCompra } from "@/lib/estoque/custo-acesso";
import { custoDoMaterialOs, semCustoNosItensOs } from "@/lib/os/custo";

describe("usuarioVeCustoDeCompra (sessão)", () => {
  const u = (role: string, permissoes: unknown) => ({ role, permissoes });
  it("Estoque › visualizar ou Orçamentos › ver custo: vê; só editar OS: não vê", () => {
    expect(usuarioVeCustoDeCompra(u("OPERADOR", montarPermissoes({ estoque: ["visualizar"] })))).toBe(true);
    expect(usuarioVeCustoDeCompra(u("OPERADOR", montarPermissoes({ orcamentos: ["verCusto"] })))).toBe(true);
    expect(usuarioVeCustoDeCompra(u("OPERADOR", montarPermissoes({ ordens: ["visualizar", "criar", "editar"] })))).toBe(false);
    expect(usuarioVeCustoDeCompra(u("OPERADOR", montarPermissoes({ compras: ["visualizar", "gerenciar"], estoque: ["separar"] })))).toBe(false);
  });
  it("administrador sempre; TÉCNICO nunca (nem com todas as permissões)", () => {
    expect(usuarioVeCustoDeCompra(u("ADMIN", montarPermissoes({})))).toBe(true);
    expect(usuarioVeCustoDeCompra(u("SUPER_ADMIN", montarPermissoes({})))).toBe(true);
    expect(usuarioVeCustoDeCompra(u("TECNICO", permissoesTotais()))).toBe(false);
    expect(usuarioVeCustoDeCompra(null)).toBe(false);
    expect(usuarioVeCustoDeCompra(undefined)).toBe(false);
  });
});

describe("custoDoMaterialOs (o servidor decide)", () => {
  const gravados = new Map<string, number | null>([["tubo", 12], ["suporte", null]]);
  const ultimos = new Map([["tubo", 30], ["filtro", 20]]);
  it("produto que já estava no item mantém o custo gravado (não sobe com compra nova); gravado sem custo segue sem", () => {
    expect(custoDoMaterialOs({ produtoId: "tubo" }, gravados, ultimos)).toBe(12);
    expect(custoDoMaterialOs({ produtoId: "suporte" }, gravados, ultimos)).toBeNull();
  });
  it("produto novo no item: último custo de compra; nunca comprado: null; linha à mão: null", () => {
    expect(custoDoMaterialOs({ produtoId: "filtro" }, gravados, ultimos)).toBe(20);
    expect(custoDoMaterialOs({ produtoId: "nunca" }, gravados, ultimos)).toBeNull();
    expect(custoDoMaterialOs({ produtoId: null }, gravados, ultimos)).toBeNull();
    expect(custoDoMaterialOs({}, gravados, ultimos)).toBeNull();
  });
  it("o custo que veio do navegador nem é lido", () => {
    expect(custoDoMaterialOs({ produtoId: "tubo", custoUnit: 999 } as any, gravados, ultimos)).toBe(12);
    expect(custoDoMaterialOs({ produtoId: "x", custoUnit: 999 } as any, gravados, ultimos)).toBeNull();
  });
});

describe("semCustoNosItensOs", () => {
  it("tira a chave custoUnit de todos os materiais; item sem materiais fica igual; não mexe no original", () => {
    const itens = [
      { id: "i1", materiais: [{ id: "m1", produtoId: "tubo", custoUnit: 12, valorVendaUnit: 20 }, { id: "m2", custoUnit: null }] },
      { id: "i2", materiais: [] },
      { id: "i3" },
    ];
    const r = semCustoNosItensOs(itens);
    expect(JSON.stringify(r)).not.toContain("custoUnit");
    expect(r[0].materiais).toEqual([{ id: "m1", produtoId: "tubo", valorVendaUnit: 20 }, { id: "m2" }]);
    expect(r[2]).toBe(itens[2]);
    expect(itens[0].materiais![0].custoUnit).toBe(12);
  });
});
