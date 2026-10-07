import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { StatusContrato } from "@prisma/client";
import { mudarStatusContrato, statusHttp } from "@/lib/acoes-massa/regras";

type Params = { params: Promise<{ id: string }> };

const STATUS_VALIDOS = Object.values(StatusContrato) as string[];

/**
 * Altera o status do contrato e registra a mudança no histórico.
 * Body: { status: StatusContrato, motivo?: string }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("contratos", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const body = await req.json().catch(() => ({}));
  const novoStatus = body?.status as string | undefined;
  const motivo = typeof body?.motivo === "string" && body.motivo.trim() ? body.motivo.trim() : null;

  if (!novoStatus || !STATUS_VALIDOS.includes(novoStatus)) {
    return NextResponse.json({ erro: "Status inválido." }, { status: 400 });
  }

  // Mesma regra da ação em massa (lib/acoes-massa/regras.ts): troca o status e grava o histórico
  const r = await mudarStatusContrato(id, novoStatus as StatusContrato, { empresaId, usuarioId, usuarioNome: session.user!.name ?? "usuário", motivo: motivo ?? undefined });
  if (!r.ok) return NextResponse.json({ erro: r.codigo === "nao_encontrado" ? "Contrato não encontrado" : r.motivo }, { status: statusHttp(r) });
  const historico = r.dados!.historico as any;

  return NextResponse.json({
    ok: true,
    status: novoStatus,
    historico: {
      id: historico.id,
      statusAnterior: historico.statusAnterior,
      statusNovo: historico.statusNovo,
      motivo: historico.motivo,
      createdAt: historico.createdAt,
      usuario: historico.usuario,
    },
  });
}
