import type { Metadata } from "next";
import { ProtegerSaida } from "@/components/ui/proteger-saida";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { ClienteForm } from "@/components/forms/cliente-form";
import { carregarFichaCliente } from "@/lib/clientes/ficha-server";
import { valoresDoCabecalho, veFinanceiroDoCliente } from "@/lib/clientes/cabecalho";
import { pode } from "@/lib/permissoes";

export const metadata: Metadata = { title: "Editar cliente" };

export default async function EditarClientePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const { id } = await params;
  const { aba } = await searchParams;
  const session = await auth();
  const ficha = await carregarFichaCliente(id, session!.user!.empresaId);
  if (!ficha) notFound();
  // Os valores do financeiro só saem do servidor para quem vê o financeiro (contas a receber ou faturas)
  const u = session!.user!;
  const valores = valoresDoCabecalho(ficha, veFinanceiroDoCliente((m, a) => pode(u.permissoes, m, a, u.role)));
  return <ProtegerSaida><ClienteForm abaInicial={aba} initialData={ficha.dados} {...valores} perdas12m={ficha.perdas12m} satisfacaoAceite={ficha.satisfacao} /></ProtegerSaida>;
}
