import type { Metadata } from "next";
import { saldoDaConta } from "@/lib/financeiro/parcelas";
import { prisma } from "@/lib/prisma";
import { requirePortalSession, exigePermissao, STATUS_CONTA_PORTAL } from "@/lib/portal-server";
import { SemAcesso } from "@/components/portal/sem-acesso";
import { AprovacaoMedicao } from "@/components/medicao/aprovacao-medicao";
import { BoletoAcoes } from "@/components/portal/boleto-acoes";
import { cn, formatarData, formatarMoeda, nomeMes } from "@/lib/utils";
import { Wallet, CheckCircle2 } from "lucide-react";
import { diaCivilPassou } from "@/lib/fuso";

export const metadata: Metadata = { title: "Portal — Financeiro" };
export const dynamic = "force-dynamic";

export default async function PortalFinanceiro() {
  const sessao = await requirePortalSession();
  if (!exigePermissao(sessao, "verFinanceiro")) return <SemAcesso />;
  const { user } = sessao;
  const verValores = exigePermissao(sessao, "verValores");
  const verBoletos = exigePermissao(sessao, "verBoletos");
  const podeAprovar = exigePermissao(sessao, "aprovarMedicoes");

  const [medicoes, boletosBrutos, pagos] = await Promise.all([
    prisma.medicao.findMany({
      where: { empresaId: user.empresaId, clienteId: user.clienteId, status: "AGUARDANDO_APROVACAO" },
      select: { id: true, numero: true, mes: true, ano: true, valorLiquido: true, tokenPublico: true },
      orderBy: { criadoEm: "desc" },
    }),
    verBoletos ? prisma.contaReceber.findMany({
      where: { empresaId: user.empresaId, clienteId: user.clienteId, status: { in: [...STATUS_CONTA_PORTAL] } },
      select: { id: true, numero: true, descricao: true, valor: true, valorRecebido: true, dataVencimento: true, status: true, medicao: { select: { boletoUrl: true, boletoCodigoBarras: true } } },
      orderBy: { dataVencimento: "asc" },
    }) : Promise.resolve([]),
    prisma.contaReceber.findMany({
      where: { empresaId: user.empresaId, clienteId: user.clienteId, status: "RECEBIDO" },
      select: { id: true, numero: true, descricao: true, valor: true, dataRecebimento: true },
      orderBy: { dataRecebimento: "desc" }, take: 20,
    }),
  ]);

  // O cliente vê o que falta pagar (a parte já paga de uma conta não aparece de novo)
  const boletos = boletosBrutos.map((b) => ({ ...b, valor: saldoDaConta(b) }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Wallet className="w-6 h-6 text-primary-600" /> Faturas</h1>

      {/* Faturas pendentes de aprovação (rótulo leigo — C1: "medição" é jargão interno) */}
      <section>
        <h2 className="text-sm font-bold text-ink-muted uppercase tracking-wider mb-2">Faturas aguardando sua aprovação</h2>
        {medicoes.length === 0 ? (
          <div className="bg-white rounded-card border border-surface-border p-6 text-center text-ink-muted text-sm">Nenhuma fatura aguardando aprovação.</div>
        ) : (
          <div className="space-y-4">
            {medicoes.map((m) => (
              <div key={m.id} className="bg-white rounded-card border border-surface-border p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-semibold text-ink" data-fatura-rotulo>{m.mes ? `Fatura de ${nomeMes(m.mes)}/${m.ano}` : "Fatura"}</p>
                    <p className="font-mono text-xs text-ink-muted">{m.numero}</p>
                  </div>
                  {verValores && <p className="text-lg font-bold text-success-700">{formatarMoeda(Number(m.valorLiquido))}</p>}
                </div>
                {podeAprovar ? (
                  <AprovacaoMedicao token={m.tokenPublico} />
                ) : (
                  <p className="text-xs text-ink-subtle">Você não tem permissão para aprovar faturas.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Boletos */}
      {verBoletos && (
        <section>
          <h2 className="text-sm font-bold text-ink-muted uppercase tracking-wider mb-2">Boletos em aberto</h2>
          {boletos.length === 0 ? (
            <div className="bg-white rounded-card border border-surface-border p-6 text-center text-ink-muted text-sm">Nenhum boleto em aberto.</div>
          ) : (
            <div className="space-y-2">
              {boletos.map((b) => {
                const vencido = diaCivilPassou(b.dataVencimento); // vencido só depois do dia (Brasília)
                return (
                  <div key={b.id} className="bg-white rounded-card border border-surface-border p-4 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{b.descricao}</p>
                      <p className="text-xs text-ink-muted">
                        Venc.: {formatarData(b.dataVencimento)}
                        {vencido && <span className="ml-2 text-[10px] font-bold bg-atrasado-claro text-atrasado-texto px-1.5 py-0.5 rounded">VENCIDO</span>}
                      </p>
                      <div className="mt-1"><BoletoAcoes boletoUrl={b.medicao?.boletoUrl} codigoBarras={b.medicao?.boletoCodigoBarras} /></div>
                    </div>
                    {verValores && <p className={cn("font-bold", vencido ? "text-atrasado" : "text-ink")}>{formatarMoeda(Number(b.valor))}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Histórico de pagamentos */}
      <section>
        <h2 className="text-sm font-bold text-ink-muted uppercase tracking-wider mb-2">Histórico de pagamentos</h2>
        {pagos.length === 0 ? (
          <div className="bg-white rounded-card border border-surface-border p-6 text-center text-ink-muted text-sm">Nenhum pagamento registrado.</div>
        ) : (
          <div className="space-y-2">
            {pagos.map((p) => (
              <div key={p.id} className="bg-white rounded-card border border-surface-border p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-success-600 shrink-0" />
                  <div className="min-w-0"><p className="text-sm text-ink truncate">{p.descricao}</p><p className="text-xs text-ink-muted">Pago em {formatarData(p.dataRecebimento)}</p></div>
                </div>
                {verValores && <p className="text-sm font-semibold text-ink">{formatarMoeda(Number(p.valor))}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
