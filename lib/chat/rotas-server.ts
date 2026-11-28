/**
 * CHAT-1 — os guardas das rotas do chat (um lugar só para o escritório e para o app).
 *  - escritório: a permissão de OS (ver para ler, editar para escrever); quem está no modo técnico usa o app;
 *  - app: a permissão de ver OS e o técnico ligado ao usuário (as OS dele se conferem em cada consulta).
 */
import { NextResponse } from "next/server";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import type { Acao } from "@/lib/permissoes";
import { escopoDaSessao } from "@/lib/tecnico/escopo";
import { MSG_SEM_TECNICO, tecnicoDaSessao } from "@/lib/tecnico/sessao";
import type { QuemEscritorio } from "@/lib/chat/servidor";
import { marcaValida } from "@/lib/chat/regras";

export const MSG_USE_O_APP = "O técnico conversa pelo app (menu Chat).";
export const SEM_CACHE = { "Cache-Control": "private, no-store" } as const;

/** Pede "OS › <acao>" — ou, com `qualquer`, uma das permissões da lista (ex.: a conversa por pessoa pede "Conversas") */
export async function guardaEscritorio(acao: "visualizar" | "editar", qualquer?: [string, Acao][]): Promise<{ quem: QuemEscritorio; resposta?: undefined } | { resposta: NextResponse; quem?: undefined }> {
  const guard = qualquer ? await exigirAlgumaPermissao(qualquer) : await exigirPermissao("ordens", acao);
  if (guard.erro) return { resposta: guard.resposta };
  if (escopoDaSessao(guard.session).restrito) return { resposta: NextResponse.json({ erro: MSG_USE_O_APP }, { status: 403 }) };
  const u = guard.session.user;
  return { quem: { id: u.id, empresaId: u.empresaId, role: u.role, permissoes: u.permissoes } };
}

export async function guardaTecnico(): Promise<{ empresaId: string; usuarioId: string; tecnicoId: string; resposta?: undefined } | { resposta: NextResponse }> {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return { resposta: guard.resposta };
  const tecnico = await tecnicoDaSessao(guard.session);
  if (!tecnico) return { resposta: NextResponse.json({ erro: MSG_SEM_TECNICO }, { status: 403 }) };
  return { empresaId: guard.session.user.empresaId, usuarioId: guard.session.user.id, tecnicoId: tecnico.id };
}

/** O `desde` do long-polling (a marca que o aparelho já tem) */
export const lerDesde = (url: string) => {
  const d = new URL(url).searchParams.get("desde");
  return marcaValida(d) ? d : null;
};
