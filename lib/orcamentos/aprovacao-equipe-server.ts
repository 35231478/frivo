/**
 * "Cliente aprovou" registrado pela equipe — a gravação (servidor). A regra pura está em aprovacao-equipe.ts.
 */
import { prisma } from "@/lib/prisma";
import { diaCivilPassou } from "@/lib/fuso";
import { registrarEvento } from "@/lib/orcamentos/ciclo-server";
import { comissoesNaAprovacao } from "@/lib/comissoes/servidor";
import { detalheAprovacaoEquipe, PODE_APROVAR_PELA_EQUIPE, type AprovacaoEquipe } from "@/lib/orcamentos/aprovacao-equipe";

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
  // COM-1: a comissão do vendedor nasce na aprovação, congelada (regra e valor de hoje)
  await comissoesNaAprovacao(empresaId, o.id);
  return { ok: true };
}
