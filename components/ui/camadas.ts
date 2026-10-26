/**
 * Pilha das camadas abertas (gavetas e modais), para quando uma abre dentro da outra (ex.: o
 * modal de edição de um cadastro dentro da gaveta de Configurações):
 *  - Esc fecha SÓ a camada do topo;
 *  - o scroll da página fica travado enquanto houver qualquer camada aberta.
 */
const pilha: symbol[] = [];
let overflowAntes = "";

export function abrirCamada(): symbol {
  const id = Symbol("camada");
  if (pilha.length === 0 && typeof document !== "undefined") {
    overflowAntes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  pilha.push(id);
  return id;
}

export function fecharCamada(id: symbol) {
  const i = pilha.indexOf(id);
  if (i >= 0) pilha.splice(i, 1);
  if (pilha.length === 0 && typeof document !== "undefined") document.body.style.overflow = overflowAntes;
}

export const noTopo = (id: symbol) => pilha[pilha.length - 1] === id;

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab/Shift+Tab não saem do painel (foco preso na camada do topo). */
export function prenderFoco(e: KeyboardEvent, painel: HTMLElement | null) {
  if (e.key !== "Tab" || !painel) return;
  const itens = [...painel.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (itens.length === 0) { e.preventDefault(); painel.focus(); return; }
  const primeiro = itens[0], ultimo = itens[itens.length - 1];
  const ativo = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (ativo === primeiro || !painel.contains(ativo))) { e.preventDefault(); ultimo.focus(); }
  else if (!e.shiftKey && (ativo === ultimo || !painel.contains(ativo))) { e.preventDefault(); primeiro.focus(); }
}
