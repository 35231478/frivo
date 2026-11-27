import { formatarData } from "@/lib/utils";

/** "2", "1,5", "0,25" */
const quantidadeTexto = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
import { CabecalhoEmpresa, DadosClienteContrato, type EmpresaInfo, type ClienteInfo, type ContratoInfo } from "./cabecalho-relatorio";
import { SecaoAtividade, type AtividadeSecao } from "./secao-atividade";
import { BlocosEquipamentos, SecaoAdicionais, SecaoFotosServico } from "./relatorio-os-documento";
import type { AdicionalRelatorio, BlocoEquipamento, FotoRelatorio } from "@/lib/relatorio-os/dados";

export interface MaterialRelatorio { id: string; descricao: string; quantidade: number; unidade: string; equipamento: string | null }
export interface AceiteRelatorio { nome: string | null; assinatura: string | null; confirmadoEm: Date | string | null; noLocal: boolean }

export interface AtividadeDocumentoProps {
  empresa: EmpresaInfo;
  os: { numero: string; criadoEm: Date | string; dataConclusao?: Date | string | null; cliente: ClienteInfo; contrato?: ContratoInfo | null; unidade?: { nome: string } | null };
  atividade: AtividadeSecao;
  /** SÓ os equipamentos atendidos nesta atividade (cada um com checklist, fotos e observação dele) */
  equipamentos: BlocoEquipamento[];
  /** Serviços adicionais pedidos na visita (destacados) */
  adicionais?: AdicionalRelatorio[];
  /** Fotos do serviço (app) que não são de um equipamento atendido */
  fotosServico?: FotoRelatorio[];
  numero: string;
  /** Materiais usados em campo nesta atividade (sem valores) */
  materiais?: MaterialRelatorio[];
  /** O aceite do cliente na OS, quando já confirmou (com a assinatura colhida no local) */
  aceite?: AceiteRelatorio | null;
}

export function AtividadeDocumento({ empresa, os, atividade, equipamentos, adicionais = [], fotosServico = [], numero, materiais = [], aceite = null }: AtividadeDocumentoProps) {
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

      <BlocosEquipamentos blocos={equipamentos} />
      <SecaoAdicionais adicionais={adicionais} fotos interna={false} />
      <SecaoFotosServico fotos={fotosServico} />

      {materiais.length > 0 && (
        <div className="py-4 border-b border-surface-border" data-secao-materiais>
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">Materiais usados</p>
          <ul className="divide-y divide-dashed divide-surface-border/80 text-sm">
            {materiais.map((m) => (
              <li key={m.id} className="py-1 flex items-start justify-between gap-3" data-material-relatorio>
                <span className="text-ink">{m.descricao}{m.equipamento && <span className="text-ink-muted"> · {m.equipamento}</span>}</span>
                <span className="shrink-0 font-semibold text-ink tabular-nums">{quantidadeTexto(m.quantidade)} {m.unidade}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="py-4 border-b border-surface-border">
        <p className="text-xs uppercase tracking-wider text-ink-muted mb-3">Execução técnica</p>
        <SecaoAtividade atividade={atividade} />
      </div>

      <div className={`pt-10 grid grid-cols-1 gap-8 ${aceite ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        <div className="border-t border-ink/40 pt-1 text-sm text-center">
          <p className="text-ink-muted">{atividade.tecnico?.nome ?? "Técnico executor"}</p>
          <p className="text-xs text-ink-subtle">Técnico responsável</p>
          {(atividade.tecnicosEquipe?.length ?? 0) > 0 && (
            <p data-membros-relatorio className="text-xs text-ink-subtle mt-1">
              {atividade.equipe ? `Equipe ${atividade.equipe.nome}: ` : "Com: "}{atividade.tecnicosEquipe!.map((t) => t.tecnico.nome).join(", ")}
            </p>
          )}
        </div>
        {aceite && (
          <div className="text-sm text-center" data-aceite-atividade>
            {aceite.assinatura && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={aceite.assinatura} alt={`Assinatura de ${aceite.nome ?? "cliente"}`} className="h-16 max-w-[14rem] mx-auto object-contain" data-assinatura-atividade />
            )}
            <div className="border-t border-ink/40 pt-1">
              <p className="text-ink-muted">{aceite.nome ?? "Cliente"}</p>
              <p className="text-xs text-ink-subtle">Cliente · {aceite.noLocal ? "assinou no local" : "confirmou pelo link"}{aceite.confirmadoEm ? ` em ${formatarData(aceite.confirmadoEm, "dd/MM/yyyy 'às' HH:mm")}` : ""}</p>
            </div>
          </div>
        )}
        <div className="text-right text-xs text-ink-subtle self-end">
          <p>Conclusão: {os.dataConclusao ? formatarData(os.dataConclusao, "dd/MM/yyyy 'às' HH:mm") : "—"}</p>
          <p className="mt-1">{empresa.nomeFantasia ?? empresa.nome} · Documento eletrônico — Frivo</p>
        </div>
      </div>
    </div>
  );
}
