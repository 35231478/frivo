import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePortalSession } from "@/lib/portal-server";
import { ChamadoForm } from "@/components/portal/chamado-form";
import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { AceitesPendentes } from "@/components/portal/aceites-pendentes";
import { aceiteObrigatorioNoPortal, pendenciasDoCliente } from "@/lib/os/aceite-server";
import { gateDoChamado } from "@/lib/os/aceite";

export const metadata: Metadata = { title: "Portal — Novo Chamado" };
export const dynamic = "force-dynamic";

export default async function NovoChamadoPage() {
  const { user } = await requirePortalSession();
  if (!user.permissoes?.abrirChamados) redirect("/portal/chamados");

  const [unidades, equipamentos, tipos, pendencias, obrigatorio] = await Promise.all([
    prisma.unidade.findMany({ where: { clienteId: user.clienteId, empresaId: user.empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.equipamento.findMany({ where: { empresaId: user.empresaId, ativo: true, unidade: { clienteId: user.clienteId } }, select: { id: true, marca: true, modelo: true, tipo: true, localizacao: true, unidadeId: true }, orderBy: { marca: "asc" } }),
    prisma.tipoProblema.findMany({ where: { empresaId: user.empresaId, ativo: true }, select: { nome: true }, orderBy: { nome: "asc" } }),
    pendenciasDoCliente(user.empresaId, user.clienteId),
    aceiteObrigatorioNoPortal(user.empresaId),
  ]);
  // Padrão: só mostra (não bloqueia). Com a opção da empresa: pede a confirmação — a emergência passa sempre
  const bloqueado = gateDoChamado({ obrigatorio, pendentes: pendencias.length }) === "BLOQUEADO";

  return (
    <div className="space-y-5 max-w-2xl">
      <Link href="/portal/chamados" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-primary-600"><ChevronLeft className="w-4 h-4" /> Voltar</Link>
      <h1 className="text-2xl font-bold text-ink">Abrir novo chamado</h1>
      <AceitesPendentes pendencias={pendencias} obrigatorio={bloqueado} />
      <ChamadoForm
        confirmacoesPendentes={bloqueado ? pendencias.length : 0}
        unidades={unidades}
        equipamentos={equipamentos.map((e) => ({ id: e.id, unidadeId: e.unidadeId, nome: `${LABELS_TIPO_EQUIPAMENTO[e.tipo] ?? e.tipo} — ${e.marca} ${e.modelo}${e.localizacao ? ` (${e.localizacao})` : ""}` }))}
        tiposProblema={tipos.map((t) => t.nome)}
      />
    </div>
  );
}
