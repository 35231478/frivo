import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { lerPeriodo } from "@/lib/periodo";
import { relatorioPerdas } from "@/lib/financeiro/perda-estorno-server";
import { PerdasView } from "@/components/financeiro/perdas-view";

export const metadata: Metadata = { title: "Perdas" };

/**
 * Relatório "Perdas por período e cliente": cobranças dadas como perdidas (inadimplência), pela data
 * da marcação. Quem vê: Contas a Receber. Marcar/reverter exige Financeiro › Perdas (no Contas a Receber).
 */
export default async function PerdasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await auth();
  if (!pode(session!.user!.permissoes, "financeiro", "contasReceber", session!.user!.role)) redirect("/sem-permissao");
  const periodo = lerPeriodo(sp, new Date(), { permitirTodos: true });
  const dados = await relatorioPerdas(session!.user!.empresaId, { gte: periodo.gte, lt: periodo.lt });
  return (
    <PerdasView
      periodo={{ tipo: periodo.tipo, mes: periodo.mes, de: periodo.de, ate: periodo.ate, rotulo: periodo.rotulo }}
      total={dados.total} clientes={dados.clientes}
      linhas={dados.linhas.map((l) => ({ ...l, perdaEm: l.perdaEm?.toISOString() ?? null, vencimento: l.vencimento?.toISOString() ?? null }))}
    />
  );
}
