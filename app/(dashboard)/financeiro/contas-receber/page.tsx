import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  cn, formatarData, formatarMoeda, formatarCpfCnpj,
  LABELS_STATUS_CONTA_RECEBER, LABELS_FORMA_PAGAMENTO,
} from "@/lib/utils";
import { statusVisualReceber } from "@/lib/financeiro-status";
import { AvatarCliente } from "@/components/ui/avatar-cliente";
import { Receipt, AlertTriangle } from "lucide-react";
import { ContaReceberAcoes } from "@/components/financeiro/conta-receber-acoes";

export const metadata: Metadata = { title: "Contas a Receber" };

export default async function ContasReceberPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; clienteId?: string; formaPagamento?: string; banco?: string; valorMin?: string; valorMax?: string; dataInicio?: string; dataFim?: string }>;
}) {
  const sp = await searchParams;
  const { status = "", clienteId = "", formaPagamento = "", banco = "", valorMin = "", valorMax = "", dataInicio = "", dataFim = "" } = sp;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  await prisma.contaReceber.updateMany({
    where: { empresaId, status: { in: ["PREVISTO", "A_RECEBER"] }, dataVencimento: { lt: hoje } },
    data: { status: "ATRASADO" },
  });

  const where: any = { empresaId };
  if (status) where.status = status;
  if (clienteId) where.clienteId = clienteId;
  if (formaPagamento) where.formaPagamento = formaPagamento;
  if (banco) where.banco = { contains: banco, mode: "insensitive" };
  if (valorMin || valorMax) {
    where.valor = {};
    if (valorMin) where.valor.gte = Number(valorMin);
    if (valorMax) where.valor.lte = Number(valorMax);
  }
  if (dataInicio || dataFim) {
    where.dataVencimento = {};
    if (dataInicio) where.dataVencimento.gte = new Date(dataInicio);
    if (dataFim) { const f = new Date(dataFim); f.setHours(23, 59, 59, 999); where.dataVencimento.lte = f; }
  }

  const [contas, clientes] = await Promise.all([
    prisma.contaReceber.findMany({
      where,
      include: {
        cliente: {
          select: {
            id: true, nome: true, nomeFantasia: true, logo: true, cpfCnpj: true,
            email: true, telefone: true, celular: true, whatsappFaturamento: true, emailsFaturamento: true,
          },
        },
      },
      orderBy: [{ dataVencimento: "asc" }, { criadoEm: "desc" }],
      take: 200,
    }),
    prisma.cliente.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, nomeFantasia: true }, orderBy: { nome: "asc" } }),
  ]);

  // Totalizadores do conjunto filtrado
  let totalFiltrado = 0, totalVencido = 0, totalAVencer = 0, totalPago = 0;
  const linhas = contas.map((c) => {
    const valor = Number(c.valor);
    const sv = statusVisualReceber(c.status, c.dataVencimento);
    totalFiltrado += valor;
    if (sv.chave === "PAGO") totalPago += valor;
    else if (sv.chave === "VENCIDO") totalVencido += valor;
    else totalAVencer += valor;
    return { c, valor, sv };
  });

  const inputCls = "bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-lg"><Receipt className="w-5 h-5 text-primary-600" /></div>
        <h1 className="page-title">Contas a Receber</h1>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <form method="get" className="flex flex-wrap gap-2">
            <select name="status" defaultValue={status} className={inputCls}>
              <option value="">Todos status</option>
              {Object.entries(LABELS_STATUS_CONTA_RECEBER).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select name="clienteId" defaultValue={clienteId} className={inputCls}>
              <option value="">Todos clientes</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nomeFantasia ?? c.nome}</option>)}
            </select>
            <select name="formaPagamento" defaultValue={formaPagamento} className={inputCls}>
              <option value="">Todas formas</option>
              {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input name="banco" defaultValue={banco} placeholder="Banco" className={cn(inputCls, "w-28")} />
            <input type="number" name="valorMin" defaultValue={valorMin} placeholder="Valor de" className={cn(inputCls, "w-28")} />
            <input type="number" name="valorMax" defaultValue={valorMax} placeholder="até" className={cn(inputCls, "w-24")} />
            <input type="date" name="dataInicio" defaultValue={dataInicio} title="Vencimento de" className={inputCls} />
            <input type="date" name="dataFim" defaultValue={dataFim} title="Vencimento até" className={inputCls} />
            <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm">Filtrar</button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Cliente</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">CNPJ</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden xl:table-cell">Descrição</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Valor</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Vencimento</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Banco</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-ink-subtle py-12">Nenhuma conta encontrada</td></tr>
              ) : (
                linhas.map(({ c, valor, sv }) => {
                  const nome = c.cliente.nomeFantasia ?? c.cliente.nome;
                  const cnpj = c.clienteCnpj ?? c.cliente.cpfCnpj;
                  const whatsapp = c.cliente.whatsappFaturamento ?? c.cliente.celular ?? c.cliente.telefone ?? null;
                  const email = c.cliente.emailsFaturamento?.[0] ?? c.cliente.email ?? null;
                  return (
                    <tr key={c.id} className={cn("border-b border-surface-border transition-colors", sv.linhaVermelha ? "bg-red-50 hover:bg-red-100/60" : "hover:bg-primary-50/40")}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <AvatarCliente nome={nome} logoUrl={c.cliente.logo} size={28} />
                          <span className="font-medium text-ink truncate max-w-[180px]">{nome}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">{cnpj ? formatarCpfCnpj(cnpj) : "—"}</td>
                      <td className="px-4 py-3 text-ink-muted hidden xl:table-cell truncate max-w-[220px]">{c.descricao}</td>
                      <td className="px-4 py-3 text-right font-bold text-success-700">{formatarMoeda(valor)}</td>
                      <td className="px-4 py-3 text-ink-muted hidden md:table-cell">{formatarData(c.dataVencimento)}</td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full", sv.classe)}>
                          {sv.linhaVermelha && <AlertTriangle className="w-3 h-3" />}
                          {sv.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">{c.banco ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <ContaReceberAcoes conta={{
                          id: c.id, numero: c.numero, descricao: c.descricao, valor,
                          dataVencimento: c.dataVencimento ? c.dataVencimento.toISOString() : null,
                          status: c.status, banco: c.banco, clienteNome: nome, whatsapp, email,
                        }} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {linhas.length > 0 && (
              <tfoot className="bg-surface-alt border-t border-surface-border">
                <tr className="text-sm">
                  <td colSpan={3} className="px-4 py-3 font-semibold text-ink">Totais ({linhas.length})</td>
                  <td className="px-4 py-3 text-right font-bold text-ink">{formatarMoeda(totalFiltrado)}</td>
                  <td colSpan={4} className="px-4 py-3">
                    <div className="flex items-center justify-end gap-4 text-xs">
                      <span className="text-red-700 font-semibold">Vencido: {formatarMoeda(totalVencido)}</span>
                      <span className="text-primary-700 font-semibold">A vencer: {formatarMoeda(totalAVencer)}</span>
                      <span className="text-success-700 font-semibold">Pago: {formatarMoeda(totalPago)}</span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
