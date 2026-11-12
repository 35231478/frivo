import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OsDetalhe } from "@/components/os/os-detalhe";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";
import { carregarGaleria } from "@/lib/os/galeria-server";
import { contasVinculadas } from "@/lib/financeiro/conta-receber-server";
import { pode } from "@/lib/permissoes";
import { osJaFaturada } from "@/lib/faturamento-os";
import { faturamentoDaOs } from "@/lib/faturamento/faturar-server";

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
      // Aceite do cliente: "concluída, aguardando confirmação" no cabeçalho e no que falta
      aceite: { select: { situacao: true, metodo: true, nome: true, confirmadoEm: true, ressalva: true } },
      atividades: {
        include: {
          tipoOs: { select: { id: true, nome: true, cor: true } },
          tecnico: { select: { id: true, nome: true } },
          equipe: { select: { id: true, nome: true, cor: true } },
          tecnicosEquipe: { select: { tecnico: { select: { id: true, nome: true } } }, orderBy: { criadoEm: "asc" } },
          veiculo: { select: { id: true, placa: true, modelo: true, marca: true } },
          respostas: { include: { campo: true } },
          // equipamentoId: o cabeçalho conta equipamento DISTINTO (igual ao card e ao relatório)
          equipamentos: { select: { feito: true, equipamentoId: true } },
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
      // SLA (modelos de prazo): o Resumo conta os atrasados; a gestão fica na aba Atividades
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

  // A aba Financeiro recebe as medições OFICIAIS da OS (deduplicadas), não mais a OsMedicao interna
  const vistas = new Set<string>();
  const medicoesDaOs = os.medicaoItens
    .map((mi) => mi.medicao)
    .filter((m) => (vistas.has(m.id) ? false : (vistas.add(m.id), true)));

  // Fotos & anexos do serviço (só metadados; as imagens são servidas à parte)
  const galeria = await carregarGaleria(empresaId, os.id);
  // Contas a receber da OS (pela medição ou pelo orçamento ligado): só para quem vê o financeiro
  const u = session!.user!;
  const contasReceber = pode(u.permissoes, "financeiro", "visualizar", u.role) ? await contasVinculadas(empresaId, { ordemServicoId: os.id }) : [];

  // Faturar: a OS já está numa fatura/medição viva (direto, relatório ou o orçamento de origem)? Nunca oferece de novo
  const fatura = await osJaFaturada(os.id);
  // P5: OS avulsa pode ser faturada em partes — total, faturado, saldo e as faturas (uma medição de contrato cobre tudo)
  const faturamentoOs = !os.contrato ? await faturamentoDaOs(os.id) : null;
  const faturamento = faturamentoOs && !faturamentoOs.outra ? { total: faturamentoOs.total, faturado: faturamentoOs.faturado, saldo: faturamentoOs.saldo, faturas: faturamentoOs.faturas } : null;
  // E4.2: a amarra da empresa (a central mostra "não conclui sem isso" quando ligada)
  const cfg = await prisma.configuracao.findUnique({ where: { empresaId }, select: { osExigirPrestacaoMaterial: true } });

  // PMOC (Etapa 2): a OS foi gerada pelo cronograma de um plano? Leitura à parte e tolerante: se as
  // tabelas do cronograma ainda não existirem no banco, a OS abre normalmente, só sem o atalho.
  const pmoc = await prisma.pmocExecucao.findFirst({ where: { ordemServicoId: os.id }, select: { pmoc: { select: { id: true, nome: true } } } }).then((x) => x?.pmoc ?? null).catch(() => null);

  return <OsDetalhe os={{ ...os, medicoes: medicoesDaOs, galeria, contasReceber, fatura, faturamento, pmoc, exigirPrestacaoMaterial: cfg?.osExigirPrestacaoMaterial ?? false }} abaInicial={aba} />;
}
