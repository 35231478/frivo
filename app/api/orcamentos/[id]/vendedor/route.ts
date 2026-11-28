import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { trocarVendedorSchema } from "@/lib/comissoes/regras";
import { trocarVendedor } from "@/lib/comissoes/servidor";

/**
 * COM-1 — TROCAR o vendedor do orçamento: só com Orçamentos › "Trocar vendedor" (o administrador tem sempre),
 * com motivo (vai para a trilha). O vendedor segue para a OS gerada e para as faturas.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("orcamentos", "trocarVendedor");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const parsed = trocarVendedorSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const u = guard.session.user!;
  const r = await trocarVendedor({ empresaId: u.empresaId, orcamentoId: id, vendedorId: parsed.data.vendedorId, motivo: parsed.data.motivo, quem: { id: u.id!, nome: u.name ?? "" } });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ vendedor: r.vendedor });
}
