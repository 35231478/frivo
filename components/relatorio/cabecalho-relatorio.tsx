import { formatarCpfCnpj, formatarTelefone } from "@/lib/utils";
import { ambienteEquipamento, descricaoEquipamento, fabricanteModelo } from "@/lib/equipamento-descricao";

export interface EmpresaInfo {
  nome: string; nomeFantasia?: string | null; cnpj: string; email?: string | null; telefone?: string | null;
  logo?: string | null; endereco?: string | null; numero?: string | null; complemento?: string | null;
  bairro?: string | null; cidade?: string | null; estado?: string | null; cep?: string | null;
}
export interface ClienteInfo {
  nome: string; nomeFantasia?: string | null; cpfCnpj: string; logo?: string | null;
  endereco?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; estado?: string | null; cep?: string | null;
}
export interface ContratoInfo {
  numero: string; artNumero?: string | null; responsavelTecnico?: { nome: string; crea?: string | null } | null;
}

export function enderecoStr(e: { endereco?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; estado?: string | null; cep?: string | null }): string {
  const p: string[] = [];
  if (e.endereco) p.push(`${e.endereco}${e.numero ? `, ${e.numero}` : ""}`);
  if (e.bairro) p.push(e.bairro);
  if (e.cidade && e.estado) p.push(`${e.cidade}/${e.estado}`);
  if (e.cep) p.push(`CEP ${e.cep}`);
  return p.join(" — ");
}

export function CabecalhoEmpresa({ empresa, titulo, numero, subtitulo }: { empresa: EmpresaInfo; titulo: string; numero: string; subtitulo?: string }) {
  return (
    <>
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
          <p className="font-mono text-xl font-bold text-primary-600">{numero}</p>
          {subtitulo && <p className="text-xs text-ink-muted">{subtitulo}</p>}
        </div>
      </div>
      <h2 className="text-center text-base font-bold tracking-wide text-ink my-5">{titulo}</h2>
    </>
  );
}

export function DadosClienteContrato({ cliente, contrato }: { cliente: ClienteInfo; contrato?: ContratoInfo | null }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4 border-y border-surface-border">
      <div className="md:col-span-2 flex items-start gap-3">
        {cliente.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cliente.logo} alt={cliente.nome} className="w-14 h-14 object-contain rounded border border-surface-border" />
        )}
        <div>
          <p className="text-xs uppercase tracking-wider text-ink-muted">Cliente</p>
          <p className="font-semibold text-ink">{cliente.nomeFantasia ?? cliente.nome}</p>
          <p className="text-sm text-ink-muted">CPF/CNPJ {formatarCpfCnpj(cliente.cpfCnpj)}</p>
          {enderecoStr(cliente) && <p className="text-sm text-ink-muted">{enderecoStr(cliente)}</p>}
        </div>
      </div>
      <div className="text-sm space-y-1">
        {contrato && <div className="flex justify-between gap-2"><span className="text-ink-muted">Contrato:</span><span className="font-medium">{contrato.numero}</span></div>}
        {contrato?.artNumero && <div className="flex justify-between gap-2"><span className="text-ink-muted">ART:</span><span className="font-medium">{contrato.artNumero}</span></div>}
        {contrato?.responsavelTecnico && (
          <div className="flex justify-between gap-2"><span className="text-ink-muted">Resp. técnico:</span><span className="font-medium text-right">{contrato.responsavelTecnico.nome}{contrato.responsavelTecnico.crea ? ` (CREA ${contrato.responsavelTecnico.crea})` : ""}</span></div>
        )}
      </div>
    </div>
  );
}

export interface EquipamentoInfo {
  id: string; tipo: string; marca: string; modelo: string; numeroSerie: string | null; localizacao: string | null;
  setor?: string | null; capacidade?: string | null; patrimonio?: string | null; nome?: string | null;
  tipoEquipamento?: { nome: string } | null;
}

/**
 * Equipamentos do relatório da OS: AMBIENTE e EQUIPAMENTO em colunas separadas
 * (antes o nome da sala se misturava ao do equipamento). Ex.:
 *   Ambiente: Recepção (2º andar) · Equipamento: Split Piso Teto — 48.000 BTU/h
 * Ordenado por setor/ambiente, para o cliente percorrer o prédio sala a sala.
 */
export function EquipamentosTabela({ equipamentos, unidadeNome, titulo = "Equipamentos atendidos" }: { equipamentos: EquipamentoInfo[]; unidadeNome?: string | null; titulo?: string }) {
  if (equipamentos.length === 0) return null;
  const linhas = equipamentos
    .map((e) => ({ e, amb: ambienteEquipamento(e, unidadeNome) }))
    .sort((a, b) => `${a.e.setor ?? ""}|${a.amb.principal ?? ""}`.localeCompare(`${b.e.setor ?? ""}|${b.amb.principal ?? ""}`, "pt-BR"));
  return (
    <div className="py-4 border-b border-surface-border" data-equipamentos-relatorio>
      <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">{titulo}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-alt border-b border-surface-border">
            <th className="text-left px-2 py-1.5 font-semibold text-ink-muted text-xs uppercase w-[34%]">Ambiente / local</th>
            <th className="text-left px-2 py-1.5 font-semibold text-ink-muted text-xs uppercase">Equipamento</th>
            <th className="text-left px-2 py-1.5 font-semibold text-ink-muted text-xs uppercase w-[22%]">Identificação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(({ e, amb }) => (
            <tr key={e.id} className="border-b border-surface-border align-top" data-equip-linha>
              <td className="px-2 py-2">
                <p className={amb.informado ? "font-semibold text-ink" : "text-ink-muted"} data-ambiente>{amb.principal ?? "—"}</p>
                {amb.complemento && <p className={amb.informado ? "text-xs text-ink-muted" : "text-xs text-ink-subtle italic"}>{amb.complemento}</p>}
              </td>
              <td className="px-2 py-2">
                <p className="font-semibold text-ink" data-equipamento>{descricaoEquipamento(e)}</p>
                <p className="text-xs text-ink-muted">{[e.nome, fabricanteModelo(e)].filter(Boolean).join(" · ")}</p>
              </td>
              <td className="px-2 py-2 text-xs text-ink-muted">
                {e.patrimonio && <p>TAG: <span className="font-mono text-ink">{e.patrimonio}</span></p>}
                <p>Nº série: <span className="font-mono text-ink">{e.numeroSerie ?? "—"}</span></p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
