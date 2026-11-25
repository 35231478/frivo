/**
 * A LINHA INTEIRA abre o registro — a regra, pura (sem React, sem navegação).
 *
 * Nas listas da casa só o número/nome abria o registro; o resto da linha era "morto". Agora a
 * linha inteira abre, mas NUNCA por cima de um controle dela: o checkbox da seleção em massa, o
 * botão de ações, um link, um campo — clicar nisso faz o que isso faz, e só. Também não abre quando
 * a pessoa está selecionando texto (arrastou o mouse para copiar o nome), nem nas colunas de
 * serviço (`fixa`: checkbox, ações), que são só controles.
 *
 * O link do número continua existindo (botão direito › abrir em nova aba); Ctrl/⌘ + clique e o
 * botão do meio na linha abrem em nova aba também.
 */

/** O que, dentro da linha, é um controle: clicar nele não abre o registro */
export const SELETOR_CONTROLE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="menu"], [role="menuitem"], [role="dialog"], [contenteditable="true"], [data-nao-abre]';

/**
 * Um clique neste alvo deve abrir a linha? `selecao` é o texto selecionado na página no momento
 * do clique (o fim de um arrasto para copiar não é um clique para abrir).
 */
export function cliqueAbreLinha(alvo: Element | null, linha: Element, selecao = ""): boolean {
  if (!alvo || !linha.contains(alvo)) return false;
  if (selecao.trim() !== "") return false;
  const controle = alvo.closest(SELETOR_CONTROLE);
  if (controle && linha.contains(controle)) return false;
  const celula = alvo.closest("td");
  if (celula && linha.contains(celula) && celula.hasAttribute("data-fixa")) return false;
  return true;
}

export type DestinoDoClique = "mesma-aba" | "nova-aba" | "nenhum";

/** Para onde vai o clique: botão esquerdo abre aqui; com Ctrl/⌘ (ou o botão do meio) abre em nova aba; o resto não abre. */
export function destinoDoClique(e: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): DestinoDoClique {
  if (e.altKey) return "nenhum";
  if (e.button === 1) return "nova-aba";
  if (e.button !== 0) return "nenhum";
  if (e.ctrlKey || e.metaKey || e.shiftKey) return "nova-aba";
  return "mesma-aba";
}

/** No teclado, só Enter com o foco NA linha (não num controle dentro dela) abre o registro. */
export function teclaAbreLinha(e: { key: string; target: EventTarget | null; currentTarget: EventTarget | null }): boolean {
  return e.key === "Enter" && e.target === e.currentTarget;
}
