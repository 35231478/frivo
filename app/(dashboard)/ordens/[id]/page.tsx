import type { Metadata } from "next";
import { regraDeCobranca } from "@/lib/orcamentos/materiais";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mostrarEspecialidades } from "@/lib/relatorio-os/dados";
import { OsDetalhe } from "@/components/os/os-detalhe";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";
import { carregarGaleria } from "@/lib/os/galeria-server";
import { pedidoDasOs } from "@/lib/pedido-cliente/server";
import { contasVinculadas } from "@/lib/financeiro/conta-receber-server";
import { pode } from "@/lib/permissoes";
import { osJaFaturada } from "@/lib/faturamento-os";
import { osTemNotaEmitida } from "@/lib/os/trava-edicao-server";
import { faturamentoDaOs } from "@/lib/faturamento/faturar-server";
import { competenciasDosAtrasos } from "@/lib/os/prazo-execucao";
import { hojeDiaCivil } from "@/lib/fuso";
import { mesesFechadosEntre } from "@/lib/desempenho/fechamento-estado";
import { usuarioVeCustoDeCompra } from "@/lib/estoque/custo-acesso";
import { semCustoNosItensOs } from "@/lib/os/custo";

export const metadata: Metadata = { title: "Ordem de serviço" };

export default async function OsDetalhePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const { id } = await params;
  const { aba } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  // Central da OS: o status automático acompanha os fatos — ao abrir, alinha OS antigas que
  // ficaram para trás (idempotente; com ajuste manual não mexe)
  await sincronizarStatusOs(id, empresaId, session!.user!.id).catch(() => null);

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      unidade: { select: { id: true, nome: true, cidade: true, estado: true } },
      contrato: { select: { id: true, numero: true } },
      // Orçamento aprovado que gerou a OS ("Gerar OS"): vira um atalho no cabeçalho
      orcamentoOrigem: { select: { id: true, codigo: true } },
      responsavel: { select: { id: true, nome: true } },
      criadoPor: { select: { id: true, nome: true } },
      // Atraso justificado: quem marcou (o motivo e a data são colunas da própria OS)
      atrasoJustificadoPor: { select: { id: true, nome: true } },
      // Aceite do cliente: "concluída, aguardando confirmação" no cabeçalho e no que falta
      aceite: { select: { situacao: true, metodo: true, nome: true, confirmadoEm: true, ressalva: true } },
      atividades: {
        include: {
          tipoOs: { select: { id: true, nome: true, cor: true } },
          tecnico: { select: { id: true, nome: true, especialidades: true } },
          equipe: { select: { id: true, nome: true, cor: true } },
          tecnicosEquipe: { select: { tecnico: { select: { id: true, nome: true, especialidades: true } } }, orderBy: { criadoEm: "asc" } },
          veiculo: { select: { id: true, placa: true, modelo: true, marca: true } },
          respostas: { include: { campo: true } },
          // equipamentoId: o cabeçalho conta equipamento DISTINTO (igual ao card e ao relatório)
          equipamentos: { select: { feito: true, equipamentoId: true } },
          // Os toques "A caminho"/"Cheguei" de HOJE: o painel deriva "Em deslocamento" deles (lib/os/estado-atividade)
          avisosCliente: { where: { dia: hojeDiaCivil() }, select: { evento: true, registradoEm: true } },
        },
        orderBy: { criadoEm: "asc" },
      },
      itensOrcamento: { orderBy: [{ ordem: "asc" }, { id: "asc" }], include: { materiais: { orderBy: { ordem: "asc" }, include: { separadoPor: { select: { nome: true } }, consumidoPor: { select: { nome: true } }, devolvidoPor: { select: { nome: true } } } }, material: { select: { osItemId: true } } } },
      // Medições OFICIAIS em que a OS entrou (itens de medição → Medicao); a antiga
      // "medição interna da OS" (OsMedicao) saiu: nunca virava conta a receber
      medicaoItens: {
        select: {
          medicao: {
            select: {
              id: true, numero: true, status: true, valorTotal: true, criadoEm: true, tokenPublico: true, avulsa: true,
              // Situação do pagamento no cabeçalho (Previsto / A receber / Vencido / Pago)
              contasReceber: { select: { status: true, dataVencimento: true, valor: true, parcelas: { where: { excluidaEm: null }, select: { status: true, dataVencimento: true } } } },
            },
          },
        },
      },
      // Serviços adicionais pedidos na visita (app do técnico): destacados para o escritório decidir a cobrança
      servicosAdicionais: {
        where: { atividade: { status: { not: "CANCELADA" } } },
        orderBy: { criadoEm: "asc" },
        select: {
          id: true, descricao: true, statusCobranca: true, valor: true, criadoEm: true, atividade: { select: { titulo: true } },
          equipamento: { select: { nome: true, marca: true, modelo: true, patrimonio: true } }, criadoPor: { select: { nome: true } },
          fotos: { orderBy: { criadoEm: "asc" }, select: { id: true } },
        },
      },
      historico: { include: { usuario: { select: { nome: true } } }, orderBy: { criadoEm: "desc" } },
      // Etapas com prazo (modelos de etapas): o Resumo conta as atrasadas e traz a gestão (cartão "Etapas com prazo")
      prazos: { select: { id: true, status: true } },
      orcamentos: {
        include: {
          orcamento: {
            select: {
              id: true, codigo: true, nome: true, status: true, totalGeral: true,
              criadoEm: true, validadeEm: true, tokenPublico: true,
            },
          },
        },
      },
    },
  });
  if (!os) notFound();
  // Leva J: as especialidades do técnico junto ao nome (Configurações › Impressão da OS); desligado, a OS nem as recebe
  if (!(await mostrarEspecialidades(empresaId))) {
    for (const a of os.atividades) {
      if (a.tecnico) a.tecnico.especialidades = [];
      for (const t of a.tecnicosEquipe) t.tecnico.especialidades = [];
    }
  }

  // A aba Financeiro recebe as medições OFICIAIS da OS (deduplicadas), não mais a OsMedicao interna
  const vistas = new Set<string>();
  const medicoesDaOs = os.medicaoItens
    .map((mi) => mi.medicao)
    .filter((m) => (vistas.has(m.id) ? false : (vistas.add(m.id), true)));

  // Fotos & anexos do serviço (só metadados; as imagens são servidas à parte)
  const [galeria, pedidos] = await Promise.all([carregarGaleria(empresaId, os.id), pedidoDasOs(empresaId, [os.id])]);
  // Contas a receber da OS (pela medição ou pelo orçamento ligado): só para quem vê o financeiro
  const u = session!.user!;
  const contasReceber = pode(u.permissoes, "financeiro", "visualizar", u.role) ? await contasVinculadas(empresaId, { ordemServicoId: os.id }) : [];

  // Faturar: a OS já está numa fatura/medição viva (direto, relatório ou o orçamento de origem)? Nunca oferece de novo
  const fatura = await osJaFaturada(os.id);
  // Trava das linhas (registro fechado): a tela também precisa saber se há nota emitida
  const notaEmitida = await osTemNotaEmitida(os.id, fatura?.id);
  // P5: OS avulsa pode ser faturada em partes — total, faturado, saldo e as faturas (uma medição de contrato cobre tudo)
  const faturamentoOs = !os.contrato ? await faturamentoDaOs(os.id) : null;
  const faturamento = faturamentoOs && !faturamentoOs.outra ? { total: faturamentoOs.total, faturado: faturamentoOs.faturado, saldo: faturamentoOs.saldo, faturas: faturamentoOs.faturas } : null;
  // E4.2: a amarra da empresa (a central mostra "não conclui sem isso" quando ligada)
  const cfg = await prisma.configuracao.findUnique({ where: { empresaId }, select: { osExigirPrestacaoMaterial: true, orcamentoCobrancaMateriais: true } });

  // PMOC (Etapa 2): a OS foi gerada pelo cronograma de um plano? Leitura à parte e tolerante: se as
  // tabelas do cronograma ainda não existirem no banco, a OS abre normalmente, só sem o atalho.
  const pmoc = await prisma.pmocExecucao.findFirst({ where: { ordemServicoId: os.id }, select: { pmoc: { select: { id: true, nome: true } } } }).then((x) => x?.pmoc ?? null).catch(() => null);

  // Atraso justificado × desempenho: mês fechado não muda. Quem justifica é avisado quando o atraso
  // é de um mês que já fechou (tolerante: sem o Desempenho no banco, só não há aviso).
  const mesesFechadosDoAtraso = await mesesFechadosEntre(empresaId, competenciasDosAtrasos(os)).catch(() => [] as string[]);

  // Custo na OS: sem permissão de ver custo (lib/estoque/custo-acesso), o custo dos materiais NÃO vai ao navegador
  const verCusto = usuarioVeCustoDeCompra(u);
  const itensOrcamento = verCusto ? os.itensOrcamento : semCustoNosItensOs(os.itensOrcamento);
  return <OsDetalhe verCusto={verCusto} os={{ ...os, pedidoClienteSituacao: pedidos.get(os.id) ?? null, itensOrcamento, medicoes: medicoesDaOs, galeria, contasReceber, fatura, faturamento, notaEmitida, pmoc, mesesFechadosDoAtraso, exigirPrestacaoMaterial: cfg?.osExigirPrestacaoMaterial ?? false,
    // "Orçamento E2": a regra de cobrança dos materiais da OS (a dela; sem ainda, a da empresa — fixada no 1º item com materiais)
    regraMateriais: regraDeCobranca(os.cobrancaMateriais ?? cfg?.orcamentoCobrancaMateriais) }} abaInicial={aba} />;
}
