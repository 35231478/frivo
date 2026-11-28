/**
 * O botão flutuante "Anotar" pode ser ARRASTADO (mouse ou dedo) para não cobrir o que se quer ver. A posição
 * fica neste navegador, por usuário (localStorage), e nunca sai da área visível. Regras puras; a tela é
 * components/anotacoes/ferramenta.
 */

export interface Ponto { x: number; y: number }
export interface Tamanho { w: number; h: number }

/** Distância mínima (px) para um toque/clique virar arraste — abaixo disso é clique (liga o modo) */
export const LIMIAR_ARRASTE = 5;
/** Folga mínima até a borda da janela */
export const MARGEM_BORDA = 8;

export const chavePosicaoBotao = (usuarioId: string) => `frivo:anotacoes-botao:${usuarioId}`;

/** A posição gravada (JSON {x,y}), ou null se não houver ou estiver estragada. */
export function lerPosicao(texto: string | null | undefined): Ponto | null {
  if (!texto) return null;
  try {
    const v = JSON.parse(texto) as unknown;
    if (!v || typeof v !== "object") return null;
    const { x, y } = v as Record<string, unknown>;
    return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  } catch {
    return null;
  }
}

/** Prende o canto de cima/esquerda do botão dentro da janela (com a folga), mesmo se a janela encolher. */
export function limitarPosicao(p: Ponto, botao: Tamanho, janela: Tamanho, margem = MARGEM_BORDA): Ponto {
  const maxX = Math.max(margem, janela.w - botao.w - margem);
  const maxY = Math.max(margem, janela.h - botao.h - margem);
  return { x: Math.round(Math.min(Math.max(p.x, margem), maxX)), y: Math.round(Math.min(Math.max(p.y, margem), maxY)) };
}

/** O ponteiro andou o bastante para ser arraste (e não um clique)? */
export const ehArraste = (inicio: Ponto, agora: Ponto, limiar = LIMIAR_ARRASTE) => Math.hypot(agora.x - inicio.x, agora.y - inicio.y) >= limiar;

/** Onde o botão vai: a posição de quando o arraste começou + o quanto o ponteiro andou, presa na janela. */
export function posicaoArrastada(origemBotao: Ponto, inicioPonteiro: Ponto, ponteiro: Ponto, botao: Tamanho, janela: Tamanho): Ponto {
  return limitarPosicao({ x: origemBotao.x + ponteiro.x - inicioPonteiro.x, y: origemBotao.y + ponteiro.y - inicioPonteiro.y }, botao, janela);
}

/**
 * Onde fica o botão "voltar à posição padrão": à esquerda do botão de anotações (40 px antes); encostado na borda
 * esquerda (não cabe), à direita dele — nunca por cima.
 */
export function posicaoDoVoltar(botao: Ponto, larguraBotao: number): { left: number; top: number } {
  const esquerda = botao.x - 40;
  return { left: esquerda >= 8 ? esquerda : botao.x + larguraBotao + 8, top: botao.y + 2 };
}
