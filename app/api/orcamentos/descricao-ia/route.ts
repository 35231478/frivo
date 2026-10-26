import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import type { Permissoes } from "@/lib/permissoes";
import { ErroIA, LIMITE_POR_HORA, perguntasNaUltimaHora, registrarUso } from "@/lib/ia/assistente";
import { contextoDaOs, gerarDescricaoOrcamento, temBaseParaDescricao } from "@/lib/ia/descricao-orcamento";
import type { ContextoIA } from "@/lib/ia/ferramentas";

/**
 * "Gerar descrição profissional (IA)" do construtor de orçamento. Só devolve o TEXTO: quem decide
 * usar (e substituir o que já havia) é a tela, com confirmação. Empresa vem da sessão; a OS é
 * buscada pela empresa; o corpo só traz o título e os itens (ainda não salvos) do formulário.
 */
export const maxDuration = 60;

const itemSchema = z.object({
  descricao: z.string().max(500).default(""),
  observacao: z.string().max(1000).nullable().optional(),
});

const corpoSchema = z.object({
  osId: z.string().min(1).nullable().optional(),
  nome: z.string().max(300).nullable().optional(),
  servicos: z.array(itemSchema).max(100).default([]),
  produtos: z.array(itemSchema).max(100).default([]),
});

export async function POST(req: NextRequest) {
  const guard = await exigirAlgumaPermissao([["orcamentos", "criar"], ["orcamentos", "editar"]]);
  if (guard.erro) return guard.resposta;
  const u = guard.session.user!;
  const ctx: ContextoIA = { empresaId: u.empresaId, usuarioId: u.id, permissoes: (u.permissoes ?? {}) as Permissoes, role: u.role };

  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ erro: "IA não configurada." }, { status: 503 });

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const { osId, ...entrada } = parsed.data;

  const os = osId ? await contextoDaOs(osId, ctx.empresaId) : null;
  if (osId && !os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  if (!temBaseParaDescricao(entrada, os)) {
    return NextResponse.json({ erro: "Adicione ao menos um item (ou abra o orçamento a partir de uma OS) para a IA ter o que descrever." }, { status: 400 });
  }
  if ((await perguntasNaUltimaHora(ctx.usuarioId)) >= LIMITE_POR_HORA) {
    return NextResponse.json({ erro: `Limite de ${LIMITE_POR_HORA} pedidos à IA por hora atingido. Tente mais tarde.` }, { status: 429 });
  }

  const pergunta = `[orçamento] descrição IA${os ? ` — ${os.numero}` : ""}`;
  const inicio = Date.now();
  try {
    const resultado = await gerarDescricaoOrcamento({ entrada, os });
    await registrarUso({ ctx, pergunta, resultado, duracaoMs: Date.now() - inicio });
    return NextResponse.json({ descricao: resultado.resposta });
  } catch (e) {
    const erro = e instanceof ErroIA ? e : new ErroIA("A IA está indisponível no momento.", 502);
    if (!(e instanceof ErroIA)) console.error("[orcamento-ia] erro inesperado:", e);
    await registrarUso({ ctx, pergunta, erro: erro.message, duracaoMs: Date.now() - inicio });
    return NextResponse.json({ erro: erro.message }, { status: erro.status });
  }
}
