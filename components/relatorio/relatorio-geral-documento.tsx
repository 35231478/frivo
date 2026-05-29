import { formatarData, nomeMes, TITULO_RELATORIO } from "@/lib/utils";
import { CabecalhoEmpresa, DadosClienteContrato, EquipamentosTabela, type EmpresaInfo, type ClienteInfo, type ContratoInfo, type EquipamentoInfo } from "./cabecalho-relatorio";
import { SecaoAtividade, type AtividadeSecao } from "./secao-atividade";

export interface RelatorioGeralDocumentoProps {
  relatorio: { numero: string; tipo: string; mesReferencia: number; anoReferencia: number; observacao?: string | null; criadoEm: Date | string; assinadoPor?: string | null; assinaturaUrl?: string | null; assinadoEm?: Date | string | null };
  empresa: EmpresaInfo;
  os: { numero: string; criadoEm: Date | string; dataConclusao?: Date | string | null; observacoes?: string | null; cliente: ClienteInfo; contrato?: ContratoInfo | null; unidade?: { nome: string } | null; atividades: AtividadeSecao[] };
  equipamentos: EquipamentoInfo[];
}

function duracaoTotal(ativs: AtividadeSecao[]): number {
  return ativs.reduce((acc, a) => acc + (a.duracaoMin ?? 0), 0);
}

export function RelatorioGeralDocumento({ relatorio, empresa, os, equipamentos }: RelatorioGeralDocumentoProps) {
  const tecnicos = [...new Set(os.atividades.map((a) => a.tecnico?.nome).filter(Boolean))] as string[];
  const datas = os.atividades.map((a) => new Date(a.criadoEm).getTime());
  const periodoIni = datas.length ? new Date(Math.min(...datas)) : null;
  const periodoFim = datas.length ? new Date(Math.max(...datas)) : null;
  const totalMin = duracaoTotal(os.atividades);
  const horas = Math.round((totalMin / 60) * 10) / 10;

  return (
    <div className="bg-white text-ink">
      {/* PÁGINA 1 — CAPA / RESUMO */}
      <CabecalhoEmpresa empresa={empresa} titulo={TITULO_RELATORIO[relatorio.tipo] ?? "RELATÓRIO DE MANUTENÇÃO"} numero={relatorio.numero} subtitulo={`Ref.: ${nomeMes(relatorio.mesReferencia)}/${relatorio.anoReferencia}`} />

      <DadosClienteContrato cliente={os.cliente} contrato={os.contrato} />

      <div className="py-4 border-b border-surface-border">
        <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">Resumo executivo</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><span className="text-2xl font-bold text-primary-600">{equipamentos.length}</span><p className="text-xs text-ink-muted">equipamentos</p></div>
          <div><span className="text-2xl font-bold text-primary-600">{os.atividades.length}</span><p className="text-xs text-ink-muted">atividades</p></div>
          <div><span className="text-2xl font-bold text-primary-600">{horas}</span><p className="text-xs text-ink-muted">horas de trabalho</p></div>
          <div><span className="text-2xl font-bold text-primary-600">{tecnicos.length}</span><p className="text-xs text-ink-muted">técnicos</p></div>
        </div>
        <div className="mt-3 text-sm space-y-1">
          <p><span className="text-ink-muted">Período de execução:</span> {periodoIni ? `${formatarData(periodoIni)} → ${formatarData(periodoFim)}` : "—"}</p>
          {tecnicos.length > 0 && <p><span className="text-ink-muted">Equipe:</span> {tecnicos.join(", ")}</p>}
          <p><span className="text-ink-muted">OS:</span> <span className="font-mono">{os.numero}</span></p>
        </div>
      </div>

      <EquipamentosTabela equipamentos={equipamentos} unidadeNome={os.unidade?.nome} />

      {/* PÁGINAS SEGUINTES — UMA SEÇÃO POR ATIVIDADE */}
      {os.atividades.map((a, i) => (
        <div key={a.id} className="py-5 border-b border-surface-border" style={{ breakInside: "avoid", breakBefore: i === 0 ? "auto" : "page" }}>
          <SecaoAtividade atividade={a} numero={i + 1} />
        </div>
      ))}

      {/* ÚLTIMA PÁGINA — FECHAMENTO */}
      <div className="py-5" style={{ breakBefore: "page" }}>
        <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">Observações gerais</p>
        <p className="text-sm text-ink whitespace-pre-wrap min-h-[40px]">{os.observacoes || relatorio.observacao || "—"}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mt-16">
          <div>
            {relatorio.assinaturaUrl ? (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={relatorio.assinaturaUrl} alt="Assinatura" className="h-16 object-contain" />
                <div className="border-t border-ink/40 pt-1 text-sm"><p className="font-semibold">{relatorio.assinadoPor}</p></div>
              </div>
            ) : (
              <div className="border-t border-ink/40 pt-1 text-sm text-center">
                <p className="text-ink-muted">{os.contrato?.responsavelTecnico?.nome ?? "Responsável técnico"}</p>
                {os.contrato?.responsavelTecnico?.crea && <p className="text-xs text-ink-subtle">CREA {os.contrato.responsavelTecnico.crea}</p>}
              </div>
            )}
          </div>
          <div className="border-t border-ink/40 pt-1 text-sm text-center">
            <p className="text-ink-muted">{os.cliente.nomeFantasia ?? os.cliente.nome}</p>
            <p className="text-xs text-ink-subtle">Cliente</p>
          </div>
        </div>

        <p className="text-right text-xs text-ink-subtle mt-8">
          Conclusão: {os.dataConclusao ? formatarData(os.dataConclusao, "dd/MM/yyyy 'às' HH:mm") : "—"} · {empresa.nomeFantasia ?? empresa.nome} · Frivo
        </p>
      </div>
    </div>
  );
}
