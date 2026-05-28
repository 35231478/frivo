import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatarData, formatarMoeda, cn } from "@/lib/utils";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";

export const metadata: Metadata = { title: "Contratos" };

const LABELS_TIPO: Record<string, string> = {
  MANUTENCAO_PREVENTIVA: "Prev.",
  MANUTENCAO_CORRETIVA: "Corr.",
  MANUTENCAO_COMPLETA: "Completa",
  INSTALACAO: "Instalação",
  LOCACAO: "Locação",
  ASSISTENCIA_TECNICA: "A. Técnica",
};

const COR_STATUS: Record<string, string> = {
  ATIVO: "bg-success-50 text-success-700",
  SUSPENSO: "bg-orange-50 text-orange-700",
  ENCERRADO: "bg-slate-100 text-slate-600",
  VENCIDO: "bg-red-50 text-red-700",
  AGUARDANDO_ASSINATURA: "bg-primary-50 text-primary-700",
};

const LABELS_STATUS: Record<string, string> = {
  ATIVO: "Ativo",
  SUSPENSO: "Suspenso",
  ENCERRADO: "Encerrado",
  VENCIDO: "Vencido",
  AGUARDANDO_ASSINATURA: "Aguard. Assinatura",
};

export default async function ContratosPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; pagina?: string }>;
}) {
  const { busca = "", pagina = "1" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const porPagina = 20;
  const skip = (Number(pagina) - 1) * porPagina;

  const where: any = { empresaId };
  if (busca) {
    where.OR = [
      { numero: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  const [contratos, total] = await Promise.all([
    prisma.contrato.findMany({
      where,
      include: {
        cliente: { select: { id: true, nome: true, nomeFantasia: true } },
        _count: { select: { unidades: true } },
      },
      orderBy: { criadoEm: "desc" },
      skip,
      take: porPagina,
    }),
    prisma.contrato.count({ where }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <FileText className="w-5 h-5 text-primary-600" />
          </div>
          <h1 className="page-title">Contratos</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <Link
          href="/contratos/novo"
          className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
        >
          <Plus className="w-4 h-4" />
          Novo Contrato
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <form method="get">
            <input
              name="busca"
              defaultValue={busca}
              placeholder="Buscar por número ou cliente..."
              className="w-full sm:max-w-sm bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
            />
          </form>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-surface-alt border-b border-surface-border">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Número</th>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Cliente</th>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Tipo</th>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Vigência</th>
              <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Valor/mês</th>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            {contratos.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-ink-subtle py-12">
                  Nenhum contrato encontrado
                </td>
              </tr>
            ) : (
              contratos.map((ct, idx) => (
                <tr key={ct.id} className={cn(
                  "border-b border-surface-border hover:bg-primary-50/40 transition-colors",
                  idx % 2 === 1 && "bg-surface-alt/30",
                )}>
                  <td className="px-4 py-3">
                    <Link href={`/contratos/${ct.id}`} className="font-mono font-semibold text-primary-600 hover:underline">
                      {ct.numero}
                    </Link>
                    <Link href={`/contratos/${ct.id}/editar`} className="block text-xs text-ink-subtle hover:text-primary-600 hover:underline">editar</Link>
                  </td>
                  <td className="px-4 py-3 text-ink font-medium">{ct.cliente.nomeFantasia ?? ct.cliente.nome}</td>
                  <td className="px-4 py-3 text-ink-muted hidden md:table-cell">{LABELS_TIPO[ct.tipo] ?? ct.tipo}</td>
                  <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">
                    {formatarData(ct.dataInicio)} – {formatarData(ct.dataFim) ?? "indeterminado"}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-muted hidden lg:table-cell">
                    {formatarMoeda(ct.valorMensal ? Number(ct.valorMensal) : null)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full", COR_STATUS[ct.status])}>
                      {LABELS_STATUS[ct.status] ?? ct.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
