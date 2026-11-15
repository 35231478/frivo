import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import { ContaPagarForm } from "@/components/financeiro/conta-pagar-form";

export const metadata: Metadata = { title: "Nova conta a pagar" };

const AJUDA = "A conta nasce aqui quando a despesa não vem de nota de compra (serviço, aluguel, taxa). Vinda de NF-e, ela é criada sozinha ao lançar a nota em Estoque › Notas de compra. O boleto colado aqui aparece na ficha na hora de pagar.";

/** Criar conta a pagar é mexer em dinheiro: Financeiro › fluxo de caixa (a mesma permissão da rota). */
export default async function NovaContaPagarPage() {
  const u = (await auth())!.user!;
  if (!pode(u.permissoes, "financeiro", "fluxoCaixa", u.role)) redirect("/sem-permissao");

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Nova conta a pagar" description="Registre uma despesa a pagar" dica={AJUDA} backHref="/financeiro/contas-pagar" />
      <ContaPagarForm />
    </div>
  );
}
