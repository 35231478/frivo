/**
 * Exibição dos técnicos de uma atividade (arquivo puro: servidor e cliente).
 * Responsável (`tecnico`) primeiro, depois os demais (`tecnicosEquipe`), e a equipe usada.
 */
export interface TecnicoComEspecialidades { nome: string; especialidades?: readonly string[] | null }
export interface TecnicosAtividadeInfo {
  tecnico?: TecnicoComEspecialidades | null;
  tecnicosEquipe?: { tecnico: TecnicoComEspecialidades }[];
  equipe?: { nome: string } | null;
}

export function nomesTecnicosAtividade(a: TecnicosAtividadeInfo): string[] {
  return [...new Set([a.tecnico?.nome, ...(a.tecnicosEquipe ?? []).map((t) => t.tecnico.nome)].filter(Boolean) as string[])];
}

/** Os técnicos da atividade sem repetir, responsável primeiro, com as especialidades de cada um */
function tecnicosAtividade(a: TecnicosAtividadeInfo): TecnicoComEspecialidades[] {
  const vistos = new Set<string>();
  return [a.tecnico, ...(a.tecnicosEquipe ?? []).map((t) => t.tecnico)].filter((t): t is TecnicoComEspecialidades => {
    if (!t?.nome || vistos.has(t.nome)) return false;
    vistos.add(t.nome);
    return true;
  });
}

export const ESPECIALIDADES_MAX = 4;
/**
 * Leva J: "especialista em VRF e Chiller" — as especialidades do cadastro do colaborador (até 4, sem repetir, sem
 * vazias). Sem nenhuma: null.
 */
export function textoEspecialidades(esp: readonly string[] | null | undefined): string | null {
  const lista = [...new Set((esp ?? []).map((e) => e.trim()).filter(Boolean))].slice(0, ESPECIALIDADES_MAX);
  if (!lista.length) return null;
  const juntas = lista.length > 1 ? `${lista.slice(0, -1).join(", ")} e ${lista.at(-1)}` : lista[0];
  return `especialista em ${juntas}`;
}

/** "João Silva — especialista em VRF e Chiller" (sem especialidade, ou desligado na empresa: só o nome) */
export function nomeComEspecialidades(t: TecnicoComEspecialidades, mostrar = true): string {
  const esp = mostrar ? textoEspecialidades(t.especialidades) : null;
  return esp ? `${t.nome} — ${esp}` : t.nome;
}

/** "Equipe Alfa" — sem repetir quando o nome já começa com "Equipe" ("Equipe Equipe Alfa") */
const rotuloEquipe = (nome: string) => (/^equipe\b/i.test(nome.trim()) ? nome.trim() : `Equipe ${nome}`);

/**
 * "Equipe Alfa: João (responsável), Maria, Pedro" · "João" · null. Com `especialidades` (Configurações › Impressão
 * da OS, padrão ligado): "João (responsável) — especialista em VRF e Chiller; Maria — especialista em Split" (o
 * ponto e vírgula separa as pessoas, já que a lista de especialidades usa vírgula).
 */
export function textoTecnicosAtividade(a: TecnicosAtividadeInfo, op: { especialidades?: boolean } = {}): string | null {
  const tecnicos = tecnicosAtividade(a);
  if (!tecnicos.length) return a.equipe ? rotuloEquipe(a.equipe.nome) : null;
  const comEsp = !!op.especialidades && tecnicos.some((t) => textoEspecialidades(t.especialidades));
  const itens = tecnicos.map((t, i) => {
    const nome = tecnicos.length > 1 && i === 0 ? `${t.nome} (responsável)` : t.nome;
    const esp = comEsp ? textoEspecialidades(t.especialidades) : null;
    return esp ? `${nome} — ${esp}` : nome;
  });
  const lista = itens.join(comEsp ? "; " : ", ");
  return a.equipe ? `${rotuloEquipe(a.equipe.nome)}: ${lista}` : lista;
}

export const MSG_SEM_EXECUTOR_TELA = "Escolha quem executa: uma equipe ou um ou mais colaboradores.";

/** Atividades antigas (antes da seleção obrigatória) podem não ter executor — só exibimos o aviso. */
export function atividadeSemExecutor(a: any) {
  return !!a && !a.tecnico?.id && !a.tecnicoId && !(a.tecnicosEquipe ?? []).length;
}
