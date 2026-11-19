import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { MODULOS_COM_GATE, avisoDependencia, dependentesLigados } from "@/lib/modulos/catalogo";
import { definirModulo, estadoDosModulos, modulosDesligados } from "@/lib/modulos/servidor";

/**
 * MÓDULOS DA EMPRESA — ligar e desligar (fase 1: só os dois do piloto).
 *
 * A lista oferecida é `MODULOS_COM_GATE`: um módulo só aparece aqui quando as três camadas de
 * gate já valem para ele (menu, rota e API). Oferecer antes disso seria vender um interruptor
 * que apaga a luz de um cômodo e deixa a do outro acesa.
 *
 * Quem mexe: "Configurações › Gerenciar" — a mesma permissão de quem já mexe em perfis de acesso.
 * Não é permissão nova: ligar módulo é configurar a empresa.
 */

const corpo = z.object({
  modulo: z.string().min(1),
  ativo: z.boolean(),
});

export async function GET() {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;
  return NextResponse.json({ modulos: await estadoDosModulos(empresaId, MODULOS_COM_GATE) });
}

export async function PUT(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;

  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
  const { modulo, ativo } = parsed.data;
  if (!MODULOS_COM_GATE.includes(modulo)) {
    return NextResponse.json({ erro: "Este módulo ainda não pode ser ligado ou desligado por aqui." }, { status: 400 });
  }

  const r = await definirModulo(empresaId, modulo, ativo, guard.session.user.id);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 409 });

  return NextResponse.json({
    modulos: await estadoDosModulos(empresaId, MODULOS_COM_GATE),
    arrastados: r.arrastados ?? [],
    aviso: avisoDependencia(r.arrastados ?? []),
  });
}

/** A prévia de "o que mais cai junto" — a tela pergunta antes de desligar. */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });

  const desligados = await modulosDesligados(guard.session.user.empresaId);
  const arrastados = parsed.data.ativo ? [] : dependentesLigados(desligados, parsed.data.modulo);
  return NextResponse.json({ arrastados, aviso: avisoDependencia(arrastados) });
}
