import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { listarDespesas } from "@/lib/execucao/despesas";
import type { StatusDespesa } from "@/lib/tecnico/despesas";

const STATUS = ["PENDENTE", "APROVADA", "RECUSADA", "TODAS"] as const;

/** Financeiro › Despesas de campo: a lista (padrão: as pendentes). Sem foto (a foto vem por rota própria). */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const s = req.nextUrl.searchParams.get("status") ?? "PENDENTE";
  const status = (STATUS as readonly string[]).includes(s) ? (s as StatusDespesa | "TODAS") : "PENDENTE";
  return NextResponse.json({ despesas: await listarDespesas(guard.session.user.empresaId, { status }) }, { headers: { "Cache-Control": "private, no-store" } });
}
