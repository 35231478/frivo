import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Barcode, FileText, ShoppingCart, Upload } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cn, formatarCpfCnpj, formatarData, formatarMoeda, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { statusVisualPagar } from "@/lib/financeiro-status";
import { fornecedorDaConta } from "@/lib/financeiro/fornecedor";
import { formatarLinhaDigitavel, lerBoleto } from "@/lib/financeiro/boleto";
import { ContaPagarAcoes } from "@/components/financeiro/conta-pagar-acoes";
import { CategoriaBadge } from "@/components/financeiro/categoria-badge";
import { CopiarCodigo } from "@/components/financeiro/copiar-codigo";

export const metadata: Metadata = { title: "Conta a pagar" };

const diaBr = (iso: string) => iso.split("-").reverse().join("/");

/** Detalhe da conta a pagar: dados, classificação (categoria e centro de custo), boleto para pagar e pagamentos. */
export default async function ContaPagarPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  const empresaId = session!.user!.empresaId;
  const conta = await prisma.contaPagar.findFirst({
    where: { id, empresaId },
    include: {
      pagamentos: { orderBy: { dataPagamento: "desc" } },
      pedidoCompra: { select: { id: true, numero: true } },
      notaCompra: { select: { id: true, numero: true, serie: true } },
      centroCusto: { select: { id: true, nome: true, ativo: true } },
      fornecedorCadastro: { select: { id: true, nome: true, documento: true, ativo: true } },
    },
  });
  if (!conta) notFound();
  const categorias = await prisma.categoriaFinanceira.findMany({ where: { empresaId }, select: { id: true, nome: true, cor: true, ativo: true } });
  const forn = fornecedorDaConta(conta);
  const sv = statusVisualPagar(conta.status, conta.dataVencimento);
  const leitura = conta.linhaDigitavel ? lerBoleto(conta.linhaDigitavel, conta.dataVencimento ?? new Date()) : null;
  const boleto = leitura?.ok ? leitura.boleto : null;

  const linha = (rotulo: string, valor: React.ReactNode, attr?: string) => (
    <div className="flex justify-between gap-4 py-2 text-sm" {...(attr ? { [attr]: "" } : {})}>
      <dt className="text-ink-muted">{rotulo}</dt>
      <dd className="text-ink text-right min-w-0">{valor}</dd>
    </div>
  );

  return (
    <div className="space-y-5 max-w-4xl">
      <Link href="/financeiro/contas-pagar" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" /> Contas a pagar</Link>

      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 bg-primary-50 rounded-lg shrink-0"><Upload className="w-5 h-5 text-primary-600" /></div>
            <div className="min-w-0">
              <h1 className="page-title">{conta.numero}</h1>
              <p className="text-sm text-ink">{forn.nome}{forn.documento && <span className="text-ink-muted"> · {formatarCpfCnpj(forn.documento)}</span>}</p>
              <p className="text-xs text-ink-muted">{conta.descricao}</p>
            </div>
          </div>
          <div className="text-right space-y-1">
            <p className="text-xl font-bold tabular-nums text-ink">{formatarMoeda(Number(conta.valorTotal))}</p>
            <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full", sv.classe)} data-status-conta>
              {sv.linhaVermelha && <AlertTriangle className="w-3 h-3" />}{sv.label}
            </span>
            <div className="flex justify-end">
              <ContaPagarAcoes conta={{ id: conta.id, numero: conta.numero, fornecedor: forn.nome, valorTotal: Number(conta.valorTotal), valorPago: Number(conta.valorPago), saldoRestante: Number(conta.saldoRestante), status: conta.status }} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4 sm:p-5">
          <p className="text-sm font-semibold text-ink mb-1">Dados da conta</p>
          <dl className="divide-y divide-surface-border">
            {linha("Vencimento", formatarData(conta.dataVencimento))}
            {linha("Saldo", <span className="font-semibold tabular-nums">{formatarMoeda(Number(conta.saldoRestante))}</span>)}
            {linha("Categoria", <CategoriaBadge conta={conta} categorias={categorias} />)}
            {linha("Centro de custo", conta.centroCusto
              ? <span data-centro-custo={conta.centroCusto.id}>{conta.centroCusto.nome}{!conta.centroCusto.ativo && <span className="text-ink-muted"> (inativo)</span>}</span>
              : <span className="text-ink-subtle">—</span>)}
            {linha("Forma de pagamento", conta.formaPagamento ? LABELS_FORMA_PAGAMENTO[conta.formaPagamento] : <span className="text-ink-subtle">—</span>, "data-forma-pagamento")}
            {conta.banco && linha("Banco do fornecedor", conta.banco)}
            {conta.notaCompra && linha("Origem", (
              <Link href={`/estoque/notas/${conta.notaCompra.id}`} className="inline-flex items-center gap-1 font-semibold text-primary-600 hover:underline" data-nota-origem>
                <FileText className="w-3.5 h-3.5" /> NF {conta.notaCompra.numero}/{conta.notaCompra.serie}
              </Link>
            ))}
            {conta.pedidoCompra && linha("Pedido de compra", (
              <Link href={`/compras/pedidos/${conta.pedidoCompra.id}`} className="inline-flex items-center gap-1 font-semibold text-primary-600 hover:underline">
                <ShoppingCart className="w-3.5 h-3.5" /> {conta.pedidoCompra.numero}
              </Link>
            ))}
            {conta.observacao && linha("Observação", <span className="text-ink-muted [overflow-wrap:anywhere]">{conta.observacao}</span>)}
          </dl>
        </div>

        <div className="card p-4 sm:p-5 space-y-3" data-boleto-conta>
          <p className="text-sm font-semibold text-ink flex items-center gap-2"><Barcode className="w-4 h-4 text-primary-600" /> Boleto</p>
          {conta.linhaDigitavel ? (
            <>
              <div>
                <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted">Linha digitável</p>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-mono text-sm text-ink break-all" data-linha-digitavel>{formatarLinhaDigitavel(conta.linhaDigitavel)}</p>
                  <CopiarCodigo texto={conta.linhaDigitavel} rotulo="Copiar linha" />
                </div>
              </div>
              {conta.codigoBarrasBoleto && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted">Código de barras</p>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-mono text-xs text-ink-muted break-all" data-codigo-barras>{conta.codigoBarrasBoleto}</p>
                    <CopiarCodigo texto={conta.codigoBarrasBoleto} rotulo="Copiar código" />
                  </div>
                </div>
              )}
              {boleto && (
                <p className="text-xs text-ink-muted" data-boleto-info>
                  {boleto.tipo === "bancario" ? `${boleto.emissor} (${boleto.banco})` : boleto.emissor}
                  {boleto.valor != null && ` · ${formatarMoeda(boleto.valor)}`}
                  {boleto.vencimento && ` · vence ${diaBr(boleto.vencimento)}`}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-muted" data-sem-boleto>
              Sem boleto. Cole a linha digitável na <Link href={`/financeiro/contas-pagar/${conta.id}/editar`} className="font-semibold text-primary-600 hover:underline">edição da conta</Link> para tê-la aqui na hora de pagar.
            </p>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <p className="px-4 py-3 border-b border-surface-border text-sm font-semibold">Pagamentos · {formatarMoeda(Number(conta.valorPago))} pagos</p>
        {conta.pagamentos.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-subtle">Nenhum pagamento registrado.</p>
        ) : (
          <ul className="divide-y divide-surface-border text-sm">
            {conta.pagamentos.map((p) => (
              <li key={p.id} className="px-4 py-2.5 flex justify-between gap-3">
                <span className="text-ink-muted">{formatarData(p.dataPagamento)}{p.formaPagamento ? ` · ${LABELS_FORMA_PAGAMENTO[p.formaPagamento]}` : ""}{p.banco ? ` · ${p.banco}` : ""}</span>
                <span className="font-semibold tabular-nums">{formatarMoeda(Number(p.valor))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
