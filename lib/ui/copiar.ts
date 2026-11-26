/**
 * Copiar texto para a área de transferência — sem fingir que copiou.
 *
 * Por que o "Copiar link" do orçamento falhava calado: a cópia era feita DEPOIS de esperar o servidor
 * (`await fetch`), e o erro era engolido (`.catch(() => {})`) com a tela dizendo "Link copiado." de
 * qualquer jeito. O navegador recusa a escrita (`NotAllowedError`) quando:
 *  - a escrita não acontece dentro do toque/clique (Safari e iOS: depois de uma espera de rede já não vale);
 *  - a página não é contexto seguro (http fora do localhost): `navigator.clipboard` nem existe;
 *  - a permissão de escrita foi negada ou a aba perdeu o foco.
 *
 * A regra daqui:
 *  1. chame `copiarTexto` NO PRÓPRIO CLIQUE, antes de qualquer `await` — a escrita começa dentro do gesto;
 *  2. tenta a API moderna (`navigator.clipboard.writeText`) em contexto seguro;
 *  3. se ela não existe ou recusa, tenta o comando clássico de copiar (uma área de texto escondida e
 *     selecionada) — funciona em http e em navegadores antigos;
 *  4. devolve como copiou ("api" | "comando") ou `null` se nada funcionou. Com `null`, a tela mostra o
 *     texto selecionado para a pessoa copiar à mão — nunca diz "copiado" sem ter copiado.
 */

export type ComoCopiou = "api" | "comando";

/** O que a cópia precisa do navegador (injetável para teste) */
export interface AmbienteCopia {
  /** `navigator.clipboard` (ausente fora de contexto seguro) */
  clipboard?: { writeText(texto: string): Promise<void> } | null;
  /** `window.isSecureContext` */
  seguro: boolean;
  /** O comando clássico de copiar (área de texto selecionada + execCommand) — true se copiou */
  copiarPorComando(texto: string): boolean;
}

/** Área de texto fora da tela, selecionada e copiada; devolve o foco para onde estava. */
export function copiarPorComando(texto: string, doc: Document = document): boolean {
  const ativo = doc.activeElement as HTMLElement | null;
  const area = doc.createElement("textarea");
  area.value = texto;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  area.style.opacity = "0";
  doc.body.appendChild(area);
  try {
    // foco + seleção: o iOS só copia o que está selecionado num campo focado
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, texto.length);
    return typeof doc.execCommand === "function" && doc.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    area.remove();
    ativo?.focus?.();
  }
}

export function ambienteDoNavegador(): AmbienteCopia {
  return {
    clipboard: typeof navigator !== "undefined" ? navigator.clipboard ?? null : null,
    seguro: typeof window !== "undefined" ? window.isSecureContext !== false : false,
    copiarPorComando: (t) => copiarPorComando(t),
  };
}

/**
 * Copia `texto`. Chame no clique, ANTES de qualquer `await` (a escrita tem de começar dentro do gesto).
 * Devolve como copiou, ou `null` (nada funcionou: mostre o texto para copiar à mão).
 */
export async function copiarTexto(texto: string, amb: AmbienteCopia = ambienteDoNavegador()): Promise<ComoCopiou | null> {
  if (!texto) return null;
  if (amb.seguro && amb.clipboard?.writeText) {
    try {
      await amb.clipboard.writeText(texto);
      return "api";
    } catch {
      // recusado (permissão, gesto, foco): tenta o comando clássico
    }
  }
  try {
    return amb.copiarPorComando(texto) ? "comando" : null;
  } catch {
    return null;
  }
}
