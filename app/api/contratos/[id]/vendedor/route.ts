import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { trocarVendedorSchema } from "@/lib/comissoes/regras";
import { trocarVendedorDoContrato } from "@/lib/comissoes/contrato-server";

/**
 * COM-1.2 — TROCAR o vendedor do contrato: a mesma permissão do orçamento (Orçamentos › "Trocar vendedor"; o
 * administrador tem sempre), com motivo (vai para o histórico do contrato). A comissão segue a troca.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("orcamentos", "trocarVendedor");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const parsed = trocarVendedorSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const u = guard.session.user!;
  const r = await trocarVendedorDoContrato({ empresaId: u.empresaId, contratoId: id, vendedorId: parsed.data.vendedorId, motivo: parsed.data.motivo, quem: { id: u.id!, nome: u.name ?? "" } });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ vendedor: r.vendedor });
}
