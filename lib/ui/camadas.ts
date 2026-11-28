/**
 * A ESCALA DE CAMADAS (z-index) DO PAINEL — um lugar só. Quem abre por cima de quem:
 *
 *   conteúdo (cabeçalhos presos, listas)       z-10 … z-50 (dentro da página)
 *   GAVETA (Drawer)                            60
 *   MODAL (Modal, inativar/excluir com impacto) 70  — acima da gaveta: o modal aberto de dentro dela fica clicável
 *   LIGHTBOX (foto em tela cheia)              75
 *   FLUTUANTE (menus e dicas em portal)        80  — o menu "Colunas", o ⋮ de ações e as dicas abrem por cima de tudo isso
 *   ANOTAÇÕES (ferramenta do dono do Frivo)    84 … 89 — o botão continua clicável com gaveta ou modal aberto
 *   CONFIRMAÇÃO (confirmar() dos avisos)       95
 *   TOAST                                       100 — o aviso aparece por cima até da confirmação
 *
 * As classes ficam literais aqui (o Tailwind lê lib/), e cada componente compartilhado usa a sua.
 */
export const CAMADA = {
  gaveta: "z-[60]",
  modal: "z-[70]",
  lightbox: "z-[75]",
  flutuante: "z-[80]",
  anotacoesFundo: "z-[84]",
  anotacoesPino: "z-[86]",
  anotacoesBotao: "z-[87]",
  anotacoesBarra: "z-[88]",
  anotacoesCaixa: "z-[89]",
  confirmacao: "z-[95]",
  toast: "z-[100]",
} as const;

export type Camada = keyof typeof CAMADA;

/** O número de cada camada (para conferir a ordem em teste) */
export const valorCamada = (c: Camada) => Number(/\d+/.exec(CAMADA[c])![0]);
