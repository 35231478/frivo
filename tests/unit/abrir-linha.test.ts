// @vitest-environment happy-dom
/**
 * A LINHA INTEIRA abre o registro — a regra pura (lib/listagem/abrir-linha):
 *  - clique numa célula comum abre; num controle (link, botão, campo, checkbox, rótulo, menu) não;
 *  - coluna fixa (checkbox, ações) não abre nem clicando no espaço vazio dela;
 *  - texto selecionado na página = a pessoa estava copiando, não abre;
 *  - Ctrl/⌘/Shift + clique e o botão do meio abrem em nova aba; botão direito e Alt não abrem;
 *  - no teclado só Enter com o foco NA linha abre (Enter num campo dentro dela é do campo).
 */
import { describe, expect, it } from "vitest";
import { SELETOR_CONTROLE, cliqueAbreLinha, destinoDoClique, teclaAbreLinha } from "@/lib/listagem/abrir-linha";

function linha() {
  document.body.innerHTML = `
    <table><tbody>
      <tr data-linha="r1">
        <td data-celula="sel" data-fixa><span class="caixa"><input type="checkbox" aria-label="Selecionar"></span></td>
        <td data-celula="numero"><a href="/x/1">OS-1</a><span class="selo">Portal</span></td>
        <td data-celula="cliente"><div class="nome"><span class="texto">Hospital</span></div></td>
        <td data-celula="status"><label><input type="checkbox"> ok</label><span data-nao-abre class="livre">balão</span></td>
        <td data-celula="acoes" data-fixa><button type="button">⋮</button></td>
      </tr>
      <tr data-linha="r2"><td data-celula="cliente">Outra</td></tr>
    </tbody></table>
    <div class="fora"><button type="button">fora</button></div>`;
  const tr = document.querySelector('tr[data-linha="r1"]')!;
  const $ = (sel: string) => tr.querySelector(sel) as Element;
  return { tr, $ };
}

describe("cliqueAbreLinha", () => {
  it("célula comum, o texto dentro dela e a própria linha abrem", () => {
    const { tr, $ } = linha();
    expect(cliqueAbreLinha($('[data-celula="cliente"]'), tr)).toBe(true);
    expect(cliqueAbreLinha($(".texto"), tr)).toBe(true);
    expect(cliqueAbreLinha($(".selo"), tr)).toBe(true); // um selo de texto ao lado do link não é controle
    expect(cliqueAbreLinha(tr, tr)).toBe(true);
  });

  it("controles dentro da linha não abrem: link, botão, campo, rótulo, o que se marca com data-nao-abre", () => {
    const { tr, $ } = linha();
    expect(cliqueAbreLinha($("a"), tr)).toBe(false);
    expect(cliqueAbreLinha($('[data-celula="acoes"] button'), tr)).toBe(false);
    expect(cliqueAbreLinha($('[data-celula="status"] input'), tr)).toBe(false);
    expect(cliqueAbreLinha($("label"), tr)).toBe(false);
    expect(cliqueAbreLinha($(".livre"), tr)).toBe(false);
  });

  it("coluna fixa (checkbox, ações): nem o espaço vazio dela abre", () => {
    const { tr, $ } = linha();
    expect(cliqueAbreLinha($('[data-celula="sel"]'), tr)).toBe(false);
    expect(cliqueAbreLinha($(".caixa"), tr)).toBe(false);
    expect(cliqueAbreLinha($('[data-celula="acoes"]'), tr)).toBe(false);
  });

  it("alvo fora da linha (outra linha, a página) não abre esta", () => {
    const { tr } = linha();
    expect(cliqueAbreLinha(document.querySelector('tr[data-linha="r2"] td'), tr)).toBe(false);
    expect(cliqueAbreLinha(document.querySelector(".fora"), tr)).toBe(false);
    expect(cliqueAbreLinha(null, tr)).toBe(false);
  });

  it("texto selecionado na página: a pessoa estava copiando, não abre (só espaços não contam)", () => {
    const { tr, $ } = linha();
    expect(cliqueAbreLinha($(".texto"), tr, "Hosp")).toBe(false);
    expect(cliqueAbreLinha($(".texto"), tr, "  \n")).toBe(true);
    expect(cliqueAbreLinha($(".texto"), tr, "")).toBe(true);
  });

  it("o seletor de controle cobre o que a casa usa nas linhas", () => {
    for (const tag of ["a", "button", "input", "select", "textarea", "label", "summary"]) expect(SELETOR_CONTROLE, tag).toContain(tag);
    for (const papel of ['[role="button"]', '[role="menu"]', '[role="menuitem"]', '[role="dialog"]', "[data-nao-abre]"]) expect(SELETOR_CONTROLE, papel).toContain(papel);
  });
});

describe("destinoDoClique", () => {
  const ev = (extra: Partial<Parameters<typeof destinoDoClique>[0]>) => ({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra });
  it("botão esquerdo simples abre na mesma aba", () => expect(destinoDoClique(ev({}))).toBe("mesma-aba"));
  it("Ctrl, ⌘ ou Shift + clique e o botão do meio abrem em nova aba", () => {
    expect(destinoDoClique(ev({ ctrlKey: true }))).toBe("nova-aba");
    expect(destinoDoClique(ev({ metaKey: true }))).toBe("nova-aba");
    expect(destinoDoClique(ev({ shiftKey: true }))).toBe("nova-aba");
    expect(destinoDoClique(ev({ button: 1 }))).toBe("nova-aba");
  });
  it("botão direito e Alt + clique não abrem (menu de contexto, baixar)", () => {
    expect(destinoDoClique(ev({ button: 2 }))).toBe("nenhum");
    expect(destinoDoClique(ev({ altKey: true }))).toBe("nenhum");
    expect(destinoDoClique(ev({ altKey: true, button: 1 }))).toBe("nenhum");
  });
});

describe("teclaAbreLinha", () => {
  it("Enter com o foco na linha abre; Enter num controle dentro dela é do controle; outras teclas não", () => {
    const { tr, $ } = linha();
    expect(teclaAbreLinha({ key: "Enter", target: tr, currentTarget: tr })).toBe(true);
    expect(teclaAbreLinha({ key: "Enter", target: $("input"), currentTarget: tr })).toBe(false);
    expect(teclaAbreLinha({ key: " ", target: tr, currentTarget: tr })).toBe(false);
    expect(teclaAbreLinha({ key: "ArrowDown", target: tr, currentTarget: tr })).toBe(false);
  });
});
