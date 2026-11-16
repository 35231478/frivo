import { act } from "react";

/**
 * Ajuda dos testes para o seletor com BUSCA da casa (components/ui/busca-select).
 *
 * Antes, quando o seletor era um `<select>` nativo, o teste setava `value` e disparava `change`.
 * Agora ele faz o que a pessoa faz: abre a lista, digita (quando quer provar que o filtro funciona)
 * e clica na opção. É mais longo, e é o ponto: o teste passa pelo mesmo caminho da tela.
 */

/** O campo (o <div> com os data-* da tela, ou o próprio botão) → a raiz do seletor */
function raizDo(campo: Element | null | undefined, onde: string): HTMLElement {
  if (!campo) throw new Error(`seletor com busca não encontrado: ${onde}`);
  const el = campo as HTMLElement;
  if (el.hasAttribute("data-busca-select")) return el.parentElement as HTMLElement;
  return el;
}

const respirar = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** Abre a lista do seletor (e devolve a raiz dele). */
export async function abrirBusca(campo: Element | null | undefined, onde = "sem nome") {
  const raiz = raizDo(campo, onde);
  const botao = raiz.querySelector<HTMLElement>("[data-busca-select]");
  if (!botao) throw new Error(`o campo não é um seletor com busca: ${onde}`);
  if (!raiz.querySelector("[data-lista-busca]")) await act(async () => { botao.click(); });
  await respirar();
  return raiz;
}

/** Digita na busca do seletor já aberto (filtra a lista). */
export async function digitarNaBusca(raiz: HTMLElement, texto: string) {
  const input = raiz.querySelector<HTMLInputElement>("[data-campo-busca]");
  if (!input) throw new Error("a lista do seletor não está aberta");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, texto);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await respirar();
}

/** As opções que a lista aberta está mostrando, na ordem. */
export const opcoesDaBusca = (raiz: HTMLElement) =>
  [...raiz.querySelectorAll("[data-opcao]")].map((o) => (o.textContent ?? "").trim());

/**
 * Escolhe um item: abre, digita quando `filtrando` vem, e clica na opção do valor pedido.
 * `campo` é o elemento com o data-* da tela (ex.: `[data-seletor-cadastro="produtos"]`).
 */
export async function escolherNaBusca(campo: Element | null | undefined, valor: string, filtrando?: string) {
  const raiz = await abrirBusca(campo, valor);
  if (filtrando) await digitarNaBusca(raiz, filtrando);
  const opcao = raiz.querySelector<HTMLElement>(`[data-opcao="${CSS.escape(valor)}"]`);
  if (!opcao) {
    const tem = opcoesDaBusca(raiz).join(" | ") || "(nenhuma)";
    throw new Error(`a opção "${valor}" não está na lista. Mostrando: ${tem}`);
  }
  await act(async () => { opcao.click(); });
  await respirar();
}

/** Limpa a escolha (o × do campo). */
export async function limparBusca(campo: Element | null | undefined, onde = "sem nome") {
  const raiz = raizDo(campo, onde);
  const x = raiz.querySelector<HTMLElement>("[data-limpar-busca]");
  if (!x) throw new Error(`nada escolhido para limpar: ${onde}`);
  await act(async () => { x.click(); });
  await respirar();
}

/** O que o campo mostra escolhido agora (o rótulo, não o valor). */
export const escolhidoNaBusca = (campo: Element | null | undefined, onde = "sem nome") =>
  (raizDo(campo, onde).querySelector("[data-valor-escolhido]")?.textContent ?? "").trim();

/** O valor escolhido (o id), ou "" quando nada está escolhido. */
export const valorDaBusca = (campo: Element | null | undefined, onde = "sem nome") =>
  raizDo(campo, onde).querySelector("[data-valor-escolhido]")?.getAttribute("data-valor-escolhido") ?? "";
