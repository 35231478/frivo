/**
 * O MENU LATERAL (desktop): aberto ou fechado, lembrado POR USUÁRIO — a regra pura (a tela só aplica).
 *
 *  - O clique no botão FIXA: "aberto" ou "fechado". Fica lembrado (por usuário, no navegador).
 *  - Sem escolha feita: largo (≥ 1280 px) abre; estreito (notebook) começa recolhido para dar espaço à página.
 *  - Passar o mouse expande TEMPORARIAMENTE (por cima da página, sem empurrar nada) só quando o menu está recolhido
 *    sem que a pessoa tenha fechado de propósito. Quem clicou para fechar não vê o menu abrir sozinho.
 */
export type PreferenciaMenu = "aberto" | "fechado" | null;

export const LARGURA_MENU_AUTOMATICO = 1280;

export const chaveMenuLateral = (usuarioId: string) => `frivo:menu-lateral:${usuarioId}`;
/** A chave antiga (de antes de ser por usuário): "1" = recolhido; vale enquanto a pessoa não escolher de novo */
export const CHAVE_MENU_ANTIGA = "frivo:sidebar-recolhido";

export function lerPreferenciaMenu(valor: string | null, antiga: string | null = null): PreferenciaMenu {
  if (valor === "aberto" || valor === "fechado") return valor;
  if (antiga === "1") return "fechado";
  if (antiga === "0") return "aberto";
  return null;
}

export interface EstadoMenu {
  /** Ocupa a largura estreita (só ícones) na página */
  recolhido: boolean;
  /** Recolhido, mas aberto por cima pelo mouse (temporário) */
  expandidoPorHover: boolean;
}

export function estadoMenu(p: { preferencia: PreferenciaMenu; largura: number; hover: boolean }): EstadoMenu {
  if (p.preferencia === "aberto") return { recolhido: false, expandidoPorHover: false };
  if (p.preferencia === "fechado") return { recolhido: true, expandidoPorHover: false };
  const recolhido = p.largura < LARGURA_MENU_AUTOMATICO;
  return { recolhido, expandidoPorHover: recolhido && p.hover };
}

/**
 * O clique no botão: recolhido (inclusive aberto só pelo mouse) → fixa ABERTO; aberto → fixa FECHADO (e o mouse
 * deixa de abrir).
 */
export const preferenciaDoClique = (estado: EstadoMenu): Exclude<PreferenciaMenu, null> => (estado.recolhido ? "aberto" : "fechado");
