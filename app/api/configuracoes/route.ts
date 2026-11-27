import { NextRequest, NextResponse } from "next/server";
import { limiteHorasSchema } from "@/lib/tecnico/andamento";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { linhasNaoIncluso, normasValidas } from "@/lib/orcamentos/proposta";
import { COBRANCAS_MATERIAIS } from "@/lib/orcamentos/materiais";

/** Texto curto opcional: vazio = sem padrão (null) */
const textoPadrao = (max: number) =>
  z.string().trim().max(max, "Texto muito longo").nullable().optional().transform((v) => (v === undefined ? undefined : v || null));

const configuracaoSchema = z.object({
  clienteEmailObrigatorio: z.boolean().optional(),
  clienteWhatsappObrigatorio: z.boolean().optional(),
  clienteTelefoneObrigatorio: z.boolean().optional(),
  clienteCepObrigatorio: z.boolean().optional(),
  clienteRtObrigatorio: z.boolean().optional(),
  clienteArtObrigatorio: z.boolean().optional(),
  clienteExigirUnidade: z.boolean().optional(),
  clienteExigirDocumento: z.boolean().optional(),
  osExigirFoto: z.boolean().optional(),
  osPermitirSemContrato: z.boolean().optional(),
  osExigirQuestionario: z.boolean().optional(),
  osPermitirEdicaoConcluida: z.boolean().optional(),
  osExigirPrestacaoMaterial: z.boolean().optional(),
  // App do colaborador (modo técnico) — por empresa
  appExibirDadosCliente: z.boolean().optional(),
  appExibirContatosCliente: z.boolean().optional(),
  appEsconderValores: z.boolean().optional(),
  appMarcaDagua: z.boolean().optional(),
  appMarcaDaguaOs: z.boolean().optional(),
  appMarcaDaguaEndereco: z.boolean().optional(),
  appMarcaDaguaCoordenadas: z.boolean().optional(),
  appExigirLocalizacao: z.boolean().optional(),
  appFotoSomenteCamera: z.boolean().optional(),
  appConclusaoObrigatoria: z.boolean().optional(),
  appUmDispositivo: z.boolean().optional(),
  appCadastrarEquipamento: z.boolean().optional(),
  appAvisarCliente: z.boolean().optional(),
  appOQueLevar: z.boolean().optional(),
  appAlertaAndamentoHoras: limiteHorasSchema.optional(),
  appLancarDespesas: z.boolean().optional(),
  appRastrearLocalizacao: z.boolean().optional(),
  notifEmailAbrirOs: z.boolean().optional(),
  notifEmailConcluirOs: z.boolean().optional(),
  notifWhatsappAbrirOs: z.boolean().optional(),
  notifWhatsappConcluirOs: z.boolean().optional(),
  mostrarMapa: z.boolean().optional(),
  mostrarDistancia: z.boolean().optional(),
  mostrarTecnicoProximo: z.boolean().optional(),
  portalCorPrimaria: z.string().nullable().optional(),
  portalLogo: z.string().nullable().optional(),
  portalBoasVindas: z.string().nullable().optional(),
  // Portal: confirmar os serviços pendentes antes de abrir chamado novo (a saída de emergência existe sempre)
  portalAceiteObrigatorio: z.boolean().optional(),
  aceitePedirAvaliacao: z.boolean().optional(),
  // ISS (%) sobre serviços nos orçamentos — 0 a 100, em centésimos
  issAliquota: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(String(v).replace(",", "."))),
    z.number({ invalid_type_error: "Alíquota de ISS inválida" }).min(0, "A alíquota de ISS vai de 0 a 100%").max(100, "A alíquota de ISS vai de 0 a 100%")
      .transform((v) => Math.round(v * 100) / 100).optional()
  ),
  // Padrões do orçamento novo (cada orçamento grava os seus e pode editar)
  orcamentoValidadeDias: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number({ invalid_type_error: "Validade inválida" }).int("A validade é em dias inteiros")
      .min(1, "A validade vai de 1 a 365 dias").max(365, "A validade vai de 1 a 365 dias").optional()
  ),
  // Pedido do cliente (lib/pedido-cliente): o sino avisa a OS que espera o pedido há mais que estes dias
  pedidoClienteDiasAlerta: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number({ invalid_type_error: "Prazo do aviso inválido" }).int("O prazo do aviso é em dias inteiros")
      .min(1, "O aviso vai de 1 a 90 dias").max(90, "O aviso vai de 1 a 90 dias").optional()
  ),
  orcamentoGarantiaServico: textoPadrao(200),
  orcamentoGarantiaPecas: textoPadrao(200),
  orcamentoNaoIncluso: z.string().max(4000, "\"Não incluso\" muito longo").nullable().optional()
    .transform((v) => (v === undefined ? undefined : linhasNaoIncluso(v).join("\n") || null)),
  orcamentoNormas: z.array(z.string().max(40)).max(20).optional().transform((v) => (v === undefined ? undefined : normasValidas(v))),
  // Leva D: padrão de "mostrar materiais" no documento do cliente. "Orçamento E": o antigo "mostrar valores dos
  // materiais" ainda é aceito (tela velha aberta) e ignorado — não muda mais nada (a coluna fica no banco)
  orcamentoMostrarMateriais: z.boolean().optional(),
  // "Orçamento E2": como a empresa cobra os materiais (vale para os orçamentos e OS que nascerem daqui em diante)
  orcamentoCobrancaMateriais: z.enum(COBRANCAS_MATERIAIS, { errorMap: () => ({ message: "Escolha como os materiais entram na cobrança." }) }).optional(),
  orcamentoMostrarValoresMateriais: z.boolean().optional(),
}).strict();

/**
 * "Exigir assinatura do cliente na OS" saiu da tela (não fazia nada: o aceite do cliente cobre). A
 * coluna continua no banco, então o campo é tirado do que sai — e do que chega, porque uma tela
 * aberta antes da atualização ainda manda a configuração inteira de volta, com ele dentro.
 */
const semCampoMorto = <T extends { osExigirAssinatura?: unknown }>({ osExigirAssinatura: _semUso, ...resto }: T) => resto;

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresaId = session.user!.empresaId;

  let config = await prisma.configuracao.findUnique({ where: { empresaId } });

  if (!config) {
    config = await prisma.configuracao.create({
      data: { empresaId },
    });
  }

  return NextResponse.json(semCampoMorto(config));
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  // Permissão, não role: quem tem "Configurações > Gerenciar" no perfil também pode (I5)
  if (!pode(session.user!.permissoes, "configuracoes", "gerenciar", session.user!.role)) {
    return NextResponse.json({ erro: "Sem permissão para alterar configurações." }, { status: 403 });
  }

  const empresaId = session.user!.empresaId;
  const body = await req.json();

  // Remove campos de controle antes de validar (id/empresaId não são editáveis aqui) e os que têm
  // tela/rota própria (QR Code, impressão da OS e horário comercial) — a tela manda a configuração inteira de volta
  const {
    id: _id, empresaId: _empresaId, qrConfig: _qr, relatorioOsConfig: _rel, horarioComercial: _horario,
    // Checklist obrigatório no app: rota própria (/api/checklist-diario/config)
    checklistDiarioAtivo: _cdA, checklistDiarioDias: _cdD, checklistDiarioTemplateId: _cdT, checklistDiarioTodos: _cdTo, checklistDiarioTecnicos: _cdTe,
    // Implantação ("não se aplica / fazer depois"): rota própria (/api/implantacao/etapas); a tela geral não sobrescreve
    implantacaoDispensadas: _impl,
    // Categorias das despesas de campo: rota própria (/api/despesas-campo/categorias); a tela geral não sobrescreve
    despesasCampoCategorias: _despCat,
    ...entrada
  } = semCampoMorto(body);
  const parsed = configuracaoSchema.safeParse(entrada);
  if (!parsed.success) {
    const campos = parsed.error.flatten().fieldErrors;
    const msg = campos.issAliquota?.[0] ?? campos.orcamentoValidadeDias?.[0] ?? campos.pedidoClienteDiasAlerta?.[0] ?? campos.orcamentoNaoIncluso?.[0];
    return NextResponse.json({ erro: msg ?? "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const dados = parsed.data;
  delete dados.orcamentoMostrarValoresMateriais;

  const config = await prisma.configuracao.upsert({
    where: { empresaId },
    create: { empresaId, ...dados },
    update: dados,
  });

  return NextResponse.json(semCampoMorto(config));
}
