import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { empresaUsaComissao, extratoDoUsuario } from "@/lib/comissoes/servidor";

/**
 * COM-1 — "Minhas comissões": o extrato da PRÓPRIA pessoa (prevista, liberada, paga) por orçamento/OS. Qualquer
 * usuário logado vê só o dele; nunca vai custo, margem nem a base em reais. Empresa sem comissão: nada.
 */
export async function GET(req?: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { empresaId, id } = session.user;
  if (!(await empresaUsaComissao(empresaId))) return NextResponse.json({ ativo: false, vendas: [], totais: { prevista: 0, liberada: 0, paga: 0 } });
  // `?so=ativo`: só saber se a aba aparece (sem recalcular nada)
  if (req?.nextUrl?.searchParams.get("so") === "ativo") return NextResponse.json({ ativo: true });
  return NextResponse.json({ ativo: true, ...(await extratoDoUsuario(empresaId, id)) });
}
