/**
 * A COERÊNCIA DO REGISTRO DE CADASTROS — o guard que nasceu de um defeito de verdade.
 *
 * O cadastro declara `massa: true` quando entra nas ações em massa. Só que quem executa a seleção
 * é outro registro (`ENTIDADE`, em lib/acoes-massa/acoes.ts), e a tela lê `ENTIDADE[entidade]`
 * **sem rede de proteção**: declarar `massa: true` sem registrar lá derruba a página inteira com
 * "Cannot read properties of undefined".
 *
 * Foi assim que o navegador pegou o modelo de documento nesta leva — e nenhum teste de tela via,
 * porque a explosão acontece no provider da lista, não no editor. Então o lugar do guard é aqui:
 * puro, barato, e vale para todo cadastro que vier depois.
 */
import { describe, expect, it } from "vitest";
import { CADASTROS, ENTIDADES_CADASTRO } from "@/lib/cadastros/registro";
import { ENTIDADES, ENTIDADE } from "@/lib/acoes-massa/acoes";

describe("registro de cadastros × ações em massa", () => {
  it("todo cadastro com massa:true está registrado nas ações em massa", () => {
    const prometem = ENTIDADES_CADASTRO.filter((e) => CADASTROS[e].massa);
    const faltando = prometem.filter((e) => !(ENTIDADES as readonly string[]).includes(e));
    expect(faltando, "declarar massa:true sem registrar em ENTIDADE derruba a tela da lista").toEqual([]);
  });

  it("e o que está registrado tem módulo e ações de verdade", () => {
    for (const e of ENTIDADES_CADASTRO.filter((x) => CADASTROS[x].massa)) {
      const def = ENTIDADE[e as keyof typeof ENTIDADE];
      expect(def, e).toBeTruthy();
      expect(typeof def.modulo, e).toBe("string");
      expect(Object.keys(def.acoes).length, e).toBeGreaterThan(0);
    }
  });

  it("cada cadastro tem a entidade igual à chave do mapa (um id, um cadastro)", () => {
    for (const e of ENTIDADES_CADASTRO) expect(CADASTROS[e].entidade, e).toBe(e);
  });
});
