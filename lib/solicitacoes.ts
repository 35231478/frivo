/**
 * Solicitações de OS feitas pelos clientes.
 *
 * Não há tabela própria: o Portal do Cliente (POST /api/portal/chamados) e a página
 * pública do QR Code (POST /api/qr/[token]/chamado) gravam a solicitação direto em
 * `ordens_servico`, com origem PORTAL_CLIENTE e status AGUARDANDO_ATENDIMENTO.
 * Enquanto está nesse estado ela é uma solicitação pendente (não um agendamento):
 * fica fora do calendário e só aparece na gaveta/tela de Solicitações.
 * - Aceitar: a MESMA OS vira AGENDADA na data/hora escolhida (mantém o nº do chamado).
 * - Recusar: a OS vira CANCELADA, com o motivo no histórico.
 */
export const SOLICITACAO_PENDENTE = { origem: "PORTAL_CLIENTE", status: "AGUARDANDO_ATENDIMENTO" } as const;

/** Link da tela completa (lista de OS filtrada nas solicitações pendentes). */
export const URL_SOLICITACOES = "/ordens?origem=PORTAL_CLIENTE&status=AGUARDANDO_ATENDIMENTO";

/**
 * O chamado via QR Code guarda o contato do solicitante no fim da descrição
 * ("[Chamado via QR Code] Solicitante: … · E-mail: … · Telefone: …").
 * Separa o texto que o cliente escreveu desse rodapé.
 */
export function separarDescricao(descricao: string): { texto: string; contatoQr: string | null; viaQr: boolean } {
  const m = /\n\n\[(?:Chamado|Orçamento) via QR Code\] ?([\s\S]*)$/.exec(descricao);
  if (!m) return { texto: descricao, contatoQr: null, viaQr: false };
  return { texto: descricao.slice(0, m.index), contatoQr: m[1].trim() || null, viaQr: true };
}
