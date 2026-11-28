import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { despesasExcluidas, listarDespesas, soEscritorio } from "@/lib/execucao/despesas";
import type { StatusDespesa } from "@/lib/tecnico/despesas";

const STATUS = ["PENDENTE", "APROVADA", "RECUSADA", "TODAS"] as const;
const SEM_CACHE = { headers: { "Cache-Control": "private, no-store" } };

/** Financeiro › Despesas de campo: a lista (padrão: as pendentes). Sem foto (a foto vem por rota própria). */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const fora = soEscritorio(guard.session);
  if (fora) return fora;
  const s = req.nextUrl.searchParams.get("status") ?? "PENDENTE";
  // D7: as que o colaborador excluiu pelo app antes da decisão (a trilha: o que ela era)
  if (s === "EXCLUIDAS") return NextResponse.json({ despesas: [], excluidas: await despesasExcluidas(guard.session.user.empresaId) }, SEM_CACHE);
  const status = (STATUS as readonly string[]).includes(s) ? (s as StatusDespesa | "TODAS") : "PENDENTE";
  return NextResponse.json({ despesas: await listarDespesas(guard.session.user.empresaId, { status }) }, SEM_CACHE);
}
