import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import type { Permissoes } from "@/lib/permissoes";
import {
  ErroIA, LIMITE_POR_HORA, perguntasNaUltimaHora, registrarUso, responderPergunta,
} from "@/lib/ia/assistente";
import { ferramentasDisponiveis, type ContextoIA } from "@/lib/ia/ferramentas";

/**
 * Chat do Frivo IA. Empresa, usuário e permissões vêm SÓ da sessão do servidor; o corpo
 * traz apenas a pergunta e o histórico de texto. As ferramentas (somente leitura) são
 * filtradas pela permissão do perfil e consultam apenas a empresa do usuário.
 */

// Várias consultas encadeadas: mesmo limite das rotas de OCR (o assistente para antes, aos ~45s)
export const maxDuration = 60;

const corpoSchema = z.object({
  pergunta: z.string().trim().min(1, "Digite uma pergunta").max(2000, "Pergunta muito longa (máx. 2000 caracteres)"),
  historico: z.array(z.object({ papel: z.enum(["usuario", "assistente"]), texto: z.string().max(20000) })).max(20).optional(),
}).strict();

async function contexto() {
  const session = await auth();
  if (!session?.user) return null;
  const u = session.user;
  const ctx: ContextoIA = { empresaId: u.empresaId, usuarioId: u.id, permissoes: (u.permissoes ?? {}) as Permissoes, role: u.role };
  return ctx;
}

/** Estado do assistente para a tela: disponível? quais assuntos este perfil pode perguntar? */
export async function GET() {
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  return NextResponse.json({
    disponivel: !!process.env.ANTHROPIC_API_KEY,
    ferramentas: ferramentasDisponiveis(ctx).map((f) => f.nome),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  const { pergunta, historico } = parsed.data;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ erro: "O Frivo IA está indisponível: a chave da Anthropic não está configurada." }, { status: 503 });
  }
  if ((await perguntasNaUltimaHora(ctx.usuarioId)) >= LIMITE_POR_HORA) {
    return NextResponse.json({ erro: `Limite de ${LIMITE_POR_HORA} perguntas por hora atingido. Tente mais tarde.` }, { status: 429 });
  }

  const inicio = Date.now();
  try {
    const resultado = await responderPergunta({ pergunta, historico, ctx });
    await registrarUso({ ctx, pergunta, resultado, duracaoMs: Date.now() - inicio });
    return NextResponse.json({ resposta: resultado.resposta, ferramentas: resultado.ferramentas });
  } catch (e) {
    const erro = e instanceof ErroIA ? e : new ErroIA("O Frivo IA está indisponível no momento.", 502);
    if (!(e instanceof ErroIA)) console.error("[frivo-ia] erro inesperado:", e);
    await registrarUso({ ctx, pergunta, erro: erro.message, duracaoMs: Date.now() - inicio });
    return NextResponse.json({ erro: erro.message }, { status: erro.status });
  }
}
