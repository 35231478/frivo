import type { Metadata } from "next";
import Link from "next/link";
import { FileBadge, Plus, Pencil, MapPin } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
import { cn } from "@/lib/utils";
import { dataBR, filtroStatusPmoc, LABELS_STATUS_PMOC } from "@/lib/pmoc";
import { PmocStatusSelo } from "@/components/pmoc/pmoc-status-selo";
import { PmocCopiarBotao } from "@/components/pmoc/pmoc-copiar-botao";
import { InativarRegistro } from "@/components/ui/inativar-registro";

export const metadata: Metadata = { title: "PMOC" };

export default async function PmocListaPage({ searchParams }: { searchParams: Promise<{ busca?: string; status?: string; inativos?: string }> }) {
  const { busca = "", status = "", inativos = "" } = await searchParams;
  const mostrarInativos = inativos === "1";
  const session = await auth();
  const { empresaId, permissoes, role } = session!.user!;
  const podeCriar = pode(permissoes, "pmoc", "criar", role);
  const podeEditar = pode(permissoes, "pmoc", "editar", role);

  // Inativado (soft-delete) fica fora da lista padrão
  const where: any = { empresaId, ...(mostrarInativos ? {} : { ativo: true }), ...(filtroStatusPmoc(status) ?? {}) };
  if (busca) {
    where.OR = [
      { nome: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
      { cliente: { nomeFantasia: { contains: busca, mode: "insensitive" } } },
      { unidade: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }
  const pmocs = await prisma.pmoc.findMany({
    where,
    select: {
      id: true, nome: true, status: true, dataInicio: true, dataExpiracao: true, ativo: true,
      cliente: { select: { nome: true, nomeFantasia: true } },
      unidade: { select: { nome: true, cidade: true, estado: true } },
      _count: { select: { equipamentos: true } },
    },
    orderBy: [{ ativo: "desc" }, { dataExpiracao: "asc" }],
    take: 500,
  });

  const local = (u: { nome: string; cidade: string | null; estado: string | null }) => [u.nome, [u.cidade, u.estado].filter(Boolean).join("/")].filter(Boolean).join(" — ");
  const acoes = (p: (typeof pmocs)[number]) => (
    <div className="flex items-center justify-end gap-0.5">
      <Link href={`/pmoc/${p.id}`} title={podeEditar ? "Editar" : "Visualizar"} aria-label="Editar"
        className="p-1.5 rounded-md text-ink-muted hover:text-primary-600 hover:bg-surface-alt"><Pencil className="w-4 h-4" /></Link>
      <PmocCopiarBotao id={p.id} />
      <InativarRegistro url={`/api/pmocs/${p.id}`} modulo="pmoc" acaoReativar="editar" ativo={p.ativo} nome={p.nome} entidade="PMOC" comMotivo={false} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><FileBadge className="w-5 h-5 text-primary-600" /></div>
          <div>
            <h1 className="page-title">PMOC</h1>
            <p className="text-xs text-ink-muted">Plano de Manutenção, Operação e Controle — Lei 13.589/2018</p>
          </div>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{pmocs.length}</span>
        </div>
        {podeCriar && (
          <Link href="/pmoc/novo" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-sm">
            <Plus className="w-4 h-4" /> Novo PMOC
          </Link>
        )}
      </div>

      <div className="card overflow-hidden">
        <form method="get" className="p-4 border-b border-surface-border bg-surface-alt/40 flex flex-wrap items-center gap-2">
          <input name="busca" defaultValue={busca} placeholder="Buscar por nome, cliente ou local…"
            className="flex-1 min-w-[200px] bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10" />
          <select name="status" defaultValue={status} aria-label="Status"
            className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500">
            <option value="">Todos os status</option>
            {Object.entries(LABELS_STATUS_PMOC).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-ink-muted px-1 select-none">
            <input type="checkbox" name="inativos" value="1" defaultChecked={mostrarInativos} className="accent-primary-600" /> Mostrar inativos
          </label>
          <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600">Filtrar</button>
        </form>

        {pmocs.length === 0 ? (
          <div className="text-center py-14 px-4">
            <FileBadge className="w-10 h-10 mx-auto text-ink-subtle" />
            <p className="mt-2 font-medium text-ink">Nenhum PMOC encontrado</p>
            <p className="text-sm text-ink-muted">{podeCriar ? "Crie o primeiro plano em “Novo PMOC”." : "Ainda não há planos cadastrados."}</p>
          </div>
        ) : (
          <>
            {/* Desktop: tabela */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-alt border-b border-surface-border">
                  <tr className="text-left text-xs uppercase tracking-wider text-ink-muted">
                    <th className="px-4 py-3 font-semibold">Nome</th>
                    <th className="px-4 py-3 font-semibold">Cliente</th>
                    <th className="px-4 py-3 font-semibold">Localização</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Validade</th>
                    <th className="px-4 py-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pmocs.map((p) => (
                    <tr key={p.id} data-pmoc-id={p.id} className={cn("border-b border-surface-border hover:bg-primary-50/40", !p.ativo && "opacity-60")}>
                      <td className="px-4 py-3">
                        <Link href={`/pmoc/${p.id}`} className="font-semibold text-ink hover:text-primary-600">{p.nome}</Link>
                        <p className="text-xs text-ink-subtle">{p._count.equipamentos} equipamento(s){!p.ativo && " · inativo"}</p>
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{p.cliente.nomeFantasia ?? p.cliente.nome}</td>
                      <td className="px-4 py-3 text-ink-muted">{local(p.unidade)}</td>
                      <td className="px-4 py-3"><PmocStatusSelo pmoc={p} /></td>
                      <td className="px-4 py-3 text-ink-muted whitespace-nowrap">{dataBR(p.dataInicio)} – {dataBR(p.dataExpiracao)}</td>
                      <td className="px-3 py-2">{acoes(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Celular: cards */}
            <div className="md:hidden divide-y divide-surface-border">
              {pmocs.map((p) => (
                <div key={p.id} data-pmoc-card={p.id} className={cn("p-4 space-y-1.5", !p.ativo && "opacity-60")}>
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/pmoc/${p.id}`} className="font-semibold text-ink">{p.nome}</Link>
                    <PmocStatusSelo pmoc={p} />
                  </div>
                  <p className="text-sm text-ink-muted">{p.cliente.nomeFantasia ?? p.cliente.nome}</p>
                  <p className="text-xs text-ink-muted flex items-center gap-1"><MapPin className="w-3 h-3" /> {local(p.unidade)}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-ink-subtle">Validade {dataBR(p.dataInicio)} – {dataBR(p.dataExpiracao)} · {p._count.equipamentos} equip.</span>
                    {acoes(p)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
