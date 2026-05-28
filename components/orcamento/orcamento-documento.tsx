import { formatarCpfCnpj, formatarData, formatarMoeda, formatarTelefone, LABELS_STATUS_ORCAMENTO, CLASSE_STATUS_ORCAMENTO, cn } from "@/lib/utils";

interface ItemDoc {
  descricao: string;
  quantidade: unknown;
  valorUnitario: unknown;
  valorTotal: unknown;
  observacao?: string | null;
}

export interface OrcamentoDocumentoProps {
  orcamento: {
    codigo: string;
    nome: string;
    status: string;
    descricao?: string | null;
    observacao?: string | null;
    validadeEm?: Date | string | null;
    criadoEm: Date | string;
    enviadoEm?: Date | string | null;
    assinadoEm?: Date | string | null;
    assinadoPor?: string | null;
    assinadoCpf?: string | null;
    assinaturaUrl?: string | null;
    totalServicos: unknown;
    totalProdutos: unknown;
    desconto: unknown;
    tipoDesconto: string;
    totalGeral: unknown;
    servicos: ItemDoc[];
    produtos: ItemDoc[];
  };
  empresa: {
    nome: string;
    nomeFantasia?: string | null;
    cnpj: string;
    email?: string | null;
    telefone?: string | null;
    celular?: string | null;
    site?: string | null;
    logo?: string | null;
    endereco?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
  };
  cliente: {
    nome: string;
    nomeFantasia?: string | null;
    cpfCnpj: string;
    email?: string | null;
    telefone?: string | null;
    endereco?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
  };
  variante?: "completa" | "compacta";
}

function n(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

function enderecoCompleto(e: OrcamentoDocumentoProps["empresa"] | OrcamentoDocumentoProps["cliente"]): string {
  const parts: string[] = [];
  if (e.endereco) parts.push(`${e.endereco}${e.numero ? `, ${e.numero}` : ""}`);
  if (e.complemento) parts.push(e.complemento);
  if (e.bairro) parts.push(e.bairro);
  if (e.cidade && e.estado) parts.push(`${e.cidade}/${e.estado}`);
  if (e.cep) parts.push(`CEP ${e.cep}`);
  return parts.join(" — ");
}

export function OrcamentoDocumento({ orcamento, empresa, cliente, variante = "completa" }: OrcamentoDocumentoProps) {
  const totalBruto = n(orcamento.totalServicos) + n(orcamento.totalProdutos);
  const desconto = n(orcamento.desconto);
  const descontoCalculado =
    orcamento.tipoDesconto === "PERCENTUAL"
      ? Math.min(totalBruto * (desconto / 100), totalBruto)
      : Math.min(desconto, totalBruto);

  return (
    <div className="bg-white">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-6 pb-6 border-b-2 border-primary-500">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          {empresa.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={empresa.logo} alt={empresa.nome} className="w-20 h-20 object-contain rounded-lg border border-surface-border" />
          ) : (
            <div className="w-20 h-20 rounded-lg bg-gradient-to-br from-primary-500 to-success-500 flex items-center justify-center text-white text-2xl font-bold">
              {empresa.nome.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink">{empresa.nomeFantasia ?? empresa.nome}</h1>
            <p className="text-xs text-ink-muted">CNPJ {formatarCpfCnpj(empresa.cnpj)}</p>
            {enderecoCompleto(empresa) && (
              <p className="text-xs text-ink-muted mt-0.5">{enderecoCompleto(empresa)}</p>
            )}
            <p className="text-xs text-ink-muted mt-0.5">
              {empresa.telefone && `Tel: ${formatarTelefone(empresa.telefone)}`}
              {empresa.email && ` · ${empresa.email}`}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs uppercase tracking-wider text-ink-muted">Orçamento</p>
          <p className="font-mono text-2xl font-bold text-primary-600">{orcamento.codigo}</p>
          <span className={cn("mt-2 inline-flex", CLASSE_STATUS_ORCAMENTO[orcamento.status])}>
            {LABELS_STATUS_ORCAMENTO[orcamento.status]}
          </span>
        </div>
      </div>

      {/* Título e datas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-5 border-b border-surface-border">
        <div className="md:col-span-2">
          <p className="text-xs uppercase tracking-wider text-ink-muted">Proposta</p>
          <p className="text-lg font-semibold text-ink">{orcamento.nome}</p>
        </div>
        <div className="text-sm space-y-1">
          <div className="flex justify-between gap-3">
            <span className="text-ink-muted">Emissão:</span>
            <span className="font-medium text-ink">{formatarData(orcamento.criadoEm)}</span>
          </div>
          {orcamento.validadeEm && (
            <div className="flex justify-between gap-3">
              <span className="text-ink-muted">Válido até:</span>
              <span className="font-medium text-ink">{formatarData(orcamento.validadeEm)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Cliente */}
      <div className="py-5 border-b border-surface-border">
        <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">Cliente</p>
        <p className="font-semibold text-ink">{cliente.nomeFantasia ?? cliente.nome}</p>
        {cliente.nomeFantasia && <p className="text-xs text-ink-muted">{cliente.nome}</p>}
        <p className="text-sm text-ink-muted">CPF/CNPJ {formatarCpfCnpj(cliente.cpfCnpj)}</p>
        {enderecoCompleto(cliente) && (
          <p className="text-sm text-ink-muted mt-1">{enderecoCompleto(cliente)}</p>
        )}
        <p className="text-sm text-ink-muted">
          {cliente.telefone && formatarTelefone(cliente.telefone)}
          {cliente.email && ` · ${cliente.email}`}
        </p>
      </div>

      {/* Descrição */}
      {orcamento.descricao && (
        <div className="py-5 border-b border-surface-border">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">Descrição</p>
          <p className="text-sm text-ink whitespace-pre-wrap">{orcamento.descricao}</p>
        </div>
      )}

      {/* Serviços */}
      {orcamento.servicos.length > 0 && (
        <div className="py-5">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-3">Serviços</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-alt border-b border-surface-border">
                <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Descrição</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase w-16">Qtd</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase w-28">Unitário</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase w-32">Total</th>
              </tr>
            </thead>
            <tbody>
              {orcamento.servicos.map((s, i) => (
                <tr key={i} className="border-b border-surface-border">
                  <td className="px-3 py-2.5 text-ink">
                    {s.descricao}
                    {s.observacao && <p className="text-xs text-ink-muted italic">{s.observacao}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-right text-ink-muted">{n(s.quantidade)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-muted">{formatarMoeda(n(s.valorUnitario))}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-ink">{formatarMoeda(n(s.valorTotal))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right font-semibold text-ink-muted">Subtotal serviços</td>
                <td className="px-3 py-2 text-right font-bold text-ink">{formatarMoeda(n(orcamento.totalServicos))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Produtos */}
      {orcamento.produtos.length > 0 && (
        <div className="py-5 border-t border-surface-border">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-3">Produtos</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-alt border-b border-surface-border">
                <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Descrição</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase w-16">Qtd</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase w-28">Unitário</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase w-32">Total</th>
              </tr>
            </thead>
            <tbody>
              {orcamento.produtos.map((p, i) => (
                <tr key={i} className="border-b border-surface-border">
                  <td className="px-3 py-2.5 text-ink">
                    {p.descricao}
                    {p.observacao && <p className="text-xs text-ink-muted italic">{p.observacao}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-right text-ink-muted">{n(p.quantidade)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-muted">{formatarMoeda(n(p.valorUnitario))}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-ink">{formatarMoeda(n(p.valorTotal))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right font-semibold text-ink-muted">Subtotal produtos</td>
                <td className="px-3 py-2 text-right font-bold text-ink">{formatarMoeda(n(orcamento.totalProdutos))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Totais */}
      <div className="py-5 border-t-2 border-primary-500 flex justify-end">
        <div className="w-full md:w-96 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Subtotal bruto</span>
            <span className="font-mono text-ink">{formatarMoeda(totalBruto)}</span>
          </div>
          {descontoCalculado > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-ink-muted">
                Desconto {orcamento.tipoDesconto === "PERCENTUAL" ? `(${desconto}%)` : ""}
              </span>
              <span className="font-mono text-red-600">- {formatarMoeda(descontoCalculado)}</span>
            </div>
          )}
          <div className="flex justify-between pt-2 border-t-2 border-success-500/40">
            <span className="text-sm font-bold uppercase tracking-wider text-ink-muted">Total geral</span>
            <span className="text-2xl font-bold text-success-700">{formatarMoeda(n(orcamento.totalGeral))}</span>
          </div>
        </div>
      </div>

      {/* Observações */}
      {orcamento.observacao && variante === "completa" && (
        <div className="py-5 border-t border-surface-border">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">Observações</p>
          <p className="text-sm text-ink whitespace-pre-wrap">{orcamento.observacao}</p>
        </div>
      )}

      {/* Bloco de assinatura */}
      {orcamento.status === "APROVADO" && orcamento.assinaturaUrl && (
        <div className="py-5 border-t-2 border-success-500">
          <p className="text-xs uppercase tracking-wider text-success-700 mb-2 font-bold">Aprovação digital</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-ink-muted">Aprovado por:</span>{" "}
                <span className="font-semibold text-ink">{orcamento.assinadoPor}</span>
              </div>
              {orcamento.assinadoCpf && (
                <div>
                  <span className="text-ink-muted">CPF:</span>{" "}
                  <span className="text-ink">{formatarCpfCnpj(orcamento.assinadoCpf)}</span>
                </div>
              )}
              {orcamento.assinadoEm && (
                <div>
                  <span className="text-ink-muted">Data:</span>{" "}
                  <span className="text-ink">{formatarData(orcamento.assinadoEm, "dd/MM/yyyy 'às' HH:mm")}</span>
                </div>
              )}
            </div>
            <div className="border-2 border-dashed border-success-500/50 rounded-lg p-2 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={orcamento.assinaturaUrl} alt="Assinatura digital" className="w-full h-24 object-contain" />
              <p className="text-center text-[10px] text-ink-subtle mt-1">Assinatura digital</p>
            </div>
          </div>
        </div>
      )}

      {/* Rodapé */}
      <div className="mt-6 pt-4 border-t border-surface-border text-center text-xs text-ink-subtle">
        <p>
          {empresa.nomeFantasia ?? empresa.nome} · CNPJ {formatarCpfCnpj(empresa.cnpj)}
          {empresa.telefone && ` · ${formatarTelefone(empresa.telefone)}`}
        </p>
        <p className="mt-1">Documento gerado em {formatarData(new Date(), "dd/MM/yyyy 'às' HH:mm")}</p>
      </div>
    </div>
  );
}
