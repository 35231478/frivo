import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { escopoDaSessao } from "@/lib/tecnico/escopo";
import { urlConversaApp } from "@/lib/chat/regras";
import { ConversasEscritorio } from "@/components/chat/conversas-escritorio";

export const metadata: Metadata = { title: "Conversas" };

/**
 * CHAT-1 — Conversas: o chat interno com o campo, estilo WhatsApp Web. Uma conversa por OS (as mensagens da OS), com
 * a lista à esquerda e a conversa aberta à direita. Quem vê OS lê; quem edita OS escreve. O técnico usa o app.
 */
export default async function ConversasPage({ searchParams }: { searchParams: Promise<{ os?: string }> }) {
  const session = await auth();
  const u = session!.user!;
  const { os } = await searchParams;
  if (escopoDaSessao(session!).restrito) redirect(urlConversaApp(os ?? null));
  if (!pode(u.permissoes, "ordens", "visualizar", u.role)) redirect("/sem-permissao");
  return <ConversasEscritorio osInicial={os ?? null} podeEscrever={pode(u.permissoes, "ordens", "editar", u.role)} />;
}
