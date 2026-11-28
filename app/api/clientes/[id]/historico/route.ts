import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode, type Acao } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { carregarHistoricoCliente } from "@/lib/clientes/historico-server";
import { filtroOrcamentos, filtroOrdens } from "@/lib/escopo/proprios";

/**
 * Leva H — o HISTÓRICO AUTOMÁTICO do cliente (a linha do tempo da ficha). Quem vê o cliente vê o histórico; as
 * faturas, os pagamentos e as cobranças só entram para quem vê o financeiro; OS, orçamentos, contratos e documentação
 * da equipe, só para quem vê cada um. Cliente de outra empresa: 404.
 * Com o "Ver só os próprios" (COM-1), OS, orçamentos e pedidos ficam só os da pessoa.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("clientes", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const u = guard.session.user!;
  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId: u.empresaId }, select: { id: true } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });
  const comFinanceiro = pode(u.permissoes, "financeiro", "contasReceber", u.role) || pode(u.permissoes, "financeiro", "medicoes", u.role);
  // Cada módulo só para quem o vê: OS (com aceites e e-mails das OS), orçamentos, contratos e documentação da equipe
  const ve = (modulo: string, acao: Acao = "visualizar") => pode(u.permissoes, modulo, acao, u.role);
  const eventos = await carregarHistoricoCliente(u.empresaId, id, {
    comFinanceiro, comOrdens: ve("ordens"), comOrcamentos: ve("orcamentos"), comContratos: ve("contratos"),
    // a documentação da equipe não tem "visualizar": a tela dela exige "Documentos › Enviar ao cliente"
    comDocumentacao: ve("documentos", "enviar"),
    escopo: { ordens: filtroOrdens(u), orcamentos: filtroOrcamentos(u) },
  });
  return NextResponse.json({ eventos });
}
