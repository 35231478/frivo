import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { lerPeriodo } from "@/lib/periodo";
import { painelFaturamentoContratos } from "@/lib/faturamento/painel-contratos-server";
import { FaturamentoContratosView } from "@/components/financeiro/faturamento-contratos-view";

export const metadata: Metadata = { title: "Faturamento de contratos" };

/**
 * "Faturamento de contratos": a rotina automática por competência (mês). Quem vê e quem tenta de
 * novo: Financeiro › Medições (o mesmo do "Gerar medições do mês"). Empresa sempre da sessão.
 */
export default async function FaturamentoContratosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await auth();
  if (!pode(session!.user!.permissoes, "financeiro", "medicoes", session!.user!.role)) redirect("/sem-permissao");
  // Por competência: só mês a mês (sem intervalo)
  const periodo = lerPeriodo({ mes: sp.mes });
  const [ano, mes] = periodo.mes!.split("-").map(Number);
  const dados = await painelFaturamentoContratos(session!.user!.empresaId, ano, mes);
  return (
    <FaturamentoContratosView
      periodo={{ tipo: periodo.tipo, mes: periodo.mes, de: null, ate: null, rotulo: periodo.rotulo }}
      linhas={dados.linhas} resumo={dados.resumo} soAtencao={sp.atencao === "1"}
    />
  );
}
