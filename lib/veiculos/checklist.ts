/**
 * Checklist de veículo PREENCHIDO — as regras puras (tela, rota e testes usam as mesmas).
 *
 * - Um item gera alerta quando a resposta não é a primeira opção (a primeira é o estado saudável).
 * - O checklist fica "Com alertas" se qualquer item gerou alerta; senão, "Concluído".
 * - Excluir é reversível: o checklist INATIVADO sai da lista e das contagens, mas fica no banco.
 * - Checklist inativado não se edita (reative antes).
 */

export type StatusChecklistVeiculo = "PENDENTE" | "CONCLUIDO" | "COM_ALERTAS";

export interface ItemDoModelo {
  id: string;
  categoria: string;
  descricao: string;
  tipo: string;
  opcoes: string[];
  obrigatorio: boolean;
  ordem: number;
}
export interface RespostaDoItem { valor: string | null; foto: string | null }

export const ROTULO_STATUS_CHECKLIST: Record<string, string> = { CONCLUIDO: "Concluído", COM_ALERTAS: "Com alertas", PENDENTE: "Pendente" };

/** Tipos de item respondidos escolhendo uma opção (a primeira é a saudável) */
const TIPOS_DE_OPCAO = ["OK_NOK", "NIVEL"];
export const itemDeOpcao = (tipo: string) => TIPOS_DE_OPCAO.includes(tipo);

/**
 * As opções que o técnico vê num item de opção. Modelo salvo sem opções (o editor deixava apagar; a API aceita a
 * lista vazia) não pode deixar o item obrigatório SEM BOTÃO — o técnico ficava preso no checklist do dia. Vale
 * "OK / NOK" (a primeira, a saudável).
 */
export const OPCOES_PADRAO = ["OK", "NOK"] as const;
export function opcoesDoItem(item: Pick<ItemDoModelo, "tipo" | "opcoes">): string[] {
  if (!itemDeOpcao(item.tipo)) return [];
  const limpas = (item.opcoes ?? []).map((o) => o.trim()).filter(Boolean);
  return limpas.length ? limpas : [...OPCOES_PADRAO];
}

/** O item gera alerta? Só item de opção, respondido, e fora da primeira opção. */
export function itemGeraAlerta(item: Pick<ItemDoModelo, "tipo" | "opcoes">, valor: string | null | undefined): boolean {
  if (!valor || !itemDeOpcao(item.tipo)) return false;
  return valor !== opcoesDoItem(item)[0];
}

/** Situação do checklist a partir dos alertas dos itens */
export const statusPelosAlertas = (alertas: readonly boolean[]): "CONCLUIDO" | "COM_ALERTAS" => (alertas.some(Boolean) ? "COM_ALERTAS" : "CONCLUIDO");

/**
 * O primeiro item obrigatório sem resposta — ou null, se está tudo respondido. Item de foto pede a
 * foto; os outros, o valor. A mensagem é a que a tela e a rota mostram.
 */
export function primeiroObrigatorioFaltando(itens: readonly ItemDoModelo[], respostas: Record<string, RespostaDoItem | undefined>): string | null {
  for (const it of itens) {
    if (!it.obrigatorio) continue;
    const r = respostas[it.id];
    if (it.tipo === "FOTO") { if (!r?.foto) return `Anexe a foto: ${it.descricao}`; }
    else if (!(r?.valor ?? "").trim()) return `Preencha: ${it.descricao}`;
  }
  return null;
}

/** Os itens agrupados por categoria, na ordem do modelo */
export function porCategoria<T extends Pick<ItemDoModelo, "categoria" | "ordem">>(itens: readonly T[]): [string, T[]][] {
  const mapa = new Map<string, T[]>();
  for (const it of [...itens].sort((a, b) => a.ordem - b.ordem)) {
    if (!mapa.has(it.categoria)) mapa.set(it.categoria, []);
    mapa.get(it.categoria)!.push(it);
  }
  return [...mapa.entries()];
}

/** Quem pode o quê no checklist preenchido (o servidor confere a mesma coisa) */
export const PERMISSAO_CHECKLIST = {
  ver: { modulo: "veiculos", acao: "visualizar" },
  editar: { modulo: "veiculos", acao: "gerenciar" },
  inativar: { modulo: "veiculos", acao: "excluir" },
  reativar: { modulo: "veiculos", acao: "gerenciar" },
} as const;

export const ERRO_CHECKLIST_INATIVO = "Checklist inativado: reative antes de editar.";
