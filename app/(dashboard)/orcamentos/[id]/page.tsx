import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OrcamentoDocumento } from "@/components/orcamento/orcamento-documento";
import { anexosDoDocumento, INCLUDE_DOCUMENTO_ORCAMENTO } from "@/lib/orcamentos/documento-server";
import { PropostaDocumento } from "@/components/orcamento/proposta-documento";
import { AcoesEnvio } from "@/components/orcamento/acoes-envio";
import { ConverterContrato } from "@/components/orcamento/converter-contrato";
import { ComprasSecao } from "@/components/compras/compras-secao";
import { AnexosProposta } from "@/components/orcamento/anexos-proposta";
import { CicloOrcamento } from "@/components/orcamento/ciclo-orcamento";
import { GerarOs, type OsDoOrcamento } from "@/components/orcamento/gerar-os";
import { ContasReceberVinculadas } from "@/components/financeiro/contas-receber-vinculadas";
import { contasVinculadas } from "@/lib/financeiro/conta-receber-server";
import { etapaCiclo } from "@/lib/orcamentos/ciclo";
import { marcarRespostaVista } from "@/lib/orcamentos/ciclo-server";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { LABELS_STATUS_OS, formatarData, cn } from "@/lib/utils";
import { ClipboardList, ExternalLink, CheckCircle2, FileSignature } from "lucide-react";

export const metadata: Metadata = { title: "Orçamento" };

export default async function OrcamentoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const [orcamento, empresa] = await Promise.all([
    prisma.orcamento.findFirst({
      where: { id, empresaId },
      include: {
        ...INCLUDE_DOCUMENTO_ORCAMENTO,
        criadoPor: { select: { id: true, nome: true } },
        contratoGerado: { select: { id: true, numero: true } },
        osGerada: { select: { id: true, numero: true } },
        ordensServico: {
          include: {
            ordemServico: { select: { id: true, numero: true, status: true, descricao: true, criadoEm: true } },
          },
        },
      },
    }),
    prisma.empresa.findUnique({ where: { id: empresaId } }),
  ]);

  if (!orcamento || !empresa) notFound();

  // Abrir o orçamento respondido pelo cliente = resposta vista (sai do sino)
  await marcarRespostaVista(orcamento, empresaId);
  const eventos = await prisma.orcamentoEvento.findMany({
    where: { orcamentoId: id, empresaId },
    orderBy: { criadoEm: "desc" },
    take: 50,
    select: { id: true, tipo: true, detalhe: true, ip: true, criadoEm: true, usuario: { select: { nome: true } } },
  });

  const podeEditar = orcamento.status === "RASCUNHO";
  const u = session!.user!;
  // Conta a receber do orçamento aprovado (o outro lado do vínculo): só para quem vê o financeiro
  const contasReceber = pode(u.permissoes, "financeiro", "visualizar", u.role) ? await contasVinculadas(empresaId, { orcamentoId: orcamento.id }) : [];
  // A OS do orçamento: a que ele gerou ou, se não gerou, a 1ª vinculada (o "Gerar OS" nunca cria outra)
  const primeiraVinculada = [...orcamento.ordensServico].sort((a, b) => a.ordemServico.criadoEm.getTime() - b.ordemServico.criadoEm.getTime())[0]?.ordemServico;
  const osDoOrcamento: OsDoOrcamento | null = orcamento.osGerada
    ? { ...orcamento.osGerada, gerada: true }
    : primeiraVinculada ? { id: primeiraVinculada.id, numero: primeiraVinculada.numero, gerada: false } : null;
  const ehProposta = orcamento.tipo === "PROPOSTA_CONTRATO";
  const equipamentos = ehProposta && orcamento.equipamentosCobertos.length
    ? (await prisma.equipamento.findMany({
        where: { id: { in: orcamento.equipamentosCobertos }, empresaId },
        select: { id: true, marca: true, modelo: true, numeroSerie: true, unidade: { select: { nome: true } } },
      })).map((e) => ({ id: e.id, rotulo: [e.marca, e.modelo, e.numeroSerie ? `(${e.numeroSerie})` : "", e.unidade?.nome ? `— ${e.unidade.nome}` : ""].filter(Boolean).join(" ") }))
    : [];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title={`Orçamento ${orcamento.codigo}`}
        description={orcamento.nome}
        backHref="/orcamentos"
        actions={
          <InativarRegistro
            url={`/api/orcamentos/${orcamento.id}`} modulo="orcamentos" acaoReativar="editar" variante="botao"
            ativo={orcamento.status !== "CANCELADO"} nome={orcamento.codigo} entidade="orçamento"
            rotuloInativar="Cancelar" rotuloReativar="Reabrir" comMotivo={false}
            textoInativar="Tem certeza? O orçamento passa para Cancelado e sai da lista padrão. Nada é apagado: itens, vínculos e o link público ficam preservados, e ele pode ser reaberto (volta para Rascunho)."
            textoReativar="O orçamento volta para Rascunho (editável) e reaparece na lista."
          />
        }
      />
      {orcamento.status === "CANCELADO" && (
        <div data-aviso-inativo className="bg-surface-page border border-surface-border text-ink rounded-card px-4 py-3 text-sm">
          Este orçamento está <strong>cancelado</strong> (inativado) e não aparece na lista padrão. Use “Reabrir” para voltar a editá-lo.
        </div>
      )}

      <div className="card-padded">
        <AcoesEnvio
          orcamentoId={orcamento.id}
          codigo={orcamento.codigo}
          tokenPublico={orcamento.tokenPublico}
          status={orcamento.status}
          podeEditar={podeEditar}
          etapa={etapaCiclo(orcamento)}
        />
      </div>

      {/* Faturamento avulso, caminho inverso: orçamento aprovado → OS */}
      {orcamento.tipo === "COMUM" && (orcamento.status === "APROVADO" || osDoOrcamento) && (
        <div className="card-padded" data-secao-gerar-os>
          <GerarOs
            orcamentoId={orcamento.id} codigo={orcamento.codigo} os={osDoOrcamento}
            itens={orcamento.servicos.length + orcamento.produtos.length}
            podeCriar={pode(u.permissoes, "ordens", "criar", u.role)} podeVer={pode(u.permissoes, "ordens", "visualizar", u.role)}
          />
        </div>
      )}

      {contasReceber.length > 0 && (
        <div className="card-padded" data-secao-conta-receber>
          <ContasReceberVinculadas contas={contasReceber} podeAbrir={pode(u.permissoes, "financeiro", "contasReceber", u.role)} />
        </div>
      )}

      <div className="card-padded">
        <CicloOrcamento orcamento={orcamento} eventos={eventos} />
      </div>

      {/* Indicadores e conversão da proposta de contrato */}
      {ehProposta && orcamento.status === "APROVADO" && (
        <>
          {orcamento.assinadoEm && (
            <div className="bg-success-50 border-2 border-success-500 text-success-700 rounded-card px-5 py-3 flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="w-5 h-5 shrink-0" /> Aprovada pelo cliente em {formatarData(orcamento.assinadoEm, "dd/MM/yyyy 'às' HH:mm")}
            </div>
          )}
          {!orcamento.contratoGerado && <ConverterContrato orcamentoId={orcamento.id} />}
        </>
      )}
      {ehProposta && orcamento.contratoGerado && (
        <Link href={`/contratos/${orcamento.contratoGerado.id}/editar`}
          className="bg-primary-50 border-2 border-primary-300 text-primary-700 rounded-card px-5 py-3 flex items-center gap-2 text-sm font-semibold hover:bg-primary-100 transition-colors">
          <FileSignature className="w-5 h-5 shrink-0" /> Convertida em contrato {orcamento.contratoGerado.numero}
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      )}

      <div className="card-padded">
        {ehProposta ? (
          <PropostaDocumento
            orcamento={orcamento}
            empresa={empresa}
            cliente={orcamento.cliente}
            responsavelTecnico={orcamento.responsavelTecnico}
            equipamentos={equipamentos}
          />
        ) : (
          <OrcamentoDocumento orcamento={orcamento} empresa={empresa} cliente={orcamento.cliente} versao="interna" anexos={anexosDoDocumento(orcamento.anexos, `/api/orcamentos/${orcamento.id}/anexos`)} />
        )}
      </div>

      {!ehProposta && (
        <div className="card-padded">
          <AnexosProposta
            orcamentoId={orcamento.id}
            editavel={podeEditar && pode(session!.user!.permissoes, "orcamentos", "editar", session!.user!.role)}
            temOs={orcamento.ordensServico.length > 0}
            podeVerOs={pode(session!.user!.permissoes, "ordens", "visualizar", session!.user!.role)}
          />
        </div>
      )}

      <div className="card-padded">
        <ComprasSecao orcamentoId={orcamento.id} />
      </div>

      {orcamento.ordensServico.length > 0 && (
        <div className="card-padded">
          <h2 className="card-title mb-3">Ordens de serviço vinculadas</h2>
          <div className="divide-y divide-surface-border">
            {orcamento.ordensServico.map((vinc) => (
              <Link
                key={vinc.id}
                href={`/ordens/${vinc.ordemServico.id}`}
                className="flex items-center justify-between py-3 hover:bg-surface-alt transition-colors px-2 -mx-2 rounded-lg"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <ClipboardList className="w-4 h-4 text-primary-600 shrink-0" />
                  <span className="font-mono font-semibold text-primary-600 shrink-0">
                    {vinc.ordemServico.numero}
                  </span>
                  <span className="text-sm text-ink truncate">{vinc.ordemServico.descricao}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {vinc.ordemServico.id === orcamento.osGerada?.id && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-acento-claro text-acento" data-os-gerada>Gerada deste orçamento</span>
                  )}
                  <span className={cn(
                    "text-xs font-semibold px-2 py-0.5 rounded-full",
                    "bg-surface-alt text-ink-muted"
                  )}>
                    {LABELS_STATUS_OS[vinc.ordemServico.status] ?? vinc.ordemServico.status}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-ink-muted" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
