import type { Metadata } from "next";
import { ProtegerSaida } from "@/components/ui/proteger-saida";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { ClienteForm } from "@/components/forms/cliente-form";
import { carregarFichaCliente } from "@/lib/clientes/ficha-server";

export const metadata: Metadata = { title: "Editar cliente" };

export default async function EditarClientePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const { id } = await params;
  const { aba } = await searchParams;
  const session = await auth();
  const ficha = await carregarFichaCliente(id, session!.user!.empresaId);
  if (!ficha) notFound();
  return <ProtegerSaida><ClienteForm abaInicial={aba} initialData={ficha.dados} totalProximos30Dias={ficha.totalProximos30Dias} valorEmAtraso={ficha.valorEmAtraso} perdas12m={ficha.perdas12m} satisfacaoAceite={ficha.satisfacao} /></ProtegerSaida>;
}
