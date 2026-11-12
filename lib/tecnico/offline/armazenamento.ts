/**
 * Armazenamento do aparelho PROTEGIDO: por padrão o navegador pode limpar o IndexedDB de um site
 * quando falta espaço. O app pede que o dele seja "persistente" — o navegador só apaga por decisão
 * do usuário. É um pedido: há navegador que nega (em geral concede a app instalado na tela inicial).
 * Nunca lança; sem a API, devolve "desconhecido".
 */
export type Armazenamento = "protegido" | "comum" | "desconhecido";

export async function protegerArmazenamento(nav: Pick<Navigator, "storage"> | undefined = typeof navigator === "undefined" ? undefined : navigator): Promise<Armazenamento> {
  try {
    const s = nav?.storage;
    if (!s?.persist) return "desconhecido";
    if (s.persisted && (await s.persisted())) return "protegido";
    return (await s.persist()) ? "protegido" : "comum";
  } catch {
    return "desconhecido";
  }
}

export const MSG_SEM_ESPACO = "Não deu para guardar no aparelho (sem espaço?). Libere espaço e toque de novo.";
