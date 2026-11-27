/**
 * LER O QR DO EQUIPAMENTO pelo Meu dia — para onde o app leva o técnico. Módulo PURO (aparelho e testes).
 *
 * A leitura é resolvida primeiro NO APARELHO, com as OS do dia que já estão guardadas (funciona sem sinal):
 *  1. o equipamento está numa atividade de hoje (vinculado) → abre o equipamento dentro dela;
 *  2. é da unidade de uma atividade aberta de hoje, mas não está nela → abre a atividade e PERGUNTA se inclui
 *     (nada é criado sozinho);
 *  3. não está em nenhuma → a ficha do equipamento com o histórico (precisa de sinal; o servidor confere a
 *     permissão e nunca manda valores).
 * Entre várias atividades, vale a que está aberta (em andamento antes de agendada); concluída só se for a única.
 */
import type { RetratoAtividade } from "@/lib/tecnico/offline/tipos";

/** O que a etiqueta traz: a URL pública (…/qr/<token>), o token puro ou o código (QR-AAAA-NNNN). */
export function lerValorQr(valorLido: string): { token: string; codigo: string } {
  const valor = valorLido.trim();
  const m = valor.match(/\/qr\/([^/?#\s]+)/);
  return { token: m ? m[1] : valor, codigo: valor };
}

/** O QR lido é o deste equipamento? */
export function qrConfere(qr: { tokenPublico: string; codigo: string } | null | undefined, valorLido: string): boolean {
  if (!qr) return false;
  const { token, codigo } = lerValorQr(valorLido);
  return !!token && (qr.tokenPublico === token || qr.codigo === codigo);
}

export type DestinoQr =
  | { tipo: "naAtividade"; atividadeId: string; equipamentoId: string; titulo: string }
  | { tipo: "naUnidade"; atividadeId: string; equipamentoId: string; titulo: string }
  | { tipo: "ficha"; valor: string };

/** Prioridade da atividade quando o equipamento aparece em mais de uma (menor = preferida). */
const PESO: Record<string, number> = { EM_ANDAMENTO: 0, AGENDADA: 1, CONCLUIDA: 2 };
const aberta = (status: string) => status === "EM_ANDAMENTO" || status === "AGENDADA";

export interface AtividadeDoDia {
  retrato: RetratoAtividade;
  /** Situação que o técnico vê (o que ele já gravou no aparelho conta: iniciar/concluir a enviar) */
  status: string;
  /** Equipamentos da atividade como a tela mostra (inclui o que foi vinculado no aparelho) */
  vinculados: string[];
}

export function destinoDoQr(valorLido: string, dia: AtividadeDoDia[]): DestinoQr {
  const valor = valorLido.trim();
  const ordem = [...dia].filter((a) => a.status !== "CANCELADA").sort((a, b) => (PESO[a.status] ?? 9) - (PESO[b.status] ?? 9));
  // O equipamento do QR (pela lista da unidade de cada OS guardada)
  const achar = (a: AtividadeDoDia) => a.retrato.equipamentosUnidade.find((u) => qrConfere(u.qr, valor)) ?? null;
  for (const a of ordem) {
    const u = achar(a);
    if (u && a.vinculados.includes(u.id)) return { tipo: "naAtividade", atividadeId: a.retrato.execucao.atividade.id, equipamentoId: u.id, titulo: u.titulo };
  }
  for (const a of ordem) {
    if (!aberta(a.status)) continue;
    const u = achar(a);
    if (u) return { tipo: "naUnidade", atividadeId: a.retrato.execucao.atividade.id, equipamentoId: u.id, titulo: u.titulo };
  }
  return { tipo: "ficha", valor };
}

/* ───────── a ficha (resposta do servidor) ───────── */

/** Um atendimento do histórico como o app mostra — SEM valores e sem decisão de cobrança. */
export interface AtendimentoFicha {
  chave: string; data: string; titulo: string; tipoServico: string | null; tecnico: string | null; status: string;
  checklist: { ok: number; atencao: number; naoSeAplica: number; itensAtencao: string[] } | null;
  medicoes: { texto: string; valor: number; unidade: string | null }[];
  observacao: string | null; resumo: string | null; adicionais: string[]; fotos: number;
  osNumero: string;
}

export interface FichaEquipamento {
  equipamento: {
    id: string; titulo: string; fabricante: string; tag: string | null; numeroSerie: string | null;
    local: string | null; unidade: string | null; cliente: string | null; tipo: string | null; ativo: boolean;
    /** Fim da garantia (ISO); null = sem garantia cadastrada */
    garantiaAte?: string | null;
  };
  /** O equipamento está numa atividade DESTE técnico hoje (ex.: vinculado de outra unidade do cliente) */
  atividadeHoje: { atividadeId: string; vinculado: boolean } | null;
  historico: AtendimentoFicha[];
}

/** Quantos atendimentos a ficha do app mostra (o histórico completo fica no escritório). */
export const LIMITE_HISTORICO_APP = 20;

export const MSG_FICHA_SEM_SINAL = "Sem sinal: a ficha deste equipamento abre quando houver internet.";
export const MSG_QR_NAO_RECONHECIDO = "QR Code não reconhecido.";

/**
 * O histórico do escritório (lib/equipamento-historico) do jeito que vai para o app: o que foi feito, as
 * medições e o que o técnico observou. Ficam de fora a decisão de cobrança dos adicionais, o link público
 * do relatório (leva token) e os endereços das fotos (vai só a contagem). Nenhum valor sai daqui. Agendamento
 * futuro não é histórico e não entra.
 */
export function paraFicha(eventos: import("@/lib/equipamento-historico").EventoHistorico[], limite = LIMITE_HISTORICO_APP, agora: Date = new Date()): AtendimentoFicha[] {
  // O histórico é o que JÁ aconteceu: agendamento futuro (ex.: cronograma do PMOC) fica de fora
  const ate = agora.getTime();
  const passados = eventos.filter((e) => !(e.status === "AGENDADA" && new Date(e.data).getTime() > ate));
  return passados.slice(0, limite).map((e) => ({
    chave: e.chave, data: e.data, titulo: e.titulo, tipoServico: e.tipoServico?.nome ?? null, tecnico: e.tecnico, status: e.status,
    checklist: e.checklist ? { ok: e.checklist.ok, atencao: e.checklist.atencao, naoSeAplica: e.checklist.naoSeAplica, itensAtencao: e.checklist.itensAtencao } : null,
    medicoes: e.medicoes.map((m) => ({ texto: m.texto, valor: m.valor, unidade: m.unidade })),
    observacao: e.observacao, resumo: e.resumo,
    adicionais: e.adicionais.map((a) => a.descricao),
    fotos: e.fotos.length,
    osNumero: e.os.numero,
  }));
}
