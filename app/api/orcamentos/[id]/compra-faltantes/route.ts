import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exigirModuloNaApi, exigirPermissao } from "@/lib/permissoes-server";
import {
  compraFaltantesLigada, podeSolicitarCompraDoOrcamento, situacaoDosFaltantes, solicitarCompraDosFaltantes,
} from "@/lib/orcamentos/compra-faltantes-server";
import { orcamentoAceitaSolicitacao } from "@/lib/orcamentos/compra-faltantes";
import { escopoBarra } from "@/lib/escopo/proprios-server";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/orcamentos/[id]/compra-faltantes — o que falta no estoque para este orçamento e o que já está pedido.
 * A tela do orçamento é do núcleo: com Compras ou Estoque desligado responde 200 com `disponivel: false` (a seção some,
 * nunca 403). Sem custo nenhum: só quantidades e os pedidos (número e status).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("orcamentos", "visualizar");
  if (guard.erro) return guard.resposta;
  const u = guard.session.user!;
  const { id } = await params;
  const foraDoEscopo = await escopoBarra("orcamento", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  if (!(await compraFaltantesLigada(u.empresaId))) return NextResponse.json({ disponivel: false });
  const s = await situacaoDosFaltantes(u.empresaId, id);
  if (!s) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  return NextResponse.json({
    disponivel: true,
    podeSolicitar: podeSolicitarCompraDoOrcamento(u) && orcamentoAceitaSolicitacao(s.orcamento.status),
    faltantes: s.faltantes,
  });
}

/**
 * POST /api/orcamentos/[id]/compra-faltantes — "Solicitar compra dos faltantes": cria UM pedido de compra (status
 * inicial do fluxo, SOLICITADO) com cada produto faltante na quantidade que falta, ligado ao orçamento (e à OS gerada
 * dele). Idempotente: o que já está em pedido aberto deste orçamento não é pedido de novo; um pedido ainda "Solicitado"
 * recebe o que faltar. Permissão: a mesma do pedido com origem no orçamento (Compras › gerenciar ou Orçamentos › editar).
 * Ação de Compras: com Compras ou Estoque desligado, o portão de módulo responde como no POST do pedido de compra.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await auth();
  const u = session?.user;
  if (!u) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!podeSolicitarCompraDoOrcamento(u)) return NextResponse.json({ erro: "Sem permissão para solicitar compra" }, { status: 403 });
  for (const modulo of ["compras", "estoque"]) {
    const semModulo = await exigirModuloNaApi(u.empresaId, modulo);
    if (semModulo) return semModulo;
  }
  const { id } = await params;
  const foraDoEscopo = await escopoBarra("orcamento", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  const r = await solicitarCompraDosFaltantes(u.empresaId, u.id, id);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r, { status: r.acao === "criado" ? 201 : 200 });
}
