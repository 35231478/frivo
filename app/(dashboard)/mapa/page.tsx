import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { posicoesDoMapa } from "@/lib/tecnico/posicao-server";
import { MapaClient } from "@/components/mapa/mapa-client";

export const metadata: Metadata = { title: "Mapa" };
export const dynamic = "force-dynamic";

/**
 * Operações › Mapa: a última posição conhecida de cada técnico de campo. Só a gestão (Equipes ›
 * Gerenciar) — o técnico nunca vê esta tela (o modo técnico o confina ao /tecnico). Multiempresa:
 * tudo por empresaId. Só há posições com "Rastrear localização dos técnicos" ligado na empresa.
 */
export default async function MapaPage() {
  const session = await auth();
  const u = session!.user!;
  if (!pode(u.permissoes, "equipes", "gerenciar", u.role)) redirect("/sem-permissao");
  const inicial = await posicoesDoMapa(u.empresaId);
  return <MapaClient inicial={inicial} podeConfigurar={pode(u.permissoes, "configuracoes", "gerenciar", u.role)} />;
}
