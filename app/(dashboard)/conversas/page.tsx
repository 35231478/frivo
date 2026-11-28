import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { escopoDaSessao } from "@/lib/tecnico/escopo";
import { urlConversaApp } from "@/lib/chat/regras";
import { ConversasEscritorio } from "@/components/chat/conversas-escritorio";

export const metadata: Metadata = { title: "Conversas" };

/**
 * CHAT-1 — Conversas: o chat interno com o campo, estilo WhatsApp Web, com a chave "Pessoas | OS" (padrão Pessoas, para
 * quem tem a permissão "Conversas"). A lista à esquerda e a conversa aberta à direita. O técnico usa o app.
 */
export default async function ConversasPage({ searchParams }: { searchParams: Promise<{ os?: string; pessoa?: string }> }) {
  const session = await auth();
  const u = session!.user!;
  const { os, pessoa } = await searchParams;
  if (escopoDaSessao(session!).restrito) redirect(urlConversaApp());
  const podeConversas = pode(u.permissoes, "conversas", "visualizar", u.role);
  // Quem vê OS usa a visão por OS; a por pessoa pede "Conversas" (o administrador sempre)
  if (!pode(u.permissoes, "ordens", "visualizar", u.role) && !podeConversas) redirect("/sem-permissao");
  return (
    <ConversasEscritorio osInicial={os ?? null} pessoaInicial={pessoa ?? null} podeConversas={podeConversas}
      podeEscrever={pode(u.permissoes, "ordens", "editar", u.role)} podeEnviarConversas={pode(u.permissoes, "conversas", "enviar", u.role)} />
  );
}
