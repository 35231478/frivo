import { timbreEmpresa, type EmpresaTimbre } from "@/lib/orcamentos/proposta";
import { formatarCpfCnpj, formatarTelefone } from "@/lib/utils";

/**
 * Timbre dos documentos da empresa (orçamento, pedido de compra): logo, razão social, CNPJ/IE/IM,
 * endereço e contatos — do cadastro da empresa. À direita, o bloco do documento (número etc.).
 */
export function TimbreEmpresa({ empresa, children }: { empresa: EmpresaTimbre & { logo?: string | null }; children?: React.ReactNode }) {
  const timbre = timbreEmpresa(empresa, { doc: formatarCpfCnpj, tel: formatarTelefone });
  return (
    <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 sm:gap-6 pb-5 border-b-2 border-primary-500 break-inside-avoid" data-timbre>
      <div className="flex items-start gap-4 flex-1 min-w-0">
        {empresa.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={empresa.logo} alt={`Logo ${timbre.titulo}`} className="w-16 h-16 sm:w-20 sm:h-20 object-contain shrink-0" data-logo-empresa />
        ) : (
          <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-lg bg-acento flex items-center justify-center text-white font-display text-2xl font-bold" aria-hidden>
            {timbre.titulo.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 space-y-0.5">
          <p className="text-lg sm:text-xl font-bold text-ink leading-tight">{timbre.titulo}</p>
          {timbre.razaoSocial && <p className="text-xs text-ink-muted">{timbre.razaoSocial}</p>}
          <p className="text-xs text-ink-muted" data-timbre-documentos>{timbre.documentos}</p>
          {timbre.endereco && <p className="text-xs text-ink-muted">{timbre.endereco}</p>}
          {timbre.contato && <p className="text-xs text-ink-muted [overflow-wrap:anywhere]" data-timbre-contato>{timbre.contato}</p>}
        </div>
      </div>
      {children}
    </header>
  );
}
