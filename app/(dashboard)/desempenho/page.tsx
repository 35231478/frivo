import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { podeNoDesempenho } from "@/lib/desempenho/pagina";
import { competenciaAtual } from "@/lib/desempenho/regras";
import { PainelDesempenho } from "@/components/desempenho/painel-client";

export const metadata: Metadata = { title: "Desempenho" };
export const dynamic = "force-dynamic";

/** Equipes › Desempenho: o ranking do mês por perfil, o prêmio em disputa e o resumo por equipe. */
export default async function DesempenhoPage() {
  const pode = podeNoDesempenho(await auth());
  if (!pode.visualizar) redirect("/sem-permissao");
  return <PainelDesempenho mesAtual={competenciaAtual()} pode={pode} />;
}
