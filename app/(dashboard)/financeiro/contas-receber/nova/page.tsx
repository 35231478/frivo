import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import { CobrancaForm } from "@/components/financeiro/cobranca-form";

export const metadata: Metadata = { title: "Nova cobrança" };

const AJUDA = "Cobrança avulsa: o que não nasce de fatura de OS, orçamento ou contrato. Em parcelas, cada uma vira uma conta a receber com o seu vencimento. O boleto é emitido depois, na lista de Contas a receber.";

/** Criar cobrança é mexer em dinheiro: Financeiro › contas a receber (a mesma permissão da rota). */
export default async function NovaCobrancaPage() {
  const u = (await auth())!.user!;
  if (!pode(u.permissoes, "financeiro", "contasReceber", u.role)) redirect("/sem-permissao");

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Nova cobrança" description="Crie uma cobrança manual de conta a receber" dica={AJUDA} backHref="/financeiro/contas-receber" />
      <CobrancaForm />
    </div>
  );
}
