import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OrcamentoDocumento } from "@/components/orcamento/orcamento-documento";
import { AcoesEnvio } from "@/components/orcamento/acoes-envio";
import { ComprasSecao } from "@/components/compras/compras-secao";
import { PageHeader } from "@/components/ui/page-header";
import { LABELS_STATUS_OS, cn } from "@/lib/utils";
import { ClipboardList, ExternalLink } from "lucide-react";

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
        cliente: true,
        criadoPor: { select: { id: true, nome: true } },
        servicos: { orderBy: { ordem: "asc" } },
        produtos: { orderBy: { ordem: "asc" } },
        ordensServico: {
          include: {
            ordemServico: { select: { id: true, numero: true, status: true, descricao: true } },
          },
        },
      },
    }),
    prisma.empresa.findUnique({ where: { id: empresaId } }),
  ]);

  if (!orcamento || !empresa) notFound();

  const podeEditar = orcamento.status === "RASCUNHO";

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title={`Orçamento ${orcamento.codigo}`}
        description={orcamento.nome}
        backHref="/orcamentos"
      />

      <div className="card-padded">
        <AcoesEnvio
          orcamentoId={orcamento.id}
          codigo={orcamento.codigo}
          tokenPublico={orcamento.tokenPublico}
          status={orcamento.status}
          podeEditar={podeEditar}
        />
      </div>

      <div className="card-padded">
        <OrcamentoDocumento orcamento={orcamento} empresa={empresa} cliente={orcamento.cliente} />
      </div>

      <div className="card-padded">
        <ComprasSecao orcamentoId={orcamento.id} />
      </div>

      {orcamento.ordensServico.length > 0 && (
        <div className="card-padded">
          <h2 className="card-title mb-3">Ordens de Serviço vinculadas</h2>
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
