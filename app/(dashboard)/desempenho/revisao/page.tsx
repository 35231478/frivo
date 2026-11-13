import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { podeNoDesempenho } from "@/lib/desempenho/pagina";
import { RevisaoDesempenho } from "@/components/desempenho/revisao-client";

export const metadata: Metadata = { title: "Desempenho · A revisar" };
export const dynamic = "force-dynamic";

/** Lista "A revisar": só para quem tem "Desempenho › Revisar penalidades". */
export default async function RevisaoPage() {
  const pode = podeNoDesempenho(await auth());
  if (!pode.visualizar || !pode.revisar) redirect("/sem-permissao");
  return <RevisaoDesempenho pode={pode} />;
}
