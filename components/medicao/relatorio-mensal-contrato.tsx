import { CalendarClock, ClipboardList } from "lucide-react";
import { formatarData, formatarMoeda } from "@/lib/utils";
import type { RelatorioMensalContrato } from "@/lib/relatorio-mensal-contrato";

/**
 * D1 — bloco "o seu mês" da medição do contrato: resumo das OS do período (serviço,
 * equipamentos, quantidades, valores quando cobrados e o nº da OS para buscar no portal)
 * e a data da próxima manutenção agendada. Os relatórios completos (preventiva com fotos)
 * são embutidos pela página logo abaixo deste bloco.
 */
export function RelatorioMensalContratoResumo({ dados }: { dados: RelatorioMensalContrato }) {
  const ref = `${String(dados.mes).padStart(2, "0")}/${dados.ano}`;
  return (
    <section className="space-y-4" data-relatorio-mensal>
      <div className="flex items-center justify-between gap-3 flex-wrap pb-2 border-b border-surface-border">
        <p className="text-xs uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
          <ClipboardList className="w-4 h-4" /> Movimentação do contrato {dados.contratoNumero} — {ref}
        </p>
        {dados.valorMensal != null && (
          <p className="text-xs text-ink-muted">Mensalidade do contrato: <strong className="text-ink">{formatarMoeda(dados.valorMensal)}</strong></p>
        )}
      </div>

      {dados.ossDoMes.length === 0 ? (
        <p className="text-sm text-ink-muted">Nenhuma ordem de serviço concluída no período.</p>
      ) : (
        <div className="space-y-4">
          {dados.ossDoMes.map((os) => (
            <div key={os.numero} className="border border-surface-border rounded-lg p-4" data-os-resumo={os.numero}>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                <p className="text-sm font-bold text-ink font-mono">{os.numero}</p>
                {os.dataConclusao && <p className="text-xs text-ink-muted">Concluída em {formatarData(os.dataConclusao)}</p>}
              </div>
              {os.descricao && <p className="text-sm text-ink-muted mb-1">{os.descricao}</p>}
              {os.equipamentos.length > 0 && (
                <p className="text-xs text-ink-muted mb-2">Equipamentos: {os.equipamentos.join(" · ")}</p>
              )}
              {os.linhas.length > 0 && (
                <table className="w-full text-sm">
                  <tbody>
                    {os.linhas.map((l, i) => (
                      <tr key={i} className="border-t border-surface-border/60">
                        <td className="py-1 pr-2 text-ink">{l.descricao}</td>
                        <td className="py-1 pr-2 text-right text-ink-muted whitespace-nowrap">{l.quantidade}×</td>
                        <td className="py-1 text-right whitespace-nowrap">
                          {l.valorTotal != null
                            ? <span className="font-medium text-ink">{formatarMoeda(l.valorTotal)}</span>
                            : <span className="text-xs text-ink-subtle">incluso no contrato</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-[11px] text-ink-subtle mt-2">Acompanhe esta OS no portal pelo número {os.numero}.</p>
            </div>
          ))}
        </div>
      )}

      {dados.proximaPreventiva && (
        <div className="flex items-center gap-2 bg-primary-50 border border-primary-100 rounded-lg px-4 py-3 text-sm text-ink" data-proxima-preventiva>
          <CalendarClock className="w-4 h-4 text-primary-600 shrink-0" />
          <span>
            Próxima manutenção agendada: <strong>{formatarData(dados.proximaPreventiva.data, "dd/MM/yyyy")}</strong>
            {dados.proximaPreventiva.tipo ? ` · ${dados.proximaPreventiva.tipo}` : ""}
          </span>
        </div>
      )}
    </section>
  );
}
