import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { painelDaTv } from "@/lib/desempenho/servidor";
import { PainelDaTv } from "@/components/desempenho/tv-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ranking do mês", robots: { index: false, follow: false } };

/**
 * MODO TV do Desempenho: rota pública (sem login), só leitura, para deixar aberta numa tela da
 * empresa. A chave é o link gerado na configuração; trocar ou desligar o link derruba esta página.
 */
export default async function TvPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const painel = await painelDaTv(token);
  if (!painel) notFound();
  return <PainelDaTv token={token} inicial={painel} />;
}
