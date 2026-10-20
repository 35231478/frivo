import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { apresentarEquipamento, carregarExecucao, SELECT_EQUIP_EXECUCAO } from "@/lib/execucao/dados";
import { cartaoDaAtividade } from "@/lib/tecnico/dia";
import { MSG_FORA_DO_ESCOPO, escopoDaSessao, filtroEscopo } from "@/lib/tecnico/escopo";

type Params = { params: Promise<{ atividadeId: string }> };

/**
 * Tudo o que o app precisa para executar a atividade SEM sinal (guardado no aparelho): o cartão
 * (cliente, endereço, rota), a execução por equipamento (checklist do tipo, respostas, fotos, o que
 * falta), os serviços adicionais e a lista de equipamentos ativos da unidade (para vincular o que faltou).
 */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { atividadeId } = await params;
  const empresaId = guard.session.user.empresaId;
  const escopo = escopoDaSessao(guard.session);
  const cartao = await cartaoDaAtividade(empresaId, atividadeId, filtroEscopo(escopo));
  if (!cartao) {
    const existe = escopo.restrito && await prisma.atividadeOs.findFirst({ where: { id: atividadeId, empresaId }, select: { id: true } });
    return existe
      ? NextResponse.json({ erro: MSG_FORA_DO_ESCOPO }, { status: 403 })
      : NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });
  }
  const execucao = await carregarExecucao(empresaId, cartao.osId, atividadeId);
  if (!execucao) return NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });
  const { clienteId, unidadeId } = execucao.os;
  const daUnidade = await prisma.equipamento.findMany({
    where: { empresaId, ativo: true, ...(unidadeId ? { unidadeId } : { unidade: { clienteId } }) },
    orderBy: [{ localizacao: "asc" }, { nome: "asc" }],
    take: 300,
    select: SELECT_EQUIP_EXECUCAO,
  });
  return NextResponse.json({
    cartao,
    execucao,
    equipamentosUnidade: daUnidade.map(apresentarEquipamento),
    geradoEm: new Date().toISOString(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
