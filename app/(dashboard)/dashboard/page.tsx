import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ResumoCard } from "@/components/dashboard/resumo-card";
import { contarAlertasPrazos } from "@/lib/prazo-server";
import { formatarData, cn, LABELS_STATUS_OS } from "@/lib/utils";
import Link from "next/link";
import {
  Users, Thermometer, ClipboardList, CalendarCheck, FileText,
  HardHat, AlertTriangle, CheckCircle, ArrowRight, Timer, Clock, ShoppingCart, Headset,
} from "lucide-react";

export const metadata: Metadata = { title: "Dashboard" };

async function buscarResumos(empresaId: string) {
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

  const [totalClientes, totalEquipamentos, osAbertas, osEmAndamento, osConcluidas, osEmAtraso, contratosAtivos, tecnicosAtivos, ultimasOs] =
    await Promise.all([
      prisma.cliente.count({ where: { empresaId, ativo: true } }),
      prisma.equipamento.count({ where: { empresaId, ativo: true } }),
      prisma.ordemServico.count({ where: { empresaId, status: "ABERTA" } }),
      prisma.ordemServico.count({ where: { empresaId, status: "EM_ANDAMENTO" } }),
      prisma.ordemServico.count({ where: { empresaId, status: "CONCLUIDA", dataConclusao: { gte: inicioMes } } }),
      prisma.ordemServico.count({
        where: {
          empresaId,
          status: { notIn: ["CONCLUIDA", "CANCELADA"] },
          previsaoConclusao: { lt: hoje },
        },
      }),
      prisma.contrato.count({ where: { empresaId, status: "ATIVO" } }),
      prisma.tecnico.count({ where: { empresaId, ativo: true } }),
      prisma.ordemServico.findMany({
        where: { empresaId },
        include: { cliente: { select: { nomeFantasia: true, nome: true } } },
        orderBy: { criadoEm: "desc" },
        take: 5,
      }),
    ]);

  return { totalClientes, totalEquipamentos, osAbertas, osEmAndamento, osConcluidas, osEmAtraso, contratosAtivos, tecnicosAtivos, ultimasOs };
}

const CLASSE_STATUS: Record<string, string> = {
  ABERTA: "badge-status-aberta",
  EM_ANDAMENTO: "badge-status-em_andamento",
  CONCLUIDA: "badge-status-concluida",
  CANCELADA: "badge-status-cancelada",
  AGENDADA: "badge-status-agendada",
  PAUSADA: "badge-status-pausada",
  AGUARDANDO_PECA: "badge-status-aguardando_peca",
};

export default async function DashboardPage() {
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const [r, alertas] = await Promise.all([
    buscarResumos(empresaId),
    contarAlertasPrazos(empresaId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Visão geral de {session!.user!.empresaNome}</p>
      </div>

      {/* Prazos e alertas */}
      <div>
        <p className="label-uppercase mb-3">Prazos e Alertas</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ResumoCard
            titulo="Prazos vencidos"
            valor={alertas.prazosVencidos}
            icone={AlertTriangle}
            corIcone="text-red-600"
            corFundo="bg-red-50"
            href="/prazos?status=ATRASADO"
          />
          <ResumoCard
            titulo="Vencendo hoje"
            valor={alertas.etapasVencendoHoje}
            icone={Clock}
            corIcone="text-amber-600"
            corFundo="bg-amber-50"
            href="/prazos?status=ATIVO"
          />
          <ResumoCard
            titulo="Compras pendentes"
            valor={alertas.pedidosPendentes}
            icone={ShoppingCart}
            corIcone="text-orange-600"
            corFundo="bg-orange-50"
            href="/compras/pedidos"
          />
          <ResumoCard
            titulo="Atendimentos em atraso"
            valor={alertas.atendimentosAtraso}
            icone={Timer}
            corIcone="text-red-600"
            corFundo="bg-red-50"
            href="/ordens"
          />
          <ResumoCard
            titulo="Chamados do portal"
            valor={alertas.chamadosPortal}
            icone={Headset}
            corIcone="text-cyan-600"
            corFundo="bg-cyan-50"
            href="/ordens?origem=PORTAL_CLIENTE"
          />
        </div>
      </div>

      {/* Resumo operacional */}
      <div>
        <p className="label-uppercase mb-3">Ordens de Serviço</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ResumoCard
            titulo="OS Abertas"
            valor={r.osAbertas}
            icone={ClipboardList}
            corIcone="text-primary-600"
            corFundo="bg-primary-50"
            href="/ordens?status=ABERTA"
          />
          <ResumoCard
            titulo="Em Andamento"
            valor={r.osEmAndamento}
            icone={CalendarCheck}
            corIcone="text-amber-600"
            corFundo="bg-amber-50"
            href="/ordens?status=EM_ANDAMENTO"
          />
          <ResumoCard
            titulo="Concluídas no mês"
            valor={r.osConcluidas}
            icone={CheckCircle}
            corIcone="text-success-600"
            corFundo="bg-success-50"
            href="/ordens?status=CONCLUIDA"
          />
          <ResumoCard
            titulo="Em Atraso"
            valor={r.osEmAtraso}
            icone={AlertTriangle}
            corIcone="text-red-600"
            corFundo="bg-red-50"
            href="/ordens"
          />
        </div>
      </div>

      {/* Cadastros */}
      <div>
        <p className="label-uppercase mb-3">Base Operacional</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ResumoCard
            titulo="Clientes"
            valor={r.totalClientes}
            icone={Users}
            corIcone="text-success-600"
            corFundo="bg-success-50"
            href="/clientes"
          />
          <ResumoCard
            titulo="Equipamentos"
            valor={r.totalEquipamentos}
            icone={Thermometer}
            corIcone="text-success-600"
            corFundo="bg-success-50"
            href="/equipamentos"
          />
          <ResumoCard
            titulo="Contratos Ativos"
            valor={r.contratosAtivos}
            icone={FileText}
            corIcone="text-success-600"
            corFundo="bg-success-50"
            href="/contratos"
          />
          <ResumoCard
            titulo="Colaboradores"
            valor={r.tecnicosAtivos}
            icone={HardHat}
            corIcone="text-success-600"
            corFundo="bg-success-50"
            href="/colaboradores"
          />
        </div>
      </div>

      {/* Últimas OS */}
      <div className="card-padded">
        <div className="card-header">
          <h2 className="card-title">Últimas Ordens de Serviço</h2>
          <Link
            href="/ordens"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 transition-colors"
          >
            Ver todas
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {r.ultimasOs.length === 0 ? (
          <p className="text-sm text-ink-muted text-center py-8">
            Nenhuma OS cadastrada ainda.
          </p>
        ) : (
          <div className="divide-y divide-surface-border">
            {r.ultimasOs.map((os) => (
              <Link
                key={os.id}
                href={`/ordens/${os.id}`}
                className="flex items-center justify-between py-3 px-2 -mx-2 rounded-lg hover:bg-surface-alt transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-sm font-semibold text-primary-600 shrink-0">
                    {os.numero}
                  </span>
                  <span className="text-sm text-ink truncate">
                    {os.cliente.nomeFantasia ?? os.cliente.nome}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={cn(CLASSE_STATUS[os.status])}>
                    {LABELS_STATUS_OS[os.status]}
                  </span>
                  <span className="text-xs text-ink-subtle hidden sm:inline">
                    {formatarData(os.criadoEm)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
