// @vitest-environment happy-dom
/**
 * O SELETOR COM BUSCA da casa (components/ui/busca-select), num DOM de verdade.
 *
 * É o componente que todo seletor de cadastro passou a usar — produto, cliente, equipamento,
 * fornecedor, veículo, categoria… Então o que ele promete tem que estar provado aqui, uma vez,
 * em vez de espalhado pelas telas: digitar filtra (sem acento e sem caixa), o teclado inteiro
 * funciona, o celular não fica de fora, a lista grande não desenha tudo, e "+ Novo …" só existe
 * quando a tela manda.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BuscaSelect } from "@/components/ui/busca-select";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let caixa: HTMLDivElement; let root: Root;
beforeEach(() => { caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa); });
afterEach(() => { act(() => root.unmount()); caixa.remove(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(s: string) => document.body.querySelector(s) as T | null;
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const tecla = async (el: Element | null, key: string) => {
  await act(async () => { el!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
  await esperar();
};
const digitar = async (valor: string) => {
  const input = $<HTMLInputElement>("[data-campo-busca]")!;
  expect(input, "a lista está aberta").toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
};
const rotulos = () => $$("[data-opcao]").map((o) => txt(o));

const PESSOAS = [
  { value: "p1", label: "José da Silva" },
  { value: "p2", label: "Maria Antônia" },
  { value: "p3", label: "João Pereira" },
  { value: "p4", label: "Ana Lúcia" },
];

/** O seletor dentro de um estado de verdade (escolher muda o valor, como na tela) */
async function montar(props: Record<string, unknown> = {}, opcoes = PESSOAS) {
  function Tela() {
    const [v, setV] = useState((props.value as string) ?? "");
    return createElement(BuscaSelect, { ...props, options: opcoes, value: v, onChange: setV } as never);
  }
  await act(async () => { root.render(createElement(Tela)); });
  await esperar();
}

describe("o seletor com busca da casa", () => {
  it("fechado mostra o placeholder; aberto, a lista inteira e o campo de busca", async () => {
    await montar({ placeholder: "Selecione o colaborador" });
    expect(txt($("[data-busca-select]"))).toBe("Selecione o colaborador");
    expect($("[data-lista-busca]"), "a lista nasce fechada").toBeFalsy();
    await clicar($("[data-busca-select]"));
    expect($("[data-lista-busca]")).toBeTruthy();
    expect(rotulos()).toEqual(["José da Silva", "Maria Antônia", "João Pereira", "Ana Lúcia"]);
    expect($("[data-campo-busca]"), "o campo de busca já vem junto").toBeTruthy();
  });

  it("digitar filtra sem acento e sem caixa: 'jose' acha 'José', 'ANTONIA' acha 'Antônia'", async () => {
    await montar();
    await clicar($("[data-busca-select]"));
    await digitar("jose");
    expect(rotulos()).toEqual(["José da Silva"]);
    await digitar("ANTONIA");
    expect(rotulos()).toEqual(["Maria Antônia"]);
    await digitar("a");
    expect(rotulos()).toHaveLength(4); // "a" está em todos
    await digitar("zzz");
    expect(rotulos()).toHaveLength(0);
    expect(txt($("[data-busca-vazia]"))).toContain("zzz");
  });

  it("escolher fecha a lista, mostra o rótulo e devolve o valor; o × limpa", async () => {
    await montar({ placeholder: "Selecione" });
    await clicar($("[data-busca-select]"));
    await clicar($("[data-opcao='p3']"));
    expect($("[data-lista-busca]")).toBeFalsy();
    expect(txt($("[data-valor-escolhido]"))).toBe("João Pereira");
    expect($("[data-valor-escolhido]")!.getAttribute("data-valor-escolhido")).toBe("p3");
    await clicar($("[data-limpar-busca]"));
    expect(txt($("[data-busca-select]"))).toBe("Selecione");
    expect($("[data-limpar-busca]"), "sem escolha não há o que limpar").toBeFalsy();
  });

  it("teclado inteiro: ↓ abre, ↑↓ andam, Home/End vão às pontas, Enter escolhe, Esc fecha", async () => {
    await montar();
    const campo = $("[data-busca-select]")!;
    await tecla(campo, "ArrowDown");
    expect($("[data-lista-busca]"), "↓ abre").toBeTruthy();
    expect(txt($("[data-opcao-ativa='true']"))).toBe("José da Silva");
    await tecla(campo, "ArrowDown");
    await tecla(campo, "ArrowDown");
    expect(txt($("[data-opcao-ativa='true']"))).toBe("João Pereira");
    await tecla(campo, "ArrowUp");
    expect(txt($("[data-opcao-ativa='true']"))).toBe("Maria Antônia");
    await tecla(campo, "End");
    expect(txt($("[data-opcao-ativa='true']"))).toBe("Ana Lúcia");
    await tecla(campo, "Home");
    expect(txt($("[data-opcao-ativa='true']"))).toBe("José da Silva");
    await tecla(campo, "Enter");
    expect($("[data-lista-busca]")).toBeFalsy();
    expect(txt($("[data-valor-escolhido]"))).toBe("José da Silva");
  });

  it("Esc fecha sem escolher e devolve o foco ao campo (não deixa a pessoa perdida)", async () => {
    await montar();
    const campo = $("[data-busca-select]")!;
    await clicar(campo);
    await tecla($("[data-campo-busca]"), "Escape");
    expect($("[data-lista-busca]")).toBeFalsy();
    expect($("[data-valor-escolhido]"), "nada foi escolhido").toBeFalsy();
    expect(document.activeElement).toBe(campo);
  });

  it("Tab sai do campo fechando a lista (o formulário continua navegável)", async () => {
    await montar();
    await clicar($("[data-busca-select]"));
    await tecla($("[data-campo-busca]"), "Tab");
    expect($("[data-lista-busca]")).toBeFalsy();
  });

  it("lista grande: desenha só as primeiras e diz quantas ficaram, e a busca aperta", async () => {
    const muitos = Array.from({ length: 200 }, (_, i) => ({ value: `x${i}`, label: `Produto ${i}` }));
    await montar({}, muitos);
    await clicar($("[data-busca-select]"));
    expect(rotulos()).toHaveLength(60); // o teto
    expect(txt($("[data-busca-teto]"))).toContain("140");
    await digitar("Produto 17");
    expect(rotulos()).toEqual(["Produto 17", "Produto 170", "Produto 171", "Produto 172", "Produto 173",
      "Produto 174", "Produto 175", "Produto 176", "Produto 177", "Produto 178", "Produto 179"]);
    expect($("[data-busca-teto]"), "filtrou: ninguém ficou de fora").toBeFalsy();
  });

  it("'+ Novo …' só existe quando a tela manda, e sai do caminho da escolha", async () => {
    await montar();
    await clicar($("[data-busca-select]"));
    expect($("[data-acao-busca]"), "sem acao, não há pé de lista").toBeFalsy();
    await clicar($("[data-busca-select]"));

    let chamou = 0;
    await montar({ acao: { rotulo: "Novo colaborador…", onClick: () => { chamou += 1; } } });
    await clicar($("[data-busca-select]"));
    expect(txt($("[data-acao-busca]"))).toBe("Novo colaborador…");
    expect(rotulos(), "a ação não entra na lista de opções").toHaveLength(4);
    await clicar($("[data-acao-busca]"));
    expect(chamou).toBe(1);
    expect($("[data-lista-busca]"), "clicar na ação fecha a lista").toBeFalsy();
  });

  it("desabilitado não abre nem pelo clique nem pelo teclado", async () => {
    await montar({ disabled: true });
    await clicar($("[data-busca-select]"));
    expect($("[data-lista-busca]")).toBeFalsy();
    await tecla($("[data-busca-select]"), "ArrowDown");
    expect($("[data-lista-busca]")).toBeFalsy();
  });

  it("leitor de tela: combobox com estado, listbox e opções com papel", async () => {
    await montar({ rotulo: "Colaborador" });
    const campo = $("[data-busca-select]")!;
    expect(campo.getAttribute("role")).toBe("combobox");
    expect(campo.getAttribute("aria-expanded")).toBe("false");
    expect(campo.getAttribute("aria-label")).toBe("Colaborador");
    await clicar(campo);
    expect(campo.getAttribute("aria-expanded")).toBe("true");
    expect($("[data-lista-busca] [role=listbox]"), "a lista é um listbox").toBeTruthy();
    expect($("[data-opcao='p1']")!.getAttribute("role")).toBe("option");
  });

  it("o valor que vem de fora aparece escolhido (registro já gravado)", async () => {
    await montar({ value: "p2" });
    expect(txt($("[data-valor-escolhido]"))).toBe("Maria Antônia");
  });
});

/* ───────── o seletor de cadastro em cima dele ───────── */

describe("SeletorCadastro: o pé '+ Novo …' obedece à permissão de criar", () => {
  const CARGOS = [{ id: "c1", nome: "Técnico", ativo: true }, { id: "c2", nome: "Encarregado", ativo: true }];

  async function comPermissoes(permissoes: Permissoes) {
    const { SeletorCadastro } = await import("@/components/cadastros/seletor-cadastro");
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    await act(async () => {
      root.render(createElement(PermissoesProvider, {
        role: "OPERADOR", permissoes,
        children: createElement(SeletorCadastro, { entidade: "cargos", itens: CARGOS, valor: "", onChange: () => {} }),
      }));
    });
    await esperar();
    await clicar($("[data-busca-select]"));
  }

  it("quem pode criar vê o pé da lista", async () => {
    await comPermissoes(permissoesTotais());
    expect(txt($("[data-acao-busca]"))).toBe("Novo cargo…");
    expect(rotulos()).toEqual(["Técnico", "Encarregado"]);
  });

  it("quem só visualiza não vê o pé — mas escolher continua possível", async () => {
    await comPermissoes(permissoesVazias());
    expect($("[data-acao-busca]"), "sem a permissão de criar, não há atalho de cadastro").toBeFalsy();
    expect(rotulos()).toEqual(["Técnico", "Encarregado"]);
  });
});
