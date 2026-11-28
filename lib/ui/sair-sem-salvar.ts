/**
 * "Sair sem salvar" — as decisões puras do aviso (a tela só liga os eventos: components/ui/proteger-saida).
 *
 * O formulário fica "com alterações" quando a pessoa digita ou muda um campo DENTRO dele (campos marcados com
 * `data-sem-aviso`, como uma busca, não contam). Com alterações, sair pede confirmação:
 *  - clicando num link interno (menu, breadcrumb, "Cancelar");
 *  - no voltar do navegador;
 *  - fechando ou recarregando a aba (o navegador mostra o aviso dele).
 * Depois de salvar não pergunta: o envio do formulário segura o aviso enquanto o salvar navega para a próxima tela,
 * e quem salva e fica na mesma tela chama `marcarFormularioSalvo()`.
 */
export const TEXTO_SAIR_SEM_SALVAR = {
  titulo: "Sair sem salvar?",
  mensagem: "As alterações deste formulário ainda não foram salvas.",
  confirmarTexto: "Sair sem salvar",
  cancelarTexto: "Continuar editando",
} as const;

/** Depois do envio, o tempo em que o salvar costuma navegar para a próxima tela (sem perguntar) */
export const JANELA_DO_ENVIO_MS = 8000;

/** O evento que um formulário dispara ao salvar e continuar na mesma tela */
export const EVENTO_FORMULARIO_SALVO = "frivo:formulario-salvo";
export const marcarFormularioSalvo = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_FORMULARIO_SALVO)); };

/** O clique neste link sai da tela? (link interno, mesma aba, para outro endereço) */
export function linkSaiDaTela(p: {
  href: string | null; alvo: string | null; download: boolean; modificador: boolean; botao: number;
  origem: string; atual: string;
}): boolean {
  if (!p.href || p.download || p.modificador || p.botao !== 0) return false;
  if (p.alvo && p.alvo !== "_self") return false;
  if (p.href.startsWith("#") || p.href.startsWith("mailto:") || p.href.startsWith("tel:") || p.href.startsWith("javascript:")) return false;
  let destino: URL;
  try { destino = new URL(p.href, p.atual); } catch { return false; }
  if (destino.origin !== p.origem) return false;
  const aqui = new URL(p.atual);
  return destino.pathname + destino.search !== aqui.pathname + aqui.search;
}

/** Pergunta agora? Só com alterações e fora da janela do envio (o salvar a caminho) */
export const devePerguntar = (s: { sujo: boolean; enviadoEm: number | null; agora: number }) =>
  s.sujo && !(s.enviadoEm != null && s.agora - s.enviadoEm < JANELA_DO_ENVIO_MS);
