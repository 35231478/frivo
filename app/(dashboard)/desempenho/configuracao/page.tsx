import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { podeNoDesempenho } from "@/lib/desempenho/pagina";
import { ConfiguracaoDesempenho } from "@/components/desempenho/configuracao-client";

export const metadata: Metadata = { title: "Desempenho · Configuração" };
export const dynamic = "force-dynamic";

/** Configuração do Desempenho: só para quem tem "Desempenho › Gerenciar". */
export default async function ConfiguracaoPage() {
  const pode = podeNoDesempenho(await auth());
  if (!pode.visualizar || !pode.gerenciar) redirect("/sem-permissao");
  return <ConfiguracaoDesempenho pode={pode} />;
}
