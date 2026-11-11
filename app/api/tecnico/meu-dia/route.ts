import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { meuDia } from "@/lib/tecnico/dia";
import { MSG_SEM_TECNICO, tecnicoDaSessao } from "@/lib/tecnico/sessao";
import { aplicarPrivacidade } from "@/lib/tecnico/cartao";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";

/** "Meu dia": as atividades de hoje atribuídas ao técnico do usuário (+ as começadas e não concluídas). */
export async function GET() {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const tecnico = await tecnicoDaSessao(guard.session);
  if (!tecnico) return NextResponse.json({ tecnico: null, aviso: MSG_SEM_TECNICO, dia: null, atividades: [], anteriores: [] });
  const empresaId = guard.session.user.empresaId;
  const [dia, config] = await Promise.all([meuDia(empresaId, tecnico.id), carregarConfigApp(empresaId)]);
  // Permissões do app (Equipes › App do colaborador): dado do cliente oculto nem sai do servidor
  const ver = <T extends Parameters<typeof aplicarPrivacidade>[0]>(c: T) => aplicarPrivacidade(c, config);
  return NextResponse.json({ tecnico, dia: dia.dia, atividades: dia.atividades.map(ver), anteriores: dia.anteriores.map(ver) }, { headers: { "Cache-Control": "private, no-store" } });
}
