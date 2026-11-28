/**
 * A ÁREA VISÍVEL do app do técnico (PWA na tela de início, iPhone e Android) — regras PURAS.
 *
 * No iPhone (e no Chrome do Android, por padrão) o teclado NÃO encolhe a página: encolhe só a área visível
 * (`visualViewport`). Quem usa a altura da janela (100dvh, `innerHeight`) fica com o rodapé atrás do teclado — e quem
 * soma alturas fixas erra no iPhone instalado (o topo ganha a área do relógio, `safe-area-inset-top`). Por isso a tela
 * Chat mede: a altura visível de verdade, o topo e a barra inferior como estão desenhados.
 */

/** Quanto a área visível precisa encolher (sem zoom) para contar como teclado aberto */
export const TECLADO_MIN_PX = 120;

export interface AreaVisivel {
  /** A altura que se vê agora (sem o teclado) */
  altura: number;
  /** Quanto a área visível desceu na página (o iPhone rola a página ao abrir o teclado) */
  deslocamento: number;
  /** O teclado está aberto: a barra inferior some e o rodapé do chat encosta no teclado */
  teclado: boolean;
}

/**
 * O teclado está aberto? A área visível encolheu bem (não é zoom de pinça) e há um campo de texto em foco — a barra de
 * endereço do navegador que some/aparece e o zoom não contam.
 */
export function tecladoAberto(a: { alturaJanela: number; alturaVisivel: number; escala?: number; focoEmCampo: boolean }): boolean {
  if (!a.focoEmCampo) return false;
  if ((a.escala ?? 1) > 1.05) return false;
  return a.alturaJanela - a.alturaVisivel > TECLADO_MIN_PX;
}

/** O que a tela usa, a partir da janela (com ou sem `visualViewport`, que navegador antigo e teste não têm). */
export function areaVisivelDe(janela: { innerHeight: number; visualViewport?: { height: number; offsetTop: number; scale?: number } | null }, focoEmCampo: boolean): AreaVisivel {
  const vv = janela.visualViewport;
  const altura = Math.round(vv?.height ?? janela.innerHeight);
  return {
    altura,
    deslocamento: Math.max(0, Math.round(vv?.offsetTop ?? 0)),
    teclado: tecladoAberto({ alturaJanela: janela.innerHeight, alturaVisivel: altura, escala: vv?.scale, focoEmCampo }),
  };
}

/** O campo em foco é de digitar (abre teclado)? */
export function ehCampoDeTexto(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !["checkbox", "radio", "button", "submit", "file", "range", "color"].includes((el as HTMLInputElement).type);
  return (el as HTMLElement).isContentEditable === true;
}
