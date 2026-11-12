import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { CabecalhoEmpresa } from "@/components/relatorio/cabecalho-relatorio";
import { BotaoImprimir } from "@/components/compras/botao-imprimir";
import { formatarCpfCnpj, formatarData, formatarMoeda, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { hrefContaReceber, origemComLink, valorPorExtenso } from "@/lib/financeiro/conta-receber-gestao";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recibo", robots: { index: false, follow: false } };

/**
 * Recibo de uma conta a receber RECEBIDA (Financeiro › Contas a receber), da empresa da sessão.
 * Fica fora do layout do painel para imprimir limpo (A4); "Imprimir / salvar em PDF" gera o arquivo.
 */
export default async function ReciboPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  const u = session?.user;
  if (!u) redirect(`/login?callbackUrl=/financeiro/contas-receber/${id}/recibo`);
  if (!pode(u.permissoes, "financeiro", "contasReceber", u.role)) redirect("/sem-permissao");

  const [conta, empresa] = await Promise.all([
    prisma.contaReceber.findFirst({
      where: { id, empresaId: u.empresaId, excluidaEm: null },
      include: {
        cliente: { select: { nome: true, nomeFantasia: true, cpfCnpj: true } },
        medicao: { select: { numero: true, avulsa: true } }, orcamento: { select: { codigo: true } }, contrato: { select: { numero: true } },
        contaBancaria: { select: { nome: true } },
      },
    }),
    prisma.empresa.findUnique({ where: { id: u.empresaId } }),
  ]);
  if (!conta || !empresa) notFound();

  const voltar = (
    <Link href={hrefContaReceber(conta.id)} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" /> Voltar à cobrança</Link>
  );
  if (conta.status !== "RECEBIDO") {
    return (
      <div className="min-h-screen bg-surface-page py-10 px-4">
        <div className="max-w-lg mx-auto bg-white rounded-card border border-surface-border p-6 space-y-3 text-center" data-recibo-indisponivel>
          <p className="text-ink font-semibold">Recibo indisponível</p>
          <p className="text-sm text-ink-muted">O recibo sai depois de informar o recebimento da cobrança {conta.numero}.</p>
          {voltar}
        </div>
      </div>
    );
  }

  const valor = Number(conta.valor);
  const origem = origemComLink({ ...conta, medicaoNumero: conta.medicao?.numero, medicaoAvulsa: conta.medicao?.avulsa, orcamentoCodigo: conta.orcamento?.codigo, contratoNumero: conta.contrato?.numero });
  const pagador = conta.cliente.nomeFantasia ?? conta.cliente.nome;
  const doc = conta.clienteCnpj ?? conta.cliente.cpfCnpj;
  const recebidoEm = conta.dataRecebimento ?? conta.atualizadoEm;
  const cidade = empresa.cidade ? `${empresa.cidade}${empresa.estado ? `/${empresa.estado}` : ""}, ` : "";

  return (
    <>
      <style>{`
        @page { size: A4; margin: 1.5cm; }
        @media print { body { background: white !important; } .print-hide { display: none !important; } }
      `}</style>
      <div className="min-h-screen bg-surface-page py-4 sm:py-6 print:bg-white print:py-0">
        <div className="print-hide max-w-3xl mx-auto mb-3 px-3 sm:px-0">{voltar}</div>
        <div className="max-w-3xl mx-auto bg-white p-4 sm:p-6 md:p-10 sm:rounded-2xl shadow-card print:shadow-none print:rounded-none print:p-0" data-recibo={conta.numero}>
          <CabecalhoEmpresa empresa={empresa} titulo="Recibo" numero={conta.numero} />
          <div className="py-8 space-y-6 text-ink">
            <p className="text-right text-2xl font-bold" data-recibo-valor>{formatarMoeda(valor)}</p>
            <p className="text-base leading-relaxed" data-recibo-texto>
              Recebemos de <strong>{pagador}</strong>{doc ? `, CPF/CNPJ ${formatarCpfCnpj(doc)},` : ","} a importância de{" "}
              <strong>{formatarMoeda(valor)}</strong> ({valorPorExtenso(valor)}), referente a {conta.descricao}
              {origem ? ` (${origem.rotulo})` : ""}.
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div><dt className="text-ink-muted">Data do recebimento</dt><dd className="font-medium">{formatarData(recebidoEm)}</dd></div>
              <div><dt className="text-ink-muted">Forma de pagamento</dt><dd className="font-medium">{conta.formaPagamento ? LABELS_FORMA_PAGAMENTO[conta.formaPagamento] : "—"}</dd></div>
              <div><dt className="text-ink-muted">Conta</dt><dd className="font-medium">{conta.contaBancaria?.nome ?? conta.banco ?? "—"}</dd></div>
            </dl>
            <p className="text-sm">Para clareza, firmamos o presente recibo.</p>
            <p className="text-sm">{cidade}{formatarData(recebidoEm, "dd 'de' MMMM 'de' yyyy")}.</p>
            <div className="pt-12 flex flex-col items-center text-sm">
              <div className="w-72 max-w-full border-t border-ink" />
              <p className="font-semibold mt-1">{empresa.nomeFantasia ?? empresa.nome}</p>
              <p className="text-ink-muted">CNPJ {formatarCpfCnpj(empresa.cnpj)}</p>
            </div>
          </div>
        </div>
        <BotaoImprimir />
      </div>
    </>
  );
}
