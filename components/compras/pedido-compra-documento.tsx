import { TimbreEmpresa } from "@/components/documento/timbre-empresa";
import { cn, formatarCpfCnpj, formatarData, formatarTelefone } from "@/lib/utils";
import { quantidadesAlinhadas, type EmpresaTimbre } from "@/lib/orcamentos/proposta";
import type { Origem } from "@/lib/compras/pedido";

export interface DadosDocumentoPedido {
  numero: string;
  emitidoEm: Date | string;
  prazoNecessario: Date | string | null;
  observacao: string | null;
  motivo: string | null;
  origem: Origem;
  comprador: { nome: string; email?: string | null; telefone?: string | null } | null;
  fornecedor: { nome: string; documento?: string | null; email?: string | null; telefone?: string | null } | null;
  itens: { descricao: string; produtoNome?: string | null; quantidade: number; unidade: string }[];
}

const th = "px-2 py-1.5 font-semibold text-ink-muted text-[10px] uppercase tracking-wider";
const td = "px-2 py-1.5 print:py-1 align-top";
/** Espaço em branco para o fornecedor escrever (na tela e no papel) */
const branco = "border-b border-dashed border-ink/30 min-w-[4rem]";

/**
 * O Pedido de Compra que vai ao fornecedor (PDF/impressão e link público): timbre do orçamento,
 * número, emissão, prazo, origem; itens estilo planilha SEM preço, com colunas e campos em branco
 * para o fornecedor preencher preço, prazo de entrega e validade da proposta.
 */
export function PedidoCompraDocumento({ pedido, empresa }: { pedido: DadosDocumentoPedido; empresa: EmpresaTimbre & { logo?: string | null } }) {
  const qtds = quantidadesAlinhadas(pedido.itens.map((i) => i.quantidade));
  const { origem } = pedido;
  const origemTxt = origem.os
    ? `OS ${origem.os.numero}${origem.orcamento ? ` (orçamento ${origem.orcamento.codigo})` : ""}`
    : origem.orcamento ? `Orçamento ${origem.orcamento.codigo}` : `Avulso${pedido.motivo ? ` — ${pedido.motivo}` : ""}`;
  const f = pedido.fornecedor;

  return (
    <div className="bg-white text-ink print:text-[12px]" data-documento-pedido-compra>
      <TimbreEmpresa empresa={empresa}>
        <div className="sm:text-right shrink-0" data-numero-pedido>
          <p className="text-xs uppercase tracking-wider text-ink-muted">Pedido de Compra Nº</p>
          <p className="font-mono text-2xl font-bold text-primary-600 tabular-nums">{pedido.numero}</p>
        </div>
      </TimbreEmpresa>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-5 py-5 border-b border-surface-border break-inside-avoid">
        <div className="md:col-span-2 min-w-0" data-para-fornecedor>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1">Fornecedor</p>
          {f ? (
            <>
              <p className="text-base font-bold text-ink">{f.nome}</p>
              {f.documento && <p className="text-xs text-ink-muted">CNPJ/CPF {formatarCpfCnpj(f.documento)}</p>}
              {(f.telefone || f.email) && <p className="text-xs text-ink-muted [overflow-wrap:anywhere]">{[f.telefone ? formatarTelefone(f.telefone) : null, f.email].filter(Boolean).join(" · ")}</p>}
            </>
          ) : (
            <p className="text-sm text-ink-muted">A definir</p>
          )}
        </div>
        <dl className="text-sm space-y-1" data-dados-documento>
          <div className="flex justify-between md:justify-start gap-2"><dt className="text-ink-muted">Emissão:</dt><dd className="font-medium">{formatarData(pedido.emitidoEm)}</dd></div>
          <div className="flex justify-between md:justify-start gap-2"><dt className="text-ink-muted">Necessário até:</dt><dd className="font-medium" data-prazo-documento>{pedido.prazoNecessario ? formatarData(pedido.prazoNecessario) : "—"}</dd></div>
          <div className="flex justify-between md:justify-start gap-2"><dt className="text-ink-muted">Origem:</dt><dd className="font-medium text-right md:text-left" data-origem-documento>{origemTxt}</dd></div>
        </dl>
      </section>

      <section className="py-5 break-inside-auto">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-2 break-after-avoid">Itens para cotação</p>
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse text-[13px] print:text-[11px] leading-snug" data-tabela-planilha data-itens-documento>
            <thead className="[display:table-header-group]">
              <tr className="bg-surface-alt border-y border-ink/15 print:[print-color-adjust:exact]">
                <th scope="col" className={cn(th, "text-right w-8")}>#</th>
                <th scope="col" className={cn(th, "text-left")}>Produto / descrição</th>
                <th scope="col" className={cn(th, "text-right w-16")}>Qtd</th>
                <th scope="col" className={cn(th, "text-left w-12")}>Un.</th>
                <th scope="col" className={cn(th, "text-left w-28")} data-coluna-fornecedor>Preço unit. (R$)</th>
                <th scope="col" className={cn(th, "text-left w-28")} data-coluna-fornecedor>Prazo entrega</th>
              </tr>
            </thead>
            <tbody>
              {pedido.itens.map((it, i) => (
                <tr key={i} className="border-b border-surface-linha even:bg-surface-alt/60 break-inside-avoid print:[print-color-adjust:exact]" data-linha-item>
                  <td className={cn(td, "text-right text-ink-subtle tabular-nums")}>{i + 1}</td>
                  <td className={cn(td, "text-ink")}>
                    {it.descricao}
                    {it.produtoNome && it.produtoNome !== it.descricao && <p className="text-[11px] print:text-[10px] text-ink-muted">{it.produtoNome}</p>}
                  </td>
                  <td className={cn(td, "text-right tabular-nums whitespace-nowrap")} data-qtd>{qtds[i]}</td>
                  <td className={cn(td, "text-ink-muted")}>{it.unidade}</td>
                  <td className={td}><span className={cn("block h-4", branco)} /></td>
                  <td className={td}><span className={cn("block h-4", branco)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 border-y border-surface-border text-sm break-inside-avoid" data-preencher-fornecedor>
        {["Validade da proposta", "Prazo de entrega", "Condição de pagamento"].map((rotulo) => (
          <div key={rotulo}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{rotulo}</p>
            <span className={cn("block h-6", branco)} />
          </div>
        ))}
      </section>

      {pedido.observacao && (
        <section className="py-4 break-inside-avoid" data-observacao-documento>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1">Observação</p>
          <p className="text-sm whitespace-pre-wrap">{pedido.observacao}</p>
        </section>
      )}

      <p className="pt-4 text-xs text-ink-muted break-inside-avoid" data-responder-para>
        Por favor, responda com o preço unitário, a validade da proposta e o prazo de entrega de cada item
        {pedido.comprador ? <> — aos cuidados de <strong className="text-ink">{pedido.comprador.nome}</strong></> : null}.
      </p>
    </div>
  );
}
