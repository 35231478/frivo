import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";
import { validarArquivoUpload } from "@/lib/anexos-server";
import { documentoDeAnexo, equipamentosDaOs, fotoDeAnexo, SELECT_ANEXO_GALERIA } from "@/lib/os/galeria-server";
import { ehImagem, limparLegenda, MSG_EQUIPAMENTO_FORA, MSG_LEGENDA, MSG_REFERENCIA, REFERENCIA_GERAL } from "@/lib/os/galeria";

type Params = { params: Promise<{ id: string }> };

/**
 * Envia uma foto ou um documento para a OS ("Fotos & Anexos do serviço").
 * FOTO (imagem): exige a referência — um equipamento DA OS ou "Geral da OS" (`referencia=GERAL`) —
 * e a legenda: toda foto diz de onde é. DOCUMENTO (PDF, planilha...): sem equipamento; legenda opcional.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;
  if (!(await osDaEmpresa(id, empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("arquivo") as File | null;
  if (!file) return NextResponse.json({ erro: "Nenhum arquivo enviado." }, { status: 400 });
  // Tipo decidido pelo conteúdo (não pelo que o navegador declara): bloqueia HTML/SVG/scripts
  const v = await validarArquivoUpload(file);
  if (!v.ok) return NextResponse.json({ erro: v.erro }, { status: 400 });
  const { nome, tipo, tamanho, conteudo } = v.arquivo;
  const foto = ehImagem(tipo);

  const legendaBruta = formData.get("legenda");
  const legenda = limparLegenda(legendaBruta);
  let equipamentoId: string | null = null;
  let equipamentoNome = "Geral da OS";
  if (foto) {
    const referencia = String(formData.get("referencia") ?? "").trim();
    if (!referencia) return NextResponse.json({ erro: MSG_REFERENCIA }, { status: 400 });
    if (!legenda) return NextResponse.json({ erro: MSG_LEGENDA }, { status: 400 });
    if (referencia !== REFERENCIA_GERAL) {
      const eq = (await equipamentosDaOs(empresaId, id)).find((e) => e.id === referencia);
      if (!eq) return NextResponse.json({ erro: MSG_EQUIPAMENTO_FORA }, { status: 400 });
      equipamentoId = eq.id;
      equipamentoNome = eq.titulo;
    }
  } else if (typeof legendaBruta === "string" && legendaBruta.trim() && !legenda) {
    return NextResponse.json({ erro: MSG_LEGENDA }, { status: 400 });
  }

  const anexo = await prisma.osAnexo.create({
    data: { ordemServicoId: id, nome, tipo, tamanho, conteudo, equipamentoId, legenda, criadoPorId: session.user!.id },
    select: SELECT_ANEXO_GALERIA,
  });

  await prisma.osHistorico.create({
    data: {
      ordemServicoId: id, usuarioId: session.user!.id,
      acao: foto ? "Foto adicionada" : "Documento adicionado",
      detalhes: foto ? `${legenda} — ${equipamentoNome}` : nome,
    },
  });

  return NextResponse.json(
    foto ? { tipo: "foto", foto: fotoDeAnexo(id, anexo) } : { tipo: "documento", documento: documentoDeAnexo(id, anexo) },
    { status: 201 },
  );
}
