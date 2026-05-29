import {
  formatarCpfCnpj, formatarData, formatarMoeda, formatarTelefone,
  LABELS_STATUS_MEDICAO, CLASSE_STATUS_MEDICAO, LABELS_TIPO_MEDICAO, nomeMes, cn,
} from "@/lib/utils";

interface ItemDoc {
  descricao: string;
  quantidade: unknown;
  valorUnitario: unknown;
  valorTotal: unknown;
  observacao?: string | null;
}

export interface MedicaoDocumentoProps {
  medicao: {
    numero: string;
    tipo: string;
    status: string;
    mes?: number | null;
    ano?: number | null;
    descricao?: string | null;
    observacao?: string | null;
    criadoEm: Date | string;
    dataVencimento?: Date | string | null;
    valorTotal: unknown;
    descontoValor: unknown;
    descontoPercent: unknown;
    valorLiquido: unknown;
    assinadoPor?: string | null;
    assinadoCpf?: string | null;
    assinaturaUrl?: string | null;
    dataAprovacao?: Date | string | null;
    nfNumero?: string | null;
    itens: ItemDoc[];
  };
  empresa: {
    nome: string;
    nomeFantasia?: string | null;
    cnpj: string;
    email?: string | null;
    telefone?: string | null;
    endereco?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
    logo?: string | null;
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
}

function n(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

function endereco(e: MedicaoDocumentoProps["empresa"] | MedicaoDocumentoProps["cliente"]): string {
  const parts: string[] = [];
  if (e.endereco) parts.push(`${e.endereco}${e.numero ? `, ${e.numero}` : ""}`);
  if (e.complemento) parts.push(e.complemento);
  if (e.bairro) parts.push(e.bairro);
  if (e.cidade && e.estado) parts.push(`${e.cidade}/${e.estado}`);
  if (e.cep) parts.push(`CEP ${e.cep}`);
  return parts.join(" — ");
}

export function MedicaoDocumento({ medicao, empresa, cliente }: MedicaoDocumentoProps) {
  const desconto = Math.min(
    n(medicao.valorTotal),
    n(medicao.descontoValor) + n(medicao.valorTotal) * (n(medicao.descontoPercent) / 100),
  );

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
            {endereco(empresa) && <p className="text-xs text-ink-muted mt-0.5">{endereco(empresa)}</p>}
            <p className="text-xs text-ink-muted mt-0.5">
              {empresa.telefone && `Tel: ${formatarTelefone(empresa.telefone)}`}
              {empresa.email && ` · ${empresa.email}`}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs uppercase tracking-wider text-ink-muted">Medição</p>
          <p className="font-mono text-2xl font-bold text-primary-600">{medicao.numero}</p>
          <span className={cn("mt-2 inline-flex", CLASSE_STATUS_MEDICAO[medicao.status])}>
            {LABELS_STATUS_MEDICAO[medicao.status]}
          </span>
        </div>
      </div>

      {/* Referência */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-5 border-b border-surface-border">
        <div className="md:col-span-2">
          <p className="text-xs uppercase tracking-wider text-ink-muted">Tipo</p>
          <p className="text-lg font-semibold text-ink">{LABELS_TIPO_MEDICAO[medicao.tipo] ?? medicao.tipo}</p>
          {medicao.descricao && <p className="text-sm text-ink-muted mt-0.5">{medicao.descricao}</p>}
        </div>
        <div className="text-sm space-y-1">
          {medicao.mes && (
            <div className="flex justify-between gap-3">
              <span className="text-ink-muted">Referência:</span>
              <span className="font-medium text-ink">{nomeMes(medicao.mes)}/{medicao.ano}</span>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <span className="text-ink-muted">Emissão:</span>
            <span className="font-medium text-ink">{formatarData(medicao.criadoEm)}</span>
          </div>
          {medicao.dataVencimento && (
            <div className="flex justify-between gap-3">
              <span className="text-ink-muted">Vencimento:</span>
              <span className="font-medium text-ink">{formatarData(medicao.dataVencimento)}</span>
            </div>
          )}
          {medicao.nfNumero && (
            <div className="flex justify-between gap-3">
              <span className="text-ink-muted">NF:</span>
              <span className="font-medium text-ink">{medicao.nfNumero}</span>
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
        {endereco(cliente) && <p className="text-sm text-ink-muted mt-1">{endereco(cliente)}</p>}
        <p className="text-sm text-ink-muted">
          {cliente.telefone && formatarTelefone(cliente.telefone)}
          {cliente.email && ` · ${cliente.email}`}
        </p>
      </div>

      {/* Itens */}
      <div className="py-5">
        <p className="text-xs uppercase tracking-wider text-ink-muted mb-3">Itens</p>
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
            {medicao.itens.map((it, i) => (
              <tr key={i} className="border-b border-surface-border">
                <td className="px-3 py-2.5 text-ink">
                  {it.descricao}
                  {it.observacao && <p className="text-xs text-ink-muted italic">{it.observacao}</p>}
                </td>
                <td className="px-3 py-2.5 text-right text-ink-muted">{n(it.quantidade)}</td>
                <td className="px-3 py-2.5 text-right text-ink-muted">{formatarMoeda(n(it.valorUnitario))}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-ink">{formatarMoeda(n(it.valorTotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totais */}
      <div className="py-5 border-t-2 border-primary-500 flex justify-end">
        <div className="w-full md:w-96 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Valor bruto</span>
            <span className="font-mono text-ink">{formatarMoeda(n(medicao.valorTotal))}</span>
          </div>
          {desconto > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-ink-muted">Desconto</span>
              <span className="font-mono text-red-600">- {formatarMoeda(desconto)}</span>
            </div>
          )}
          <div className="flex justify-between pt-2 border-t-2 border-success-500/40">
            <span className="text-sm font-bold uppercase tracking-wider text-ink-muted">Valor líquido</span>
            <span className="text-2xl font-bold text-success-700">{formatarMoeda(n(medicao.valorLiquido))}</span>
          </div>
        </div>
      </div>

      {/* Observações */}
      {medicao.observacao && (
        <div className="py-5 border-t border-surface-border">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">Observações</p>
          <p className="text-sm text-ink whitespace-pre-wrap">{medicao.observacao}</p>
        </div>
      )}

      {/* Aprovação digital */}
      {medicao.assinaturaUrl && (
        <div className="py-5 border-t-2 border-success-500">
          <p className="text-xs uppercase tracking-wider text-success-700 mb-2 font-bold">Aprovação digital</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1 text-sm">
              <div><span className="text-ink-muted">Aprovado por:</span> <span className="font-semibold text-ink">{medicao.assinadoPor}</span></div>
              {medicao.assinadoCpf && <div><span className="text-ink-muted">CPF:</span> <span className="text-ink">{formatarCpfCnpj(medicao.assinadoCpf)}</span></div>}
              {medicao.dataAprovacao && <div><span className="text-ink-muted">Data:</span> <span className="text-ink">{formatarData(medicao.dataAprovacao, "dd/MM/yyyy 'às' HH:mm")}</span></div>}
            </div>
            <div className="border-2 border-dashed border-success-500/50 rounded-lg p-2 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={medicao.assinaturaUrl} alt="Assinatura digital" className="w-full h-24 object-contain" />
              <p className="text-center text-[10px] text-ink-subtle mt-1">Assinatura digital</p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-surface-border text-center text-xs text-ink-subtle">
        <p>
          {empresa.nomeFantasia ?? empresa.nome} · CNPJ {formatarCpfCnpj(empresa.cnpj)}
          {empresa.telefone && ` · ${formatarTelefone(empresa.telefone)}`}
        </p>
        <p className="mt-1">Documento eletrônico — Frivo</p>
      </div>
    </div>
  );
}
