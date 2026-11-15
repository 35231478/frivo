import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { inicioDaJanela, sugestoesDoCliente, JANELA_MESES } from "@/lib/os/sugestoes";

/**
 * Sugestões da abertura da OS para um cliente (Princípio 9): o tipo de OS mais usado nele e o último
 * técnico/equipe que o atendeu. Quem abre OS (Ordens › criar) é quem pede.
 *
 * As regras ficam em lib/os/sugestoes.ts (a tela e o servidor usam as mesmas): janela de
 * JANELA_MESES meses, mínimo de ocorrências, e empate não sugere. OS cancelada não conta.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("ordens", "criar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const clienteId = new URL(req.url).searchParams.get("clienteId");
  if (!clienteId) return NextResponse.json({ erro: "Informe o cliente." }, { status: 400 });

  // Quem atendeu e o tipo ficam na ATIVIDADE. Só deste cliente, desta empresa, no período e sem as
  // canceladas; da atividade mais nova para a mais antiga (o "último" sai daqui)
  const historico = await prisma.atividadeOs.findMany({
    where: { empresaId, ordemServico: { clienteId, status: { not: "CANCELADA" } }, criadoEm: { gte: inicioDaJanela() } },
    select: { ordemServicoId: true, tipoOsId: true, tecnicoId: true, equipeId: true },
    orderBy: { criadoEm: "desc" },
    take: 300,
  });

  const s = sugestoesDoCliente(historico);
  // Só devolve o que existe de verdade: a tela não precisa saber de nada que não vai sugerir
  const [tipoOs, tecnico, equipe] = await Promise.all([
    s.tipoOs ? prisma.tipoOs.findFirst({ where: { id: s.tipoOs.valor, empresaId }, select: { id: true, nome: true } }) : null,
    s.executor?.valor.tipo === "tecnico" ? prisma.tecnico.findFirst({ where: { id: s.executor.valor.id, empresaId, ativo: true }, select: { id: true, nome: true } }) : null,
    s.executor?.valor.tipo === "equipe" ? prisma.equipe.findFirst({ where: { id: s.executor.valor.id, empresaId, status: "ATIVA" }, select: { id: true, nome: true } }) : null,
  ]);

  return NextResponse.json({
    janelaMeses: JANELA_MESES,
    // O sugerido some se o cadastro foi inativado no meio do caminho (não sugere o que não dá para escolher)
    tipoOs: tipoOs && s.tipoOs ? { id: tipoOs.id, nome: tipoOs.nome, vezes: s.tipoOs.vezes } : null,
    executor: (tecnico || equipe) && s.executor
      ? { tipo: s.executor.valor.tipo, id: (tecnico ?? equipe)!.id, nome: (tecnico ?? equipe)!.nome, vezes: s.executor.vezes }
      : null,
  });
}
