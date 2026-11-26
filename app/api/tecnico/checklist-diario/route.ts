import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { temModulo } from "@/lib/modulos/servidor";
import { tecnicoDaSessao } from "@/lib/tecnico/sessao";
import { envioDiarioSchema } from "@/lib/checklist-diario/envio";
import { ErroEnvioDiario, registrarEnvioDiario } from "@/lib/checklist-diario/servidor";

const SEM_CACHE = { "Cache-Control": "private, no-store" };

/**
 * POST /api/tecnico/checklist-diario — o app do técnico envia o checklist obrigatório do dia (FEITO, com as respostas
 * e fotos) ou o "Hoje não vou usar o veículo". O aparelho guarda o envio e manda quando há sinal; o mesmo envio de
 * novo não duplica (client_id). Sempre do colaborador ligado ao login. Frota desligada: 200 "ignorado" (a fila do
 * aparelho esvazia; nunca 403 para o app). Sem a permissão de checklist de veículo: 403.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, erro: "Não autorizado" }, { status: 401, headers: SEM_CACHE });
  const u = session.user;
  if (!(await temModulo(u.empresaId, "veiculos"))) return NextResponse.json({ ok: true, acao: "ignorado", registro: null }, { headers: SEM_CACHE });
  if (!pode(u.permissoes, "veiculos", "checklist", u.role)) return NextResponse.json({ ok: false, erro: "Sem permissão para o checklist de veículo." }, { status: 403, headers: SEM_CACHE });
  const parsed = envioDiarioSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: parsed.error.issues[0]?.message ?? "Checklist inválido." }, { status: 400, headers: SEM_CACHE });
  const tecnico = await tecnicoDaSessao(session);
  if (!tecnico) return NextResponse.json({ ok: false, erro: "Seu usuário não está ligado a um colaborador." }, { status: 400, headers: SEM_CACHE });
  try {
    const r = await registrarEnvioDiario({ empresaId: u.empresaId, usuarioId: u.id, tecnicoId: tecnico.id, envio: parsed.data });
    return NextResponse.json(r, { headers: SEM_CACHE });
  } catch (e) {
    if (e instanceof ErroEnvioDiario) return NextResponse.json({ ok: false, erro: e.message }, { status: 400, headers: SEM_CACHE });
    throw e;
  }
}
