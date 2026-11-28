/**
 * Onde abre um menu flutuante (em portal, `position: fixed`) preso a um botão — um cálculo só para os menus do
 * painel ("Colunas" das tabelas, ⋮ de ações). Nunca é recortado pelo container (a tabela com rolagem, a lista curta
 * de um veículo só): abre para baixo se couber; senão para o lado com mais espaço; a altura máxima é o espaço que
 * sobra (com folga), e o menu rola por dentro. Alinha pela direita do botão, sem sair da tela.
 */
export interface Retangulo { top: number; bottom: number; left: number; right: number }
export interface Janela { largura: number; altura: number }
export interface PosicaoFlutuante { top?: number; bottom?: number; right: number; maxHeight: number }

export const FOLGA_FLUTUANTE = 8;

export function posicaoFlutuante(ancora: Retangulo, janela: Janela, alturaDesejada: number, folga = FOLGA_FLUTUANTE): PosicaoFlutuante {
  const right = Math.max(folga, janela.largura - ancora.right);
  const abaixo = janela.altura - ancora.bottom - folga;
  const acima = ancora.top - folga;
  if (abaixo >= alturaDesejada || abaixo >= acima) {
    return { top: ancora.bottom + 4, right, maxHeight: Math.max(120, abaixo - 4) };
  }
  return { bottom: janela.altura - ancora.top + 4, right, maxHeight: Math.max(120, acima - 4) };
}
