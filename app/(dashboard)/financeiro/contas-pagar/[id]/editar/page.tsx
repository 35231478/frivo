import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { ContaPagarForm } from "@/components/financeiro/conta-pagar-form";

export const metadata: Metadata = { title: "Editar conta a pagar" };

const AJUDA = "Dá para corrigir dados, classificação e boleto enquanto a conta não está paga ou cancelada. O que já foi pago não muda por aqui: pagamento é registrado na ficha da conta. Numa conta de despesa recorrente, você escolhe o alcance do ajuste: só este mês, ou este e os próximos que ainda estão em aberto.";

export default async function EditarContaPagarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = (await auth())!.user!;
  // Editar conta é mexer em dinheiro: Financeiro › fluxo de caixa (a mesma permissão da rota)
  if (!pode(u.permissoes, "financeiro", "fluxoCaixa", u.role)) redirect("/sem-permissao");
  const empresaId = u.empresaId;

  const conta = await prisma.contaPagar.findFirst({ where: { id, empresaId } });
  if (!conta) notFound();

  const initialData = {
    ...conta,
    valorTotal: Number(conta.valorTotal),
    // o formulário usa o que já foi pago para decidir o ALCANCE do ajuste numa conta recorrente
    valorPago: Number(conta.valorPago),
    saldoRestante: Number(conta.saldoRestante),
    dataVencimento: conta.dataVencimento ? conta.dataVencimento.toISOString() : null,
  };

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title={`Editar ${conta.numero}`} description={conta.fornecedor} dica={AJUDA} backHref="/financeiro/contas-pagar" />
      <ContaPagarForm initialData={initialData} />
    </div>
  );
}
