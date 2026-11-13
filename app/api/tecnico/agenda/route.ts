import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { agenda } from "@/lib/tecnico/dia";
import { MSG_SEM_TECNICO, tecnicoDaSessao } from "@/lib/tecnico/sessao";
import { aplicarPrivacidade } from "@/lib/tecnico/cartao";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import { comMateriaisPrevistos } from "@/lib/tecnico/o-que-levar-server";

/** Agenda do técnico: hoje e os próximos dias (padrão 14, no máximo 31), agrupados por dia. */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const tecnico = await tecnicoDaSessao(guard.session);
  if (!tecnico) return NextResponse.json({ tecnico: null, aviso: MSG_SEM_TECNICO, dias: [] });
  const n = Math.min(31, Math.max(1, Number(req.nextUrl.searchParams.get("dias")) || 14));
  const empresaId = guard.session.user.empresaId;
  const [dias, config] = await Promise.all([agenda(empresaId, tecnico.id, n), carregarConfigApp(empresaId)]);
  // "O que levar": os materiais previstos de cada OS (uma consulta para a agenda toda); opção desligada = nada sai
  const comMateriais = await comMateriaisPrevistos(empresaId, dias.flatMap((g) => g.atividades), config.oQueLevar);
  const porAtividade = new Map(comMateriais.map((c) => [c.atividadeId, c]));
  // Permissões do app (Equipes › App do colaborador): dado do cliente oculto nem sai do servidor
  return NextResponse.json({ tecnico, dias: dias.map((g) => ({ dia: g.dia, atividades: g.atividades.map((c) => aplicarPrivacidade(porAtividade.get(c.atividadeId) ?? c, config)) })) }, { headers: { "Cache-Control": "private, no-store" } });
}
