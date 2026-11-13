import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { podeNoDesempenho } from "@/lib/desempenho/pagina";
import { competenciaAtual } from "@/lib/desempenho/regras";
import { PremiacoesDesempenho } from "@/components/desempenho/premiacoes-client";

export const metadata: Metadata = { title: "Desempenho · Premiação" };
export const dynamic = "force-dynamic";

/** Premiação do mês: todos que veem o Desempenho veem; cadastrar é de quem tem "Gerenciar". */
export default async function PremiacoesPage() {
  const session = await auth();
  const pode = podeNoDesempenho(session);
  if (!pode.visualizar) redirect("/sem-permissao");
  const perfis = await prisma.desempenhoPerfil.findMany({ where: { empresaId: session!.user.empresaId }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } });
  return <PremiacoesDesempenho mesAtual={competenciaAtual()} pode={pode} perfis={perfis} />;
}
