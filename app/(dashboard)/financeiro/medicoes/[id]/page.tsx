import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MedicaoDocumento } from "@/components/medicao/medicao-documento";
import { MedicaoAcoes } from "@/components/medicao/medicao-acoes";
import { PageHeader } from "@/components/ui/page-header";
import { formatarData, formatarMoeda, LABELS_STATUS_CONTA_RECEBER, CLASSE_STATUS_CONTA_RECEBER } from "@/lib/utils";
import { Receipt } from "lucide-react";

export const metadata: Metadata = { title: "Medição" };

export default async function MedicaoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const [medicao, empresa] = await Promise.all([
    prisma.medicao.findFirst({
      where: { id, empresaId },
      include: {
        cliente: true,
        contrato: { select: { id: true, numero: true } },
        itens: { orderBy: { ordem: "asc" } },
        contasReceber: true,
      },
    }),
    prisma.empresa.findUnique({ where: { id: empresaId } }),
  ]);

  if (!medicao || !empresa) notFound();

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title={`Medição ${medicao.numero}`}
        description={medicao.descricao ?? undefined}
        backHref="/financeiro/medicoes"
      />

      <div className="card-padded">
        <MedicaoAcoes
          medicaoId={medicao.id}
          numero={medicao.numero}
          tokenPublico={medicao.tokenPublico}
          status={medicao.status}
        />
      </div>

      <div className="card-padded">
        <MedicaoDocumento medicao={medicao} empresa={empresa} cliente={medicao.cliente} />
      </div>

      {medicao.contasReceber.length > 0 && (
        <div className="card-padded">
          <h2 className="card-title mb-3 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary-600" /> Contas a receber
          </h2>
          <div className="divide-y divide-surface-border">
            {medicao.contasReceber.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-mono text-sm font-semibold text-ink">{c.numero}</p>
                  <p className="text-xs text-ink-muted">Venc.: {formatarData(c.dataVencimento)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={CLASSE_STATUS_CONTA_RECEBER[c.status]}>{LABELS_STATUS_CONTA_RECEBER[c.status]}</span>
                  <span className="font-semibold text-ink">{formatarMoeda(Number(c.valor))}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
