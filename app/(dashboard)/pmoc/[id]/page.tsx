import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SELECT_PMOC } from "@/lib/pmoc-server";
import { PmocEditor, type PmocDados } from "@/components/pmoc/pmoc-editor";
import { serializarPmoc } from "@/lib/pmoc";

export const metadata: Metadata = { title: "PMOC" };

export default async function PmocPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string; copia?: string; criado?: string }>;
}) {
  const { id } = await params;
  const { aba, copia, criado } = await searchParams;
  const session = await auth();
  // O middleware já exige pmoc.visualizar para /pmoc/*; editar/criar são checados na tela e no servidor
  const pmoc = await prisma.pmoc.findFirst({ where: { id, empresaId: session!.user!.empresaId }, select: SELECT_PMOC });
  if (!pmoc) notFound();
  const dados = serializarPmoc<PmocDados>(JSON.parse(JSON.stringify(pmoc)));
  return <div className="max-w-5xl mx-auto"><PmocEditor key={`${pmoc.id}-${pmoc.ativo}`} inicial={dados} abaInicial={aba} copiaRecente={copia === "1"} criadoRecente={criado === "1"} /></div>;
}
