/**
 * "Cliente aprovou" registrado pela EQUIPE — o espelho do "Cliente recusou": o cliente aprovou por
 * fora do link (telefone, WhatsApp, e-mail, pessoalmente) e alguém do escritório registra, com QUEM
 * aprovou, por qual CANAL e uma observação. Diferente do aceite digital do link, não há assinatura,
 * CPF nem IP: o documento mostra "Aprovação registrada pela equipe".
 *
 * Mesmas travas do link (ENVIADO, ou RASCUNHO ainda não enviado, e dentro da validade), troca de
 * status atômica (dois cliques não aprovam duas vezes) e a mesma consequência: o aprovado fica
 * "a faturar" e pode gerar a OS. Permissão: Orçamentos › Aprovar.
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { diaCivilPassou } from "@/lib/fuso";
import { registrarEvento } from "@/lib/orcamentos/ciclo-server";

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

export type ResultadoAprovacaoEquipe = { ok: true } | { ok: false; status: number; erro: string };

export async function registrarAprovacaoDaEquipe(
  empresaId: string, orcamentoId: string, d: AprovacaoEquipe, quem: { id: string; nome: string }, agora: Date = new Date(),
): Promise<ResultadoAprovacaoEquipe> {
  const o = await prisma.orcamento.findFirst({ where: { id: orcamentoId, empresaId }, select: { id: true, status: true, validadeEm: true } });
  if (!o) return { ok: false, status: 404, erro: "Orçamento não encontrado" };
  if (!(PODE_APROVAR_PELA_EQUIPE as readonly string[]).includes(o.status)) {
    return { ok: false, status: 400, erro: o.status === "APROVADO" ? "Este orçamento já está aprovado." : "Este orçamento não pode mais ser aprovado." };
  }
  if (diaCivilPassou(o.validadeEm, agora)) {
    return { ok: false, status: 410, erro: "A validade deste orçamento já venceu. Volte para rascunho, ajuste a validade e registre de novo." };
  }
  const r = await prisma.orcamento.updateMany({
    where: { id: o.id, empresaId, status: o.status },
    data: {
      status: "APROVADO", assinadoEm: agora, assinadoPor: d.nome.trim(),
      // Sem aceite digital: nada de CPF, assinatura, IP ou navegador de quem aprovou
      assinadoCpf: null, assinaturaUrl: null, aprovadoIp: null, aprovadoUserAgent: null,
      // Foi a própria equipe que registrou: a resposta já está "vista" (não acende o sino)
      respostaVistaEm: agora,
    },
  });
  if (r.count !== 1) return { ok: false, status: 409, erro: "O orçamento mudou enquanto você registrava. Recarregue a página." };
  await registrarEvento({ empresaId, orcamentoId: o.id, tipo: "APROVADO", usuarioId: quem.id, detalhe: detalheAprovacaoEquipe(d, quem.nome) });
  return { ok: true };
}
