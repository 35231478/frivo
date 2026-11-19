import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardaDoDono } from "@/lib/anotacoes/guarda";
import { criarAnotacao, listarAnotacoes } from "@/lib/anotacoes/servidor";
import { TEXTO_MAX, ehStatusAnotacao } from "@/lib/anotacoes/regras";

/**
 * ANOTAÇÕES INTERNAS — ferramenta de construção do DONO do Frivo (role SUPER_ADMIN).
 *
 * A trava é de SERVIDOR, não cosmética: quem não é o dono leva 403 aqui, mesmo que descubra a URL.
 * E o `Quem` abaixo sai da SESSÃO (empresa + usuário), nunca do corpo do pedido — é o que mantém o
 * isolamento multiempresa valendo igual para o SUPER_ADMIN.
 */

const ancoraSchema = z.object({
  ancora: z.string().max(200).nullish(),
  ancoraIndice: z.number().int().min(0).max(10_000).nullish(),
  caminho: z.string().max(300).nullish(),
  rotulo: z.string().max(200).nullish(),
  papel: z.string().max(200).nullish(),
  fx: z.number().min(0).max(1).nullish(),
  fy: z.number().min(0).max(1).nullish(),
  x: z.number().int().min(0).max(1_000_000).nullish(),
  y: z.number().int().min(0).max(1_000_000).nullish(),
  viewportW: z.number().int().min(0).max(100_000).nullish(),
});

const novaSchema = ancoraSchema.extend({
  tela: z.string().min(1).max(300),
  rota: z.string().min(1).max(500),
  tituloTela: z.string().max(200).nullish(),
  texto: z.string().min(1).max(TEXTO_MAX),
  print: z.object({
    conteudo: z.string().min(1),
    largura: z.number().int().min(1).max(20_000),
    altura: z.number().int().min(1).max(20_000),
    printFx: z.number().min(0).max(1).nullish(),
    printFy: z.number().min(0).max(1).nullish(),
  }).nullish(),
});

export async function GET(req: NextRequest) {
  const g = await guardaDoDono();
  if (g.erro) return g.resposta;
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const tela = sp.get("tela");
  return NextResponse.json({
    anotacoes: await listarAnotacoes(g.quem, {
      status: ehStatusAnotacao(status) ? status : undefined,
      tela: tela || undefined,
    }),
  });
}

export async function POST(req: NextRequest) {
  const g = await guardaDoDono();
  if (g.erro) return g.resposta;
  const parsed = novaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
  const d = parsed.data;
  const r = await criarAnotacao(g.quem, {
    tela: d.tela, rota: d.rota, tituloTela: d.tituloTela ?? null, texto: d.texto,
    ancora: d.ancora ?? null, ancoraIndice: d.ancoraIndice ?? 0, caminho: d.caminho ?? null,
    rotulo: d.rotulo ?? null, papel: d.papel ?? null,
    fx: d.fx ?? null, fy: d.fy ?? null, x: d.x ?? null, y: d.y ?? null, viewportW: d.viewportW ?? null,
    print: d.print ?? null,
  });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 });
  return NextResponse.json({ id: r.id, avisoPrint: r.avisoPrint }, { status: 201 });
}
