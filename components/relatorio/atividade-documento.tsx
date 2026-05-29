import { formatarData } from "@/lib/utils";
import { CabecalhoEmpresa, DadosClienteContrato, EquipamentosTabela, type EmpresaInfo, type ClienteInfo, type ContratoInfo, type EquipamentoInfo } from "./cabecalho-relatorio";
import { SecaoAtividade, type AtividadeSecao } from "./secao-atividade";

export interface AtividadeDocumentoProps {
  empresa: EmpresaInfo;
  os: { numero: string; criadoEm: Date | string; dataConclusao?: Date | string | null; cliente: ClienteInfo; contrato?: ContratoInfo | null; unidade?: { nome: string } | null };
  atividade: AtividadeSecao;
  equipamentos: EquipamentoInfo[];
  numero: string;
}

export function AtividadeDocumento({ empresa, os, atividade, equipamentos, numero }: AtividadeDocumentoProps) {
  return (
    <div className="bg-white text-ink">
      <CabecalhoEmpresa empresa={empresa} titulo="RELATÓRIO DE ATIVIDADE" numero={numero} subtitulo={`Emitido em ${formatarData(new Date(), "dd/MM/yyyy")}`} />

      <DadosClienteContrato cliente={os.cliente} contrato={os.contrato} />

      <div className="py-4 border-b border-surface-border grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div><span className="text-ink-muted block text-xs">OS</span><span className="font-mono font-semibold">{os.numero}</span></div>
        <div><span className="text-ink-muted block text-xs">Abertura</span>{formatarData(os.criadoEm)}</div>
        <div><span className="text-ink-muted block text-xs">Conclusão</span>{os.dataConclusao ? formatarData(os.dataConclusao) : "—"}</div>
        <div><span className="text-ink-muted block text-xs">Unidade</span>{os.unidade?.nome ?? "—"}</div>
      </div>

      <EquipamentosTabela equipamentos={equipamentos} unidadeNome={os.unidade?.nome} />

      <div className="py-4 border-b border-surface-border">
        <p className="text-xs uppercase tracking-wider text-ink-muted mb-3">Execução técnica</p>
        <SecaoAtividade atividade={atividade} />
      </div>

      <div className="pt-10 grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="border-t border-ink/40 pt-1 text-sm text-center">
          <p className="text-ink-muted">{atividade.tecnico?.nome ?? "Técnico executor"}</p>
          <p className="text-xs text-ink-subtle">Técnico responsável</p>
        </div>
        <div className="text-right text-xs text-ink-subtle self-end">
          <p>Conclusão: {os.dataConclusao ? formatarData(os.dataConclusao, "dd/MM/yyyy 'às' HH:mm") : "—"}</p>
          <p className="mt-1">{empresa.nomeFantasia ?? empresa.nome} · Documento eletrônico — Frivo</p>
        </div>
      </div>
    </div>
  );
}
