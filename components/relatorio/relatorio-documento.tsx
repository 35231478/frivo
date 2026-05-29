import {
  formatarCpfCnpj, formatarData, formatarDataHora, formatarMoeda, formatarTelefone,
  nomeMes, TITULO_RELATORIO, LABELS_STATUS_RELATORIO, CLASSE_STATUS_RELATORIO,
  LABELS_TIPO_EQUIPAMENTO, cn,
} from "@/lib/utils";

interface Resposta { resposta: string | null; arquivoUrl: string | null; campo: { label: string; tipo: string } }
interface Atividade {
  id: string; titulo: string; criadoEm: Date | string; resumo: string | null;
  tecnico?: { nome: string } | null; tipoOs?: { nome: string } | null; respostas: Resposta[];
}
interface Equip { id: string; tipo: string; marca: string; modelo: string; numeroSerie: string | null; localizacao: string | null }

export interface RelatorioDocumentoProps {
  relatorio: {
    numero: string; tipo: string; status: string; mesReferencia: number; anoReferencia: number;
    valorFinanceiro: unknown; observacao: string | null; criadoEm: Date | string;
    assinadoPor?: string | null; assinadoCpf?: string | null; assinaturaUrl?: string | null; assinadoEm?: Date | string | null;
  };
  empresa: {
    nome: string; nomeFantasia?: string | null; cnpj: string; email?: string | null; telefone?: string | null;
    logo?: string | null; endereco?: string | null; numero?: string | null; complemento?: string | null;
    bairro?: string | null; cidade?: string | null; estado?: string | null; cep?: string | null;
  };
  os: {
    numero: string; descricao: string; criadoEm: Date | string; dataInicio?: Date | string | null; dataConclusao?: Date | string | null;
    cliente: {
      nome: string; nomeFantasia?: string | null; cpfCnpj: string; logo?: string | null; email?: string | null; telefone?: string | null;
      endereco?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; estado?: string | null; cep?: string | null;
    };
    contrato?: { numero: string; artNumero?: string | null; responsavelTecnico?: { nome: string; crea?: string | null } | null } | null;
    unidade?: { nome: string } | null;
    atividades: Atividade[];
  };
  equipamentos: Equip[];
}

function n(v: unknown): number { return typeof v === "number" ? v : Number(v ?? 0); }
function ehImagem(url: string | null): boolean { return !!url && /^data:image\//.test(url); }

function enderecoStr(e: any): string {
  const p: string[] = [];
  if (e.endereco) p.push(`${e.endereco}${e.numero ? `, ${e.numero}` : ""}`);
  if (e.bairro) p.push(e.bairro);
  if (e.cidade && e.estado) p.push(`${e.cidade}/${e.estado}`);
  if (e.cep) p.push(`CEP ${e.cep}`);
  return p.join(" — ");
}

export function RelatorioDocumento({ relatorio, empresa, os, equipamentos }: RelatorioDocumentoProps) {
  const tecnicosSet = new Map<string, string>();
  os.atividades.forEach((a) => { if (a.tecnico) tecnicosSet.set(a.tecnico.nome, a.tecnico.nome); });
  const equipe = [...tecnicosSet.values()];
  const tipos = [...new Set(os.atividades.map((a) => a.tipoOs?.nome).filter(Boolean))] as string[];

  return (
    <div className="bg-white text-ink">
      {/* CABEÇALHO */}
      <div className="flex items-start justify-between gap-6 pb-5 border-b-2 border-primary-500">
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
            <h1 className="text-lg font-bold text-ink">{empresa.nomeFantasia ?? empresa.nome}</h1>
            <p className="text-xs text-ink-muted">CNPJ {formatarCpfCnpj(empresa.cnpj)}</p>
            {enderecoStr(empresa) && <p className="text-xs text-ink-muted mt-0.5">{enderecoStr(empresa)}</p>}
            <p className="text-xs text-ink-muted mt-0.5">
              {empresa.telefone && `Tel: ${formatarTelefone(empresa.telefone)}`}{empresa.email && ` · ${empresa.email}`}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono text-xl font-bold text-primary-600">{relatorio.numero}</p>
          <p className="text-xs text-ink-muted">Ref.: {nomeMes(relatorio.mesReferencia)}/{relatorio.anoReferencia}</p>
          <span className={cn("mt-1 inline-flex", CLASSE_STATUS_RELATORIO[relatorio.status])}>{LABELS_STATUS_RELATORIO[relatorio.status]}</span>
        </div>
      </div>

      <h2 className="text-center text-base font-bold tracking-wide text-ink my-5">{TITULO_RELATORIO[relatorio.tipo] ?? "RELATÓRIO"}</h2>

      {/* DADOS DO CONTRATO / CLIENTE */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4 border-y border-surface-border">
        <div className="md:col-span-2 flex items-start gap-3">
          {os.cliente.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={os.cliente.logo} alt={os.cliente.nome} className="w-14 h-14 object-contain rounded border border-surface-border" />
          )}
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-muted">Cliente</p>
            <p className="font-semibold text-ink">{os.cliente.nomeFantasia ?? os.cliente.nome}</p>
            <p className="text-sm text-ink-muted">CPF/CNPJ {formatarCpfCnpj(os.cliente.cpfCnpj)}</p>
            {enderecoStr(os.cliente) && <p className="text-sm text-ink-muted">{enderecoStr(os.cliente)}</p>}
          </div>
        </div>
        <div className="text-sm space-y-1">
          {os.contrato && <div className="flex justify-between gap-2"><span className="text-ink-muted">Contrato:</span><span className="font-medium">{os.contrato.numero}</span></div>}
          {os.contrato?.artNumero && <div className="flex justify-between gap-2"><span className="text-ink-muted">ART:</span><span className="font-medium">{os.contrato.artNumero}</span></div>}
          {os.contrato?.responsavelTecnico && (
            <div className="flex justify-between gap-2"><span className="text-ink-muted">Resp. técnico:</span><span className="font-medium text-right">{os.contrato.responsavelTecnico.nome}{os.contrato.responsavelTecnico.crea ? ` (CREA ${os.contrato.responsavelTecnico.crea})` : ""}</span></div>
          )}
        </div>
      </div>

      {/* EXECUÇÃO */}
      <div className="py-4 border-b border-surface-border">
        <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">Execução</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><span className="text-ink-muted block text-xs">OS</span><span className="font-mono font-semibold">{os.numero}</span></div>
          <div><span className="text-ink-muted block text-xs">Abertura</span>{formatarData(os.criadoEm)}</div>
          <div><span className="text-ink-muted block text-xs">Conclusão</span>{os.dataConclusao ? formatarData(os.dataConclusao) : "—"}</div>
          <div><span className="text-ink-muted block text-xs">Tipo</span>{tipos.length ? tipos.join(", ") : "—"}</div>
        </div>
        {equipe.length > 0 && <p className="text-sm mt-2"><span className="text-ink-muted">Equipe:</span> {equipe.join(", ")}</p>}
        {os.descricao && <p className="text-sm mt-2 text-ink-muted whitespace-pre-wrap">{os.descricao}</p>}
      </div>

      {/* EQUIPAMENTOS ATENDIDOS */}
      {equipamentos.length > 0 && (
        <div className="py-4 border-b border-surface-border">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">Equipamentos atendidos</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-alt border-b border-surface-border">
                <th className="text-left px-2 py-1.5 font-semibold text-ink-muted text-xs uppercase">Equipamento</th>
                <th className="text-left px-2 py-1.5 font-semibold text-ink-muted text-xs uppercase">Modelo</th>
                <th className="text-left px-2 py-1.5 font-semibold text-ink-muted text-xs uppercase">Nº série</th>
                <th className="text-left px-2 py-1.5 font-semibold text-ink-muted text-xs uppercase">Localização</th>
              </tr>
            </thead>
            <tbody>
              {equipamentos.map((e) => (
                <tr key={e.id} className="border-b border-surface-border">
                  <td className="px-2 py-1.5">{LABELS_TIPO_EQUIPAMENTO[e.tipo] ?? e.tipo} — {e.marca}</td>
                  <td className="px-2 py-1.5 text-ink-muted">{e.modelo}</td>
                  <td className="px-2 py-1.5 text-ink-muted">{e.numeroSerie ?? "—"}</td>
                  <td className="px-2 py-1.5 text-ink-muted">{e.localizacao ?? os.unidade?.nome ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* RELATÓRIO TÉCNICO */}
      <div className="py-4 border-b border-surface-border">
        <p className="text-xs uppercase tracking-wider text-ink-muted mb-3">Relatório técnico</p>
        {os.atividades.length === 0 && <p className="text-sm text-ink-subtle italic">Sem atividades registradas.</p>}
        <div className="space-y-4">
          {os.atividades.map((a) => {
            const fotos = a.respostas.filter((r) => ehImagem(r.arquivoUrl));
            const textos = a.respostas.filter((r) => !ehImagem(r.arquivoUrl) && (r.resposta ?? "").trim());
            return (
              <div key={a.id} className="border border-surface-border rounded-lg p-3" style={{ breakInside: "avoid" }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="font-semibold text-ink">{a.titulo}</p>
                  <p className="text-xs text-ink-muted">{formatarDataHora(a.criadoEm)}{a.tecnico ? ` · ${a.tecnico.nome}` : ""}</p>
                </div>
                {textos.length > 0 && (
                  <div className="space-y-1 text-sm">
                    {textos.map((r, i) => (
                      <div key={i}><span className="text-ink-muted">{r.campo.label}:</span> <span className="text-ink">{r.resposta}</span></div>
                    ))}
                  </div>
                )}
                {a.resumo && textos.length === 0 && <pre className="text-sm text-ink whitespace-pre-wrap font-sans">{a.resumo}</pre>}
                {fotos.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {fotos.map((r, i) => (
                      <figure key={i} className="border border-surface-border rounded overflow-hidden" style={{ breakInside: "avoid" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.arquivoUrl!} alt={r.campo.label} className="w-full h-40 object-cover" />
                        <figcaption className="text-[10px] text-ink-muted text-center py-1 px-1 truncate">{r.campo.label}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* FINANCEIRO */}
      {n(relatorio.valorFinanceiro) > 0 && (
        <div className="py-4 border-b border-surface-border">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">Financeiro</p>
          <div className="flex justify-between max-w-xs ml-auto text-sm">
            <span className="text-ink-muted">Valor do período</span>
            <span className="font-bold text-success-700">{formatarMoeda(n(relatorio.valorFinanceiro))}</span>
          </div>
        </div>
      )}

      {relatorio.observacao && (
        <div className="py-4 border-b border-surface-border">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">Observações</p>
          <p className="text-sm whitespace-pre-wrap">{relatorio.observacao}</p>
        </div>
      )}

      {/* RODAPÉ / ASSINATURA */}
      <div className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
        <div>
          {relatorio.assinaturaUrl ? (
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={relatorio.assinaturaUrl} alt="Assinatura" className="h-20 object-contain" />
              <div className="border-t border-ink/40 pt-1 text-sm">
                <p className="font-semibold">{relatorio.assinadoPor}</p>
                {relatorio.assinadoCpf && <p className="text-xs text-ink-muted">CPF {formatarCpfCnpj(relatorio.assinadoCpf)}</p>}
                {relatorio.assinadoEm && <p className="text-xs text-ink-muted">Aprovado em {formatarData(relatorio.assinadoEm, "dd/MM/yyyy 'às' HH:mm")}</p>}
              </div>
            </div>
          ) : (
            <div className="mt-10 border-t border-ink/40 pt-1 text-sm text-center">
              <p className="text-ink-muted">{os.contrato?.responsavelTecnico?.nome ?? "Responsável técnico"}</p>
              {os.contrato?.responsavelTecnico?.crea && <p className="text-xs text-ink-muted">CREA {os.contrato.responsavelTecnico.crea}</p>}
            </div>
          )}
        </div>
        <div className="text-right text-xs text-ink-subtle">
          <p>Emitido em {formatarData(relatorio.criadoEm, "dd/MM/yyyy 'às' HH:mm")}</p>
          <p className="mt-1">{empresa.nomeFantasia ?? empresa.nome} · Documento eletrônico — Frivo</p>
        </div>
      </div>
    </div>
  );
}
