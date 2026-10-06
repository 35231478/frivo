/**
 * Exibição dos técnicos de uma atividade (arquivo puro: servidor e cliente).
 * Responsável (`tecnico`) primeiro, depois os demais (`tecnicosEquipe`), e a equipe usada.
 */
export interface TecnicosAtividadeInfo {
  tecnico?: { nome: string } | null;
  tecnicosEquipe?: { tecnico: { nome: string } }[];
  equipe?: { nome: string } | null;
}

export function nomesTecnicosAtividade(a: TecnicosAtividadeInfo): string[] {
  return [...new Set([a.tecnico?.nome, ...(a.tecnicosEquipe ?? []).map((t) => t.tecnico.nome)].filter(Boolean) as string[])];
}

/** "Equipe Alfa: João (responsável), Maria, Pedro" · "João" · null */
export function textoTecnicosAtividade(a: TecnicosAtividadeInfo): string | null {
  const nomes = nomesTecnicosAtividade(a);
  if (!nomes.length) return a.equipe ? `Equipe ${a.equipe.nome}` : null;
  const lista = nomes.length > 1 ? [`${nomes[0]} (responsável)`, ...nomes.slice(1)].join(", ") : nomes[0];
  return a.equipe ? `Equipe ${a.equipe.nome}: ${lista}` : lista;
}

export const MSG_SEM_EXECUTOR_TELA = "Escolha quem executa: uma equipe ou um ou mais colaboradores.";

/** Atividades antigas (antes da seleção obrigatória) podem não ter executor — só exibimos o aviso. */
export function atividadeSemExecutor(a: any) {
  return !!a && !a.tecnico?.id && !a.tecnicoId && !(a.tecnicosEquipe ?? []).length;
}
