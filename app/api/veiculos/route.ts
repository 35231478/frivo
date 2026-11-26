import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validarDocumentoDataUrl, validarFotos } from "@/lib/anexos-server";
import { veiculoSchema } from "@/lib/validations";
import { respostaRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";
import { organizarFotosVeiculo } from "@/lib/veiculo-fotos";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import { temModulo } from "@/lib/modulos/servidor";

/**
 * Frota desligada: a LEITURA da lista devolve vazio em vez de 403, de propósito. Quem chama esta
 * rota não é só a tela de Frota — é o formulário da OS, o do colaborador e o da equipe, que são
 * do núcleo e não podem quebrar porque a empresa desligou um módulo opcional. Sem frota, não há
 * veículo a escolher: lista vazia é a resposta honesta. A tela de Frota em si já é barrada antes,
 * na rota, e tudo o que ESCREVE veículo passa por `exigirPermissao("veiculos", …)`, que recusa.
 */
const semFrota = async (empresaId: string) => !(await temModulo(empresaId, "veiculos"));

export async function GET(req: NextRequest) {
  // ?resumo=1: só o necessário para escolher o veículo na OS / no colaborador (sem fotos)
  if (req.nextUrl.searchParams.get("resumo") === "1") {
    const guard = await exigirAlgumaPermissao([["veiculos", "visualizar"], ["ordens", "criar"], ["ordens", "editar"], ["equipes", "gerenciar"]]);
    if (guard.erro) return guard.resposta;
    if (await semFrota(guard.session.user!.empresaId)) return NextResponse.json([]);
    const veiculos = await prisma.veiculo.findMany({
      where: { empresaId: guard.session.user!.empresaId },
      select: { id: true, placa: true, modelo: true, marca: true, status: true, equipeId: true },
      orderBy: { placa: "asc" },
    });
    return NextResponse.json(veiculos);
  }
  // Lista completa (responsável, equipe, contagens): tela de veículos e formulário de equipe.
  // Exige a permissão do módulo, não só estar logado; sempre só da empresa da sessão.
  const guard = await exigirAlgumaPermissao([["veiculos", "visualizar"], ["equipes", "gerenciar"]]);
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  if (await semFrota(empresaId)) return NextResponse.json([]);

  const veiculos = await prisma.veiculo.findMany({
    where: { empresaId },
    include: {
      responsavel: { select: { id: true, nome: true } },
      equipe: { select: { id: true, nome: true, cor: true } },
      _count: { select: { manutencoes: true, checklists: true } },
    },
    orderBy: { placa: "asc" },
  });

  return NextResponse.json(veiculos);
}

export async function POST(req: NextRequest) {
  // Cadastrar/editar veículo exige "veiculos.gerenciar" (antes bastava estar logado)
  const guard = await exigirPermissao("veiculos", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = veiculoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const placa = parsed.data.placa.toUpperCase().trim();
  const existente = await prisma.veiculo.findFirst({ where: { empresaId, placa } });
  if (existente) return NextResponse.json({ erro: "Placa já cadastrada" }, { status: 409 });

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

  const veiculo = await prisma.veiculo.create({
    data: {
      ...rest,
      fotos,
      fotosRotulos,
      placa,
      empresaId,
      responsavelId: responsavelId || null,
      equipeId: equipeId || null,
      proximaRevisaoData: proximaRevisaoData ? new Date(proximaRevisaoData) : null,
      seguroVencimento: seguroVencimento ? new Date(seguroVencimento) : null,
      documentos: {
        create: docsValidados.map((d) => ({
          tipo: d.tipo,
          nome: d.nome,
          arquivoUrl: d.arquivoUrl,
          dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : null,
        })),
      },
    },
  });

  return NextResponse.json(veiculo, { status: 201 });
}
