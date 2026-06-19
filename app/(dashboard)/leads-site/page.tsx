import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Globe } from "lucide-react";
import {
  cn,
  formatarDataHora,
  formatarMoeda,
  LABELS_STATUS_ORCAMENTO,
  CLASSE_STATUS_ORCAMENTO,
} from "@/lib/utils";

export const metadata: Metadata = { title: "Leads do Site" };
export const dynamic = "force-dynamic";

const MARCADOR = "SITE_CALCULADORA";

const FILTROS: { key: string; label: string; status: string[] | null }[] = [
  { key: "todos", label: "Todos", status: null },
  { key: "aguardando", label: "Aguardando", status: ["RASCUNHO"] },
  { key: "andamento", label: "Em andamento", status: ["ENVIADO", "APROVADO"] },
  { key: "convertido", label: "Convertido", status: ["CONVERTIDA"] },
];

export default async function LeadsSitePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status = "todos" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const filtro = FILTROS.find((f) => f.key === status) ?? FILTROS[0];

  const where: any = { empresaId, observacao: { contains: MARCADOR } };
  if (filtro.status) where.status = { in: filtro.status };

  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [orcamentos, novos24h] = await Promise.all([
    prisma.orcamento.findMany({
      where,
      include: { cliente: { select: { nome: true, celular: true, cidade: true } } },
      orderBy: { criadoEm: "desc" },
      take: 200,
    }),
    prisma.orcamento.count({
      where: { empresaId, observacao: { contains: MARCADOR }, criadoEm: { gte: desde } },
    }),
  ]);

  const linhas = orcamentos.map((o) => {
    let dados: any = {};
    try {
      dados = JSON.parse(o.observacao ?? "{}");
    } catch {
      /* observacao não-JSON: ignora */
    }
    const contato = dados.contato ?? {};
    const pre = dados.preOrcamento ?? {};
    const semValor =
      pre.totalMin == null || (pre.totalMin === 0 && pre.totalMax === 0);
    return {
      id: o.id,
      codigo: o.codigo,
      data: o.criadoEm,
      nome: contato.nome ?? o.cliente.nome,
      cidade: contato.cidade ?? o.cliente.cidade ?? "—",
      whatsapp: contato.whatsapp ?? o.cliente.celular ?? "—",
      recomendacao: dados.recomendacao ?? dados.ambientes?.[0]?.tipoEquipamento ?? "—",
      valor: semValor
        ? "Sob consulta"
        : `${formatarMoeda(pre.totalMin)} – ${formatarMoeda(pre.totalMax)}`,
      status: o.status as string,
    };
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/10 text-primary-600">
          <Globe className="h-5 w-5" />
        </span>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            Leads do Site
            {novos24h > 0 && (
              <span className="inline-flex items-center rounded-full bg-success-500 px-2 py-0.5 text-xs font-semibold text-white">
                {novos24h} novo{novos24h > 1 ? "s" : ""} em 24h
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500">
            Orçamentos gerados pela calculadora de BTU do site.
          </p>
        </div>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "todos" ? "/leads-site" : `/leads-site?status=${f.key}`}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
              filtro.key === f.key
                ? "border-primary-500 bg-primary-500 text-white"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {linhas.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Globe className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-3 text-sm">Nenhum lead encontrado para este filtro.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Cidade</th>
                <th className="px-4 py-3 font-medium">WhatsApp</th>
                <th className="px-4 py-3 font-medium">Equipamento</th>
                <th className="px-4 py-3 font-medium">Valor estimado</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {formatarDataHora(l.data)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/orcamentos/${l.id}`}
                      className="font-medium text-primary-600 hover:underline"
                    >
                      {l.nome}
                    </Link>
                    <div className="font-mono text-xs text-gray-400">{l.codigo}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{l.cidade}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {l.whatsapp}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{l.recomendacao}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                    {l.valor}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        CLASSE_STATUS_ORCAMENTO[l.status] ??
                        "inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600"
                      }
                    >
                      {LABELS_STATUS_ORCAMENTO[l.status] ?? l.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
