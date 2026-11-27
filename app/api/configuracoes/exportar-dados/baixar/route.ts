import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdminExportacao } from "@/lib/exportacao/acesso";
import { ehParte, nomeDoZip } from "@/lib/exportacao/arquivos";
import { arquivosDoPacote, type Contagem } from "@/lib/exportacao/servidor";
import { zipEmStream } from "@/lib/zip-stream";
import type { ArquivoId } from "@/lib/exportacao/arquivos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** O limite da função na Vercel (o mesmo do cron). Passou disso, o pacote sai por parte (?parte=). */
export const maxDuration = 300;

/**
 * Baixa o pacote com os dados da empresa (.zip com um CSV por cadastro + LEIA-ME), em streaming: o download
 * começa na hora e a memória fica do tamanho de um lote. `?parte=cadastros|operacao|financeiro` baixa só uma
 * parte (para empresa grande, se o pacote inteiro não couber no tempo da função).
 *
 * A trilha: a exportação é REGISTRADA (quem, quando, qual parte) ANTES do primeiro byte — sem o registro, nada
 * sai. No fim, o registro ganha a hora de conclusão e as contagens; se der erro ou o download for interrompido,
 * o motivo.
 */
export async function GET(req: NextRequest) {
  const g = await exigirAdminExportacao();
  if (!g.ok) return g.resposta;
  const parte = req.nextUrl.searchParams.get("parte") ?? "tudo";
  if (!ehParte(parte)) return NextResponse.json({ erro: "Parte inválida." }, { status: 400 });

  const empresa = await prisma.empresa.findUnique({ where: { id: g.empresaId }, select: { nome: true, nomeFantasia: true, cnpj: true } });
  if (!empresa) return NextResponse.json({ erro: "Empresa não encontrada." }, { status: 404 });

  const agora = new Date();
  const registro = await prisma.exportacaoDados.create({
    data: { empresaId: g.empresaId, usuarioId: g.usuario.id, usuarioNome: g.usuario.nome, parte },
    select: { id: true },
  });
  const marcar = (data: { concluidaEm?: Date; arquivos?: number; linhas?: number; erro?: string }) =>
    prisma.exportacaoDados.updateMany({ where: { id: registro.id, empresaId: g.empresaId, concluidaEm: null }, data }).catch(() => undefined);

  const contagens = new Map<ArquivoId, Contagem>();
  const arquivos = arquivosDoPacote(g.empresaId, parte, { empresa: empresa.nome, cnpj: empresa.cnpj, geradoEm: agora, geradoPor: g.usuario.nome }, contagens);
  const zip = zipEmStream(arquivos, {
    agora,
    aoTerminar: async (r) => {
      const linhas = [...contagens.values()].reduce((s, c) => s + c.linhas, 0);
      await marcar({ concluidaEm: new Date(), arquivos: r.arquivos.length, linhas });
    },
  });

  let terminou = false;
  const corpo = new ReadableStream<Uint8Array>({
    async pull(controle) {
      try {
        const { value, done } = await zip.next();
        if (done) { terminou = true; controle.close(); } else controle.enqueue(value);
      } catch (e) {
        terminou = true;
        console.error("[exportar-dados] falhou", e);
        await marcar({ erro: "A exportação falhou no meio. Tente de novo ou baixe por parte." });
        controle.error(e);
      }
    },
    async cancel() {
      if (terminou) return;
      await marcar({ erro: "Download interrompido antes do fim." });
      await zip.return(undefined).catch(() => undefined);
    },
  });

  const nome = nomeDoZip(empresa.nomeFantasia || empresa.nome, parte, agora);
  return new Response(corpo, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
