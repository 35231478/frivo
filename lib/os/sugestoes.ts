/**
 * SUGESTÕES DA ABERTURA DA OS (Princípio 9: sugere, não preenche no escuro).
 *
 * Ao escolher o cliente, a tela oferece o que o histórico DELE mostra:
 *  - quem executa: o ÚLTIMO técnico/equipe que o atendeu;
 *  - tipo de OS: o MAIS USADO nele.
 *
 * Regras (as mesmas na tela e no servidor):
 *  - só olha os últimos JANELA_MESES meses;
 *  - conta OS DISTINTAS, não atividades: uma OS partida em três atividades do mesmo técnico é UM
 *    atendimento, não três;
 *  - só sugere com pelo menos MINIMO_OS no período (histórico fino não sugere);
 *  - empate no mais usado não sugere (não existe "o mais usado");
 *  - a sugestão é sempre editável e a tela diz de onde veio.
 */

export const JANELA_MESES = 6;
export const MINIMO_OS = 2;

/** Uma atividade do histórico do cliente, da mais nova para a mais antiga. */
export interface AtividadeDoHistorico {
  ordemServicoId: string;
  tipoOsId: string | null;
  tecnicoId: string | null;
  equipeId: string | null;
}

export type Executor = { tipo: "tecnico" | "equipe"; id: string };

/** O sugerido e em quantas OS ele apareceu no período (o motivo que a tela mostra). */
export interface Sugestao<T> { valor: T; vezes: number }

export interface SugestoesDoCliente {
  tipoOs: Sugestao<string> | null;
  executor: Sugestao<Executor> | null;
}

/** O instante a partir do qual o histórico conta (janela móvel de JANELA_MESES). */
export function inicioDaJanela(agora: Date = new Date()): Date {
  const d = new Date(agora);
  d.setMonth(d.getMonth() - JANELA_MESES);
  return d;
}

/** Em quantas OS DISTINTAS cada valor aparece. */
function osPorValor(itens: readonly AtividadeDoHistorico[], valorDe: (a: AtividadeDoHistorico) => string | null): Map<string, Set<string>> {
  const mapa = new Map<string, Set<string>>();
  for (const a of itens) {
    const v = valorDe(a);
    if (!v) continue;
    if (!mapa.has(v)) mapa.set(v, new Set());
    mapa.get(v)!.add(a.ordemServicoId);
  }
  return mapa;
}

/**
 * O valor presente em mais OS — ou null quando não há um claro: menos de `minimo` OS, ou empate na
 * primeira posição.
 */
export function maisUsado(
  itens: readonly AtividadeDoHistorico[],
  valorDe: (a: AtividadeDoHistorico) => string | null,
  minimo = MINIMO_OS,
): Sugestao<string> | null {
  const ordenado = [...osPorValor(itens, valorDe).entries()]
    .map(([valor, os]) => ({ valor, vezes: os.size }))
    .sort((a, b) => b.vezes - a.vezes);
  if (ordenado.length === 0) return null;
  const topo = ordenado[0];
  if (topo.vezes < minimo) return null;
  if (ordenado.length > 1 && ordenado[1].vezes === topo.vezes) return null; // empate: não há "o mais usado"
  return topo;
}

/** A chave do executor de uma atividade ("equipe:xyz" / "tecnico:abc"); a equipe tem precedência. */
export function chaveDoExecutor(a: AtividadeDoHistorico): string | null {
  if (a.equipeId) return `equipe:${a.equipeId}`;
  if (a.tecnicoId) return `tecnico:${a.tecnicoId}`;
  return null;
}

const executorDaChave = (chave: string): Executor => {
  const corte = chave.indexOf(":");
  return { tipo: chave.slice(0, corte) === "equipe" ? "equipe" : "tecnico", id: chave.slice(corte + 1) };
};

/**
 * O ÚLTIMO executor do cliente, desde que tenha atendido pelo menos `minimo` OS no período (uma
 * visita solta não vira sugestão). `historico` vem da atividade mais nova para a mais antiga.
 */
export function ultimoExecutor(historico: readonly AtividadeDoHistorico[], minimo = MINIMO_OS): Sugestao<Executor> | null {
  const ultima = historico.map(chaveDoExecutor).find((c): c is string => !!c);
  if (!ultima) return null;
  const vezes = osPorValor(historico, chaveDoExecutor).get(ultima)?.size ?? 0;
  if (vezes < minimo) return null;
  return { valor: executorDaChave(ultima), vezes };
}

/** As duas sugestões do cliente, a partir do histórico já filtrado pela janela. */
export function sugestoesDoCliente(historico: readonly AtividadeDoHistorico[]): SugestoesDoCliente {
  return { tipoOs: maisUsado(historico, (a) => a.tipoOsId), executor: ultimoExecutor(historico) };
}

/** O texto ao lado do campo: de onde veio a sugestão (nunca "a IA escolheu"). */
export function notaDaSugestao(vezes: number, oQue: "tipo" | "executor"): string {
  const base = oQue === "tipo" ? "O tipo mais usado neste cliente" : "Quem atendeu este cliente da última vez";
  return `${base} — ${vezes} OS nos últimos ${JANELA_MESES} meses. Confira antes de salvar.`;
}
