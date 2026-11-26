import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { diasValidos } from "@/lib/checklist-diario/regras";
import { carregarConfigDiario, ErroEnvioDiario, salvarConfigDiario } from "@/lib/checklist-diario/servidor";

/**
 * Configuração do checklist obrigatório no app (Configurações › Checklists de veículo): ligar, dias da semana, modelo
 * e quem é obrigado. Ler: quem vê Configurações ou Frota; gravar: a mesma permissão que edita os modelos de checklist
 * (Configurações › gerenciar ou Frota › gerenciar). Frota desligada: o portão de módulo da rota responde.
 */
export async function GET() {
  const guard = await exigirAlgumaPermissao([["configuracoes", "visualizar"], ["veiculos", "visualizar"]]);
  if (guard.erro) return guard.resposta;
  return NextResponse.json(await carregarConfigDiario(guard.session.user!.empresaId));
}

const corpo = z.object({
  ativo: z.boolean(),
  dias: z.array(z.number().int().min(0).max(6)).max(7),
  templateId: z.string().min(1).max(64).nullable(),
  todos: z.boolean(),
  tecnicos: z.array(z.string().min(1).max(64)).max(500),
}).strict();

export async function PUT(req: NextRequest) {
  const guard = await exigirAlgumaPermissao([["configuracoes", "gerenciar"], ["veiculos", "gerenciar"]]);
  if (guard.erro) return guard.resposta;
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Configuração inválida." }, { status: 400 });
  const c = parsed.data;
  try {
    const salva = await salvarConfigDiario(guard.session.user!.empresaId, { ...c, dias: diasValidos(c.dias), tecnicos: [...new Set(c.tecnicos)] });
    return NextResponse.json(salva);
  } catch (e) {
    if (e instanceof ErroEnvioDiario) return NextResponse.json({ erro: e.message }, { status: 400 });
    throw e;
  }
}
