import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ResumoCard } from "@/components/dashboard/resumo-card";
import { formatarData, cn, LABELS_STATUS_OS } from "@/lib/utils";
import Link from "next/link";
import { Users, Thermometer, ClipboardList, CalendarCheck, FileText, HardHat, AlertTriangle, CheckCircle } from "lucide-react";

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

const COR_STATUS: Record<string, string> = {
  ABERTA: "bg-blue-100 text-blue-700", EM_ANDAMENTO: "bg-yellow-100 text-yellow-700",
  CONCLUIDA: "bg-green-100 text-green-700", CANCELADA: "bg-red-100 text-red-700",
  AGENDADA: "bg-purple-100 text-purple-700", PAUSADA: "bg-orange-100 text-orange-700",
  AGUARDANDO_PECA: "bg-amber-100 text-amber-700",
};

export default async function DashboardPage() {
  const session = await auth();
  const r = await buscarResumos(session!.user!.empresaId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Visão geral de {session!.user!.empresaNome}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ResumoCard titulo="OS Abertas" valor={r.osAbertas} icone={ClipboardList} corIcone="text-blue-600" corFundo="bg-blue-50" href="/ordens?status=ABERTA" />
        <ResumoCard titulo="OS em Andamento" valor={r.osEmAndamento} icone={CalendarCheck} corIcone="text-yellow-600" corFundo="bg-yellow-50" href="/ordens?status=EM_ANDAMENTO" />
        <ResumoCard titulo="Concluídas no mês" valor={r.osConcluidas} icone={CheckCircle} corIcone="text-green-600" corFundo="bg-green-50" href="/ordens?status=CONCLUIDA" />
        <ResumoCard titulo="OS em Atraso" valor={r.osEmAtraso} icone={AlertTriangle} corIcone="text-red-600" corFundo="bg-red-50" href="/ordens" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ResumoCard titulo="Clientes" valor={r.totalClientes} icone={Users} corIcone="text-blue-600" corFundo="bg-blue-50" href="/clientes" />
        <ResumoCard titulo="Equipamentos" valor={r.totalEquipamentos} icone={Thermometer} corIcone="text-cyan-600" corFundo="bg-cyan-50" href="/equipamentos" />
        <ResumoCard titulo="Contratos Ativos" valor={r.contratosAtivos} icone={FileText} corIcone="text-green-600" corFundo="bg-green-50" href="/contratos" />
        <ResumoCard titulo="Técnicos" valor={r.tecnicosAtivos} icone={HardHat} corIcone="text-yellow-600" corFundo="bg-yellow-50" href="/tecnicos" />
      </div>

      {/* Últimas OS */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Últimas Ordens de Serviço</h2>
          <Link href="/ordens" className="text-xs text-frivo-600 hover:underline">Ver todas</Link>
        </div>
        <div className="space-y-2">
          {r.ultimasOs.map((os) => (
            <Link key={os.id} href={`/ordens/${os.id}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-medium text-frivo-600">{os.numero}</span>
                <span className="text-sm text-gray-700">{os.cliente.nomeFantasia ?? os.cliente.nome}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", COR_STATUS[os.status])}>{LABELS_STATUS_OS[os.status]}</span>
                <span className="text-xs text-gray-400">{formatarData(os.criadoEm)}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
