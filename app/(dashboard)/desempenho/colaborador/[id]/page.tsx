import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { podeNoDesempenho } from "@/lib/desempenho/pagina";
import { competenciaAtual, ehCompetencia } from "@/lib/desempenho/regras";
import { FichaDesempenho } from "@/components/desempenho/ficha-client";

export const metadata: Metadata = { title: "Desempenho · Ficha" };
export const dynamic = "force-dynamic";

/** Ficha do colaborador no mês (escore, composição, faixa, bônus projetado). */
export default async function FichaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const pode = podeNoDesempenho(await auth());
  if (!pode.visualizar) redirect("/sem-permissao");
  const [{ id }, { mes }] = await Promise.all([params, searchParams]);
  const atual = competenciaAtual();
  return <FichaDesempenho tecnicoId={id} mesInicial={ehCompetencia(mes) && mes <= atual ? mes : atual} mesAtual={atual} />;
}
