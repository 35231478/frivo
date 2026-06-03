import {
  formatarCpfCnpj, formatarData, formatarMoeda, formatarTelefone,
  aplicarVariaveis, LABELS_PERIODICIDADE, LABELS_PERFIL_FATURAMENTO,
} from "@/lib/utils";

interface ItemDoc {
  descricao: string;
  quantidade: unknown;
  valorUnitario: unknown;
  valorTotal: unknown;
  observacao?: string | null;
}

export interface PropostaDocumentoProps {
  orcamento: {
    codigo: string;
    nome: string;
    status: string;
    descricao?: string | null;
    validadeEm?: Date | string | null;
    criadoEm: Date | string;
    assinadoEm?: Date | string | null;
    assinadoPor?: string | null;
    assinadoCpf?: string | null;
    assinaturaUrl?: string | null;
    valorMensal?: unknown;
    frequenciaContrato?: string | null;
    diaExecucao?: number | null;
    dataInicioContrato?: Date | string | null;
    vigenciaMeses?: number | null;
    dataFimContrato?: Date | string | null;
    condicaoPagamento?: string | null;
    diaFaturamento?: number | null;
    perfilFaturamento?: string | null;
    exigePcAntesNf?: boolean;
    artNumero?: string | null;
    termoReferencia?: string | null;
    visitasPorPeriodo?: number | null;
    prazoEmergencial?: number | null;
    prazoNormal?: number | null;
    horarioAtendimento?: string | null;
    servicos: ItemDoc[];
  };
  empresa: {
    nome: string;
    nomeFantasia?: string | null;
    cnpj: string;
    email?: string | null;
    telefone?: string | null;
    logo?: string | null;
    endereco?: string | null;
    numero?: string | null;
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
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
  };
  responsavelTecnico?: { nome: string; crea?: string | null } | null;
  equipamentos?: { id: string; rotulo: string }[];
}

function n(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

function endereco(e: { endereco?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; estado?: string | null; cep?: string | null }): string {
  const p: string[] = [];
  if (e.endereco) p.push(`${e.endereco}${e.numero ? `, ${e.numero}` : ""}`);
  if (e.bairro) p.push(e.bairro);
  if (e.cidade && e.estado) p.push(`${e.cidade}/${e.estado}`);
  if (e.cep) p.push(`CEP ${e.cep}`);
  return p.join(" — ");
}

const Pagina = ({ children, primeira }: { children: React.ReactNode; primeira?: boolean }) => (
  <section className="bg-white" style={primeira ? undefined : { breakBefore: "page" }}>
    {children}
  </section>
);

export function PropostaDocumento({ orcamento: o, empresa, cliente, responsavelTecnico, equipamentos = [] }: PropostaDocumentoProps) {
  const freqLabel = o.frequenciaContrato ? LABELS_PERIODICIDADE[o.frequenciaContrato] ?? o.frequenciaContrato : "—";
  const vars: Record<string, string> = {
    cliente_nome: cliente.nomeFantasia ?? cliente.nome,
    valor_mensal: formatarMoeda(n(o.valorMensal)),
    vigencia: o.vigenciaMeses ? `${o.vigenciaMeses} meses` : "—",
    frequencia: freqLabel,
    data_inicio: o.dataInicioContrato ? formatarData(o.dataInicioContrato) : "—",
    responsavel_tecnico: responsavelTecnico?.nome ?? "—",
    art_numero: o.artNumero ?? "—",
  };
  const termo = o.termoReferencia ? aplicarVariaveis(o.termoReferencia, vars) : "";

  return (
    <div className="bg-white text-ink">
      {/* PÁGINA 1 — CAPA */}
      <Pagina primeira>
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center py-16 border-b-2 border-success-500">
          <div className="flex items-center gap-8 mb-10">
            {empresa.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={empresa.logo} alt={empresa.nome} className="w-24 h-24 object-contain rounded-lg border border-surface-border" />
            ) : (
              <div className="w-24 h-24 rounded-lg bg-gradient-to-br from-primary-500 to-success-500 flex items-center justify-center text-white text-3xl font-bold">
                {empresa.nome.slice(0, 2).toUpperCase()}
              </div>
            )}
            <span className="text-2xl text-ink-subtle">×</span>
            <div className="w-24 h-24 rounded-lg border border-surface-border flex items-center justify-center text-ink-muted text-xl font-bold">
              {(cliente.nomeFantasia ?? cliente.nome).slice(0, 2).toUpperCase()}
            </div>
          </div>
          <p className="text-xs uppercase tracking-[0.3em] text-success-700 font-semibold">Proposta Comercial</p>
          <h1 className="text-3xl font-bold text-ink mt-3 max-w-xl">CONTRATO DE MANUTENÇÃO</h1>
          <p className="text-lg text-ink-muted mt-2">{o.nome}</p>
          <div className="mt-10 grid grid-cols-3 gap-8 text-sm">
            <div>
              <p className="text-ink-muted text-xs uppercase tracking-wider">Proposta nº</p>
              <p className="font-mono font-bold text-success-700 text-lg">{o.codigo}</p>
            </div>
            <div>
              <p className="text-ink-muted text-xs uppercase tracking-wider">Emissão</p>
              <p className="font-semibold">{formatarData(o.criadoEm)}</p>
            </div>
            <div>
              <p className="text-ink-muted text-xs uppercase tracking-wider">Validade</p>
              <p className="font-semibold">{o.validadeEm ? formatarData(o.validadeEm) : "—"}</p>
            </div>
          </div>
          <p className="mt-10 text-sm font-semibold text-ink">{empresa.nomeFantasia ?? empresa.nome}</p>
          <p className="text-xs text-ink-muted">CNPJ {formatarCpfCnpj(empresa.cnpj)}{empresa.telefone ? ` · ${formatarTelefone(empresa.telefone)}` : ""}</p>
        </div>
      </Pagina>

      {/* PÁGINA 2 — DADOS DA PROPOSTA */}
      <Pagina>
        <div className="py-8">
          <h2 className="text-xs uppercase tracking-wider text-ink-muted pb-2 border-b-2 border-success-500/40 mb-4">Dados da proposta</h2>
          <div className="mb-6">
            <p className="text-xs uppercase tracking-wider text-ink-muted mb-1">Contratante</p>
            <p className="font-semibold text-ink">{cliente.nomeFantasia ?? cliente.nome}</p>
            {cliente.nomeFantasia && <p className="text-xs text-ink-muted">{cliente.nome}</p>}
            <p className="text-sm text-ink-muted">CPF/CNPJ {formatarCpfCnpj(cliente.cpfCnpj)}</p>
            {endereco(cliente) && <p className="text-sm text-ink-muted">{endereco(cliente)}</p>}
            <p className="text-sm text-ink-muted">{cliente.telefone ? formatarTelefone(cliente.telefone) : ""}{cliente.email ? ` · ${cliente.email}` : ""}</p>
          </div>

          <div className="rounded-xl border-2 border-success-500/40 bg-success-50/40 p-6 text-center mb-6">
            <p className="text-xs uppercase tracking-wider text-success-700">Valor mensal</p>
            <p className="text-4xl font-bold text-success-700 mt-1">{formatarMoeda(n(o.valorMensal))}</p>
            <p className="text-xs text-ink-muted mt-1">Frequência: {freqLabel}</p>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <Linha rotulo="Vigência" valor={o.vigenciaMeses ? `${o.vigenciaMeses} meses` : "—"} />
            <Linha rotulo="Dia de execução" valor={o.diaExecucao ? `Dia ${o.diaExecucao}` : "—"} />
            <Linha rotulo="Início" valor={o.dataInicioContrato ? formatarData(o.dataInicioContrato) : "—"} />
            <Linha rotulo="Término" valor={o.dataFimContrato ? formatarData(o.dataFimContrato) : "—"} />
            <Linha rotulo="Condição de pagamento" valor={o.condicaoPagamento || "—"} />
            <Linha rotulo="Dia de faturamento" valor={o.diaFaturamento ? `Dia ${o.diaFaturamento}` : "—"} />
            <Linha rotulo="Perfil de faturamento" valor={o.perfilFaturamento ? LABELS_PERFIL_FATURAMENTO[o.perfilFaturamento] ?? o.perfilFaturamento : "—"} />
            <Linha rotulo="Exige PC antes da NF" valor={o.exigePcAntesNf ? "Sim" : "Não"} />
            {responsavelTecnico && <Linha rotulo="Responsável técnico" valor={`${responsavelTecnico.nome}${responsavelTecnico.crea ? ` — CREA ${responsavelTecnico.crea}` : ""}`} />}
            {o.artNumero && <Linha rotulo="ART nº" valor={o.artNumero} />}
          </div>
        </div>
      </Pagina>

      {/* PÁGINA 3 — ESCOPO E SLA */}
      <Pagina>
        <div className="py-8 space-y-8">
          <div>
            <h2 className="text-xs uppercase tracking-wider text-ink-muted pb-2 border-b-2 border-success-500/40 mb-4">Escopo dos serviços</h2>
            {o.servicos.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-alt border-b border-surface-border">
                    <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Serviço incluso</th>
                    <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase w-16">Qtd</th>
                  </tr>
                </thead>
                <tbody>
                  {o.servicos.map((s, i) => (
                    <tr key={i} className="border-b border-surface-border">
                      <td className="px-3 py-2.5 text-ink">{s.descricao}{s.observacao && <p className="text-xs text-ink-muted italic">{s.observacao}</p>}</td>
                      <td className="px-3 py-2.5 text-right text-ink-muted">{n(s.quantidade)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-subtle">Nenhum serviço listado.</p>
            )}
            {o.visitasPorPeriodo ? <p className="text-sm text-ink-muted mt-3">Visitas por período: <strong>{o.visitasPorPeriodo}</strong></p> : null}
          </div>

          {equipamentos.length > 0 && (
            <div>
              <h2 className="text-xs uppercase tracking-wider text-ink-muted pb-2 border-b-2 border-success-500/40 mb-3">Equipamentos cobertos</h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm text-ink">
                {equipamentos.map((e) => <li key={e.id} className="flex items-start gap-2"><span className="text-success-600">•</span> {e.rotulo}</li>)}
              </ul>
            </div>
          )}

          <div>
            <h2 className="text-xs uppercase tracking-wider text-ink-muted pb-2 border-b-2 border-success-500/40 mb-3">SLA de atendimento</h2>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <Linha rotulo="Emergencial" valor={o.prazoEmergencial != null ? `${o.prazoEmergencial}h` : "—"} />
              <Linha rotulo="Normal" valor={o.prazoNormal != null ? `${o.prazoNormal}h` : "—"} />
              <Linha rotulo="Horário" valor={o.horarioAtendimento || "—"} />
            </div>
          </div>
        </div>
      </Pagina>

      {/* PÁGINAS — TERMO DE REFERÊNCIA */}
      {termo && (
        <Pagina>
          <div className="py-8">
            <h2 className="text-xs uppercase tracking-wider text-ink-muted pb-2 border-b-2 border-success-500/40 mb-4">Termo de referência</h2>
            <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{termo}</div>
          </div>
        </Pagina>
      )}

      {/* ÚLTIMA PÁGINA — APROVAÇÃO */}
      <Pagina>
        <div className="py-8">
          <h2 className="text-xs uppercase tracking-wider text-ink-muted pb-2 border-b-2 border-success-500/40 mb-4">Aprovação</h2>
          {o.status === "APROVADO" || o.status === "CONVERTIDA" ? (
            o.assinaturaUrl ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1 text-sm">
                  <div><span className="text-ink-muted">Aprovado por:</span> <span className="font-semibold">{o.assinadoPor}</span></div>
                  {o.assinadoCpf && <div><span className="text-ink-muted">CPF:</span> {formatarCpfCnpj(o.assinadoCpf)}</div>}
                  {o.assinadoEm && <div><span className="text-ink-muted">Data:</span> {formatarData(o.assinadoEm, "dd/MM/yyyy 'às' HH:mm")}</div>}
                </div>
                <div className="border-2 border-dashed border-success-500/50 rounded-lg p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={o.assinaturaUrl} alt="Assinatura" className="w-full h-24 object-contain" />
                  <p className="text-center text-[10px] text-ink-subtle mt-1">Assinatura digital</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-success-700 font-semibold">Proposta aprovada pelo cliente.</p>
            )
          ) : (
            <div className="mt-10">
              <p className="text-sm text-ink-muted mb-10">Declaro estar de acordo com as condições desta proposta comercial:</p>
              <div className="grid grid-cols-1 gap-10 max-w-md">
                <div>
                  <div className="border-b border-ink-subtle h-10" />
                  <p className="text-xs text-ink-muted mt-1">Nome do responsável</p>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div><div className="border-b border-ink-subtle h-10" /><p className="text-xs text-ink-muted mt-1">CPF</p></div>
                  <div><div className="border-b border-ink-subtle h-10" /><p className="text-xs text-ink-muted mt-1">Data</p></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Pagina>

      <div className="mt-6 pt-4 border-t border-surface-border text-center text-xs text-ink-subtle">
        <p>{empresa.nomeFantasia ?? empresa.nome} · CNPJ {formatarCpfCnpj(empresa.cnpj)}{empresa.telefone ? ` · ${formatarTelefone(empresa.telefone)}` : ""}</p>
        <p className="mt-1">Documento gerado em {formatarData(new Date(), "dd/MM/yyyy 'às' HH:mm")}</p>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-ink-muted uppercase tracking-wider">{rotulo}</span>
      <span className="font-medium text-ink">{valor}</span>
    </div>
  );
}
