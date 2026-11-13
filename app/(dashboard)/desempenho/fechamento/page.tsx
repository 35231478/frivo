import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { podeNoDesempenho } from "@/lib/desempenho/pagina";
import { competenciaAnterior, competenciaAtual } from "@/lib/desempenho/regras";
import { FechamentoDesempenho } from "@/components/desempenho/fechamento-client";

export const metadata: Metadata = { title: "Desempenho · Fechamento" };
export const dynamic = "force-dynamic";

/**
 * Fechamento do mês e folha de bônus (valores em reais): só para quem tem "Desempenho › Gerenciar".
 * Abre no mês anterior — o que normalmente está para fechar.
 */
export default async function FechamentoPage() {
  const pode = podeNoDesempenho(await auth());
  if (!pode.visualizar || !pode.gerenciar) redirect("/sem-permissao");
  const atual = competenciaAtual();
  return <FechamentoDesempenho mesInicial={competenciaAnterior(atual)} mesAtual={atual} pode={pode} />;
}
