import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { exigirPermissao } from "@/lib/permissoes-server";
import { escopoDaSessao } from "@/lib/tecnico/escopo";
import { pedidoVisitasSchema } from "@/lib/os/visitas";
import { ErroVisitas, estadoDasVisitas, executarVisitas } from "@/lib/os/visitas-server";

type Params = { params: Promise<{ id: string }> };

/** O planejamento é do escritório: no app do técnico (escopo restrito às próprias atividades) não existe */
const soEscritorio = (session: Session) => (escopoDaSessao(session).restrito
  ? NextResponse.json({ erro: "O planejamento das visitas é feito pelo escritório." }, { status: 403 }) : null);

/** As visitas da OS: o plano, cada visita com o seu lote, o progresso somado e a proposta do diálogo. */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const fora = soEscritorio(guard.session);
  if (fora) return fora;
  const { id } = await params;
  const estado = await estadoDasVisitas(id, guard.session.user!.empresaId);
  if (!estado) return NextResponse.json({ erro: "Ordem de serviço não encontrada" }, { status: 404 });
  return NextResponse.json(estado);
}

/**
 * Planejar, replanejar e ajustar as visitas: PLANEJAR, MOVER_VISITA, INCLUIR_DIA, TIRAR_DIA e
 * MOVER_EQUIPAMENTOS. Exige "Ordens de serviço › Editar" (a mesma permissão de editar a atividade).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const fora = soEscritorio(session);
  if (fora) return fora;
  const { id } = await params;
  const parsed = pedidoVisitasSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    const e = parsed.error.issues[0];
    return NextResponse.json({ erro: e?.code === "invalid_union_discriminator" ? "Operação inválida." : e?.message ?? "Dados inválidos" }, { status: 400 });
  }
  const ator = { empresaId: session.user!.empresaId, usuarioId: session.user!.id };
  try {
    const resultado = await executarVisitas(id, ator, parsed.data);
    if (!resultado) return NextResponse.json({ erro: "Ordem de serviço não encontrada" }, { status: 404 });
    return NextResponse.json({ resultado, estado: await estadoDasVisitas(id, ator.empresaId) });
  } catch (e) {
    if (e instanceof ErroVisitas) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
