import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { pode } from "@/lib/permissoes";
import { DespesasCampoView } from "@/components/financeiro/despesas-campo-view";

export const metadata: Metadata = { title: "Despesas de campo" };

/** Financeiro › Despesas de campo. Ver: Financeiro › Visualizar; aprovar e recusar: quem lança contas a pagar (Fluxo de caixa). */
export default async function DespesasCampoPage() {
  const session = await auth();
  const u = session!.user!;
  if (!pode(u.permissoes, "financeiro", "visualizar", u.role)) redirect("/sem-permissao");
  return <DespesasCampoView podeDecidir={pode(u.permissoes, "financeiro", "fluxoCaixa", u.role)} />;
}
