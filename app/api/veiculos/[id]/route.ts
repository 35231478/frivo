import { NextRequest, NextResponse } from "next/server";
import { erroDeValidacao } from "@/lib/forms/erros-server";
import { prisma } from "@/lib/prisma";
import { validarDocumentoDataUrl, validarFotos } from "@/lib/anexos-server";
import { veiculoSchema } from "@/lib/validations";
import { respostaRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";
import { organizarFotosVeiculo } from "@/lib/veiculo-fotos";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode } from "@/lib/permissoes";
import { impactoVeiculo, lerMotivo } from "@/lib/inativacao-server";
import { inativarVeiculo, reativarVeiculo, statusHttp } from "@/lib/acoes-massa/regras";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  // Detalhe com documentos e manutenções: exige ver veículos; id de outra empresa = 404
  const guard = await exigirPermissao("veiculos", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;

  const veiculo = await prisma.veiculo.findFirst({
    where: { id, empresaId },
    include: {
      documentos: { orderBy: { criadoEm: "asc" } },
      manutencoes: { orderBy: { dataRealizacao: "desc" } },
    },
  });
  if (!veiculo) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(veiculo);
}

export async function PUT(req: NextRequest, { params }: Params) {
  // Cadastrar/editar veículo exige "veiculos.gerenciar" (antes bastava estar logado)
  const guard = await exigirPermissao("veiculos", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.veiculo.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = veiculoSchema.safeParse(body);
  if (!parsed.success) return erroDeValidacao(parsed.error);

  const placa = parsed.data.placa.toUpperCase().trim();
  if (placa !== existente.placa) {
    const dup = await prisma.veiculo.findFirst({ where: { empresaId, placa } });
    if (dup) return NextResponse.json({ erro: "Placa já cadastrada" }, { status: 409 });
  }

  const { documentos, responsavelId, equipeId, proximaRevisaoData, seguroVencimento, fotos: fotosBrutas, fotosRotulos: rotulosBrutos, ...rest } = parsed.data;
  // Responsável e equipe precisam ser da empresa (antes, um id de outra empresa era gravado)
  try {
    await validarRefEmpresa("tecnico", responsavelId, empresaId, "Responsável");
    await validarRefEmpresa("equipe", equipeId, empresaId, "Equipe");
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  // Fotos e documentos: tipo decidido pelos BYTES; grava o data URL normalizado
  const fotosValidadas = validarFotos(fotosBrutas);
  if (!fotosValidadas.ok) return NextResponse.json({ erro: fotosValidadas.erro }, { status: 400 });
  const docsValidados: { tipo: typeof documentos[number]["tipo"]; nome: string; arquivoUrl: string | null; dataVencimento?: string | null }[] = [];
  for (const d of documentos) {
    const r = validarDocumentoDataUrl(d.arquivoUrl, d.nome);
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 });
    docsValidados.push({ ...d, arquivoUrl: r.conteudo });
  }
  // Frente primeiro (capa), depois traseira, laterais e outros
  const { fotos, fotosRotulos } = organizarFotosVeiculo(fotosValidadas.fotos, rotulosBrutos);
  // Status "Inativo" no formulário = inativar pela MESMA função do botão e da ação em massa: exige
  // "excluir", respeita o bloqueio do impacto e anota o motivo nas observações (como o colaborador)
  const virandoInativo = rest.status === "INATIVO" && existente.status !== "INATIVO";
  if (virandoInativo) {
    if (!pode(session.user!.permissoes, "veiculos", "excluir", session.user!.role))
      return NextResponse.json({ erro: "Sem permissão para inativar veículos" }, { status: 403 });
    const impacto = await impactoVeiculo(id, empresaId);
    if (impacto?.bloqueio) return NextResponse.json({ erro: impacto.bloqueio }, { status: 409 });
  }

  const veiculo = await prisma.veiculo.update({
    where: { id },
    data: {
      ...rest,
      // o status INATIVO quem grava é inativarVeiculo, logo abaixo (com a anotação)
      ...(virandoInativo && { status: existente.status }),
      fotos,
      fotosRotulos,
      placa,
      responsavelId: responsavelId || null,
      equipeId: equipeId || null,
      proximaRevisaoData: proximaRevisaoData ? new Date(proximaRevisaoData) : null,
      seguroVencimento: seguroVencimento ? new Date(seguroVencimento) : null,
      documentos: {
        deleteMany: {},
        create: docsValidados.map((d) => ({
          tipo: d.tipo,
          nome: d.nome,
          arquivoUrl: d.arquivoUrl,
          dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : null,
        })),
      },
    },
  });

  if (virandoInativo) {
    const u = session.user!;
    const r = await inativarVeiculo(id, { empresaId, usuarioId: u.id, usuarioNome: u.name ?? "usuário", motivo: lerMotivo({ motivo: body?.motivoInativacao }) });
    if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: statusHttp(r) });
    return NextResponse.json(await prisma.veiculo.findUnique({ where: { id } }));
  }
  return NextResponse.json(veiculo);
}

/**
 * Inativa o veículo — soft-delete (status INATIVO). Antes era exclusão física, que
 * apagava junto (cascade) checklists, manutenções e documentos. Body opcional: { motivo }.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("veiculos", "excluir");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const motivo = lerMotivo(await req.json().catch(() => ({})));
  // Mesma regra da ação em massa (lib/acoes-massa/regras.ts)
  const r = await inativarVeiculo(id, { empresaId, usuarioId: session.user!.id, usuarioNome: session.user!.name ?? "usuário", motivo });
  if (!r.ok) return NextResponse.json({ erro: r.codigo === "nao_encontrado" ? "Não encontrado" : r.motivo }, { status: statusHttp(r) });
  return NextResponse.json({ ok: true });
}

/** Reativa o veículo (status ATIVO). Exige "gerenciar". Body: { ativo: true } */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("veiculos", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  if ((await req.json().catch(() => ({})))?.ativo !== true) return NextResponse.json({ erro: "Ação inválida" }, { status: 400 });

  const r = await reativarVeiculo(id, { empresaId, usuarioId: guard.session.user!.id, usuarioNome: guard.session.user!.name ?? "usuário" });
  if (!r.ok) return NextResponse.json({ erro: "Não encontrado" }, { status: statusHttp(r) });
  return NextResponse.json({ ok: true });
}
