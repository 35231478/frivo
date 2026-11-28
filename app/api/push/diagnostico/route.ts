import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chavesVapid } from "@/lib/push/config";
import { configurar, mandarParaAparelhos } from "@/lib/push/servidor";
import { chavesCoerentes, impressaoDaChave } from "@/lib/push/diagnostico";
import { rotuloAparelho, type MensagemPush } from "@/lib/push/tipos";

const MSG_SO_ADMIN = "Só o administrador roda o diagnóstico das notificações.";
const VARIAVEIS = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

/**
 * POST /api/push/diagnostico { usuarioId? } — HOTFIX push, só ADMIN. Confere a configuração do servidor (sem mostrar
 * chave nenhuma: só se existem, se o par confere e a impressão da pública) e manda um teste para CADA aparelho da
 * pessoa (padrão: quem pediu), devolvendo o que o serviço de push respondeu em cada um.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const u = session.user!;
  if (u.role !== "ADMIN") return NextResponse.json({ erro: MSG_SO_ADMIN }, { status: 403 });
  const corpo = await req.json().catch(() => ({}));
  const alvoId = typeof corpo?.usuarioId === "string" && corpo.usuarioId ? corpo.usuarioId : u.id;
  const alvo = await prisma.usuario.findFirst({ where: { id: alvoId, empresaId: u.empresaId }, select: { id: true, nome: true } });
  if (!alvo) return NextResponse.json({ erro: "Usuário não encontrado nesta empresa." }, { status: 404 });

  const chaves = chavesVapid();
  const faltando = VARIAVEIS.filter((v) => !(process.env[v] ?? "").trim());
  const assunto = (process.env.VAPID_SUBJECT ?? "").trim();
  const impressao = chaves ? impressaoDaChave(chaves.publica) : null;
  const servidor = {
    ligado: !!chaves,
    faltando,
    assuntoValido: /^(mailto:|https:\/\/)/.test(assunto),
    parDeChavesConfere: chaves ? chavesCoerentes(chaves.publica, chaves.privada) : null,
    impressaoDaChavePublica: impressao,
  };

  const inscricoes = await prisma.pushSubscription.findMany({
    where: { userId: alvo.id }, orderBy: { criadoEm: "asc" },
    select: { id: true, userAgent: true, criadoEm: true, ultimoEnvioEm: true, chaveImpressao: true, ultimoStatus: true, ultimoErro: true },
  });
  const msg: MensagemPush = { titulo: "Teste de diagnóstico", corpo: "Se esta notificação apareceu, o aviso chega neste aparelho.", url: "/", tag: "diagnostico" };
  const resultados = chaves && configurar() ? await mandarParaAparelhos(alvo.id, msg) : [];
  const resultadoDe = new Map(resultados.map((r) => [r.aparelho, r]));
  if (resultados.length) {
    await prisma.pushEnvio.create({
      data: {
        empresaId: u.empresaId, usuarioId: alvo.id, tipo: "TESTE", chave: `diagnostico:${Date.now()}`, titulo: msg.titulo, url: msg.url,
        aparelhos: resultados.filter((r) => r.ok).length, falhas: resultados.filter((r) => !r.ok).length,
        resultados: resultados.map(({ aparelho, servico, ok, status, motivo }) => ({ aparelho, servico, ok, status, motivo })),
      },
    }).catch(() => null);
  }
  return NextResponse.json({
    servidor,
    usuario: { id: alvo.id, nome: alvo.nome },
    aparelhos: inscricoes.map((i) => {
      const r = resultadoDe.get(i.id);
      return {
        id: i.id, aparelho: rotuloAparelho(i.userAgent), inscritoEm: i.criadoEm, ultimoEnvioEm: i.ultimoEnvioEm,
        // null = inscrito antes desta versão (a impressão ainda não era gravada)
        chaveConfere: i.chaveImpressao ? i.chaveImpressao === impressao : null,
        servico: r?.servico ?? null, ok: r?.ok ?? false, status: r?.status ?? null, motivo: r?.motivo ?? (chaves ? "Não enviado." : "Push desligado no servidor."),
        detalhe: r?.detalhe ?? null, removido: r?.removido ?? false,
      };
    }),
    semAparelho: inscricoes.length === 0,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
