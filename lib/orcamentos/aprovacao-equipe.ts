/**
 * "Cliente aprovou" registrado pela EQUIPE — o espelho do "Cliente recusou": o cliente aprovou por
 * fora do link (telefone, WhatsApp, e-mail, pessoalmente) e alguém do escritório registra, com QUEM
 * aprovou, por qual CANAL e uma observação. Diferente do aceite digital do link, não há assinatura,
 * CPF nem IP: o documento mostra "Aprovação registrada pela equipe".
 *
 * Mesmas travas do link (ENVIADO, ou RASCUNHO ainda não enviado, e dentro da validade), troca de
 * status atômica (dois cliques não aprovam duas vezes) e a mesma consequência: o aprovado fica
 * "a faturar" e pode gerar a OS. Permissão: Orçamentos › Aprovar.
 *
 * Este arquivo é só a regra pura (a tela usa); a gravação está em aprovacao-equipe-server.ts.
 */
import { z } from "zod";

export const CANAIS_APROVACAO = ["TELEFONE", "WHATSAPP", "EMAIL", "PRESENCIAL", "OUTRO"] as const;
export type CanalAprovacao = (typeof CANAIS_APROVACAO)[number];
export const ROTULO_CANAL: Record<CanalAprovacao, string> = {
  TELEFONE: "telefone", WHATSAPP: "WhatsApp", EMAIL: "e-mail", PRESENCIAL: "pessoalmente", OUTRO: "outro meio",
};

export const aprovacaoEquipeSchema = z.object({
  nome: z.string().trim().min(2, "Informe quem aprovou.").max(120),
  canal: z.enum(CANAIS_APROVACAO, { errorMap: () => ({ message: "Escolha por onde o cliente aprovou." }) }),
  observacao: z.string().trim().max(500, "Observação com no máximo 500 caracteres.").optional().nullable(),
}).strict();
export type AprovacaoEquipe = z.infer<typeof aprovacaoEquipeSchema>;

/** De onde a equipe pode registrar a aprovação: aguardando o cliente (enviado) ou ainda em rascunho */
export const PODE_APROVAR_PELA_EQUIPE = ["ENVIADO", "RASCUNHO"] as const;

/** O texto da linha do tempo: "Joana (por telefone) · registrado por Marina — obs" */
export function detalheAprovacaoEquipe(d: AprovacaoEquipe, registradoPor: string): string {
  const obs = d.observacao?.trim();
  return `${d.nome.trim()} (por ${ROTULO_CANAL[d.canal]}) · registrado por ${registradoPor}${obs ? ` — ${obs}` : ""}`;
}

