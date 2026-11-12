import { CheckCircle2, XCircle } from "lucide-react";
import { formatarDataHora } from "@/lib/utils";
import { acento } from "@/lib/ui/tokens";
import { textoTecnicosAtividade } from "@/lib/atividade-equipe";

export interface AtividadeSecao {
  id: string;
  titulo: string;
  criadoEm: Date | string;
  dataAgendada?: Date | string | null;
  duracaoMin?: number | null;
  observacao?: string | null;
  resumo?: string | null;
  tipoOs?: { nome: string; cor?: string | null } | null;
  tecnico?: { nome: string } | null;
  tecnicosEquipe?: { tecnico: { nome: string } }[];
  equipe?: { nome: string } | null;
  respostas: { resposta: string | null; arquivoUrl: string | null; campo: { label: string; tipo: string } }[];
}

function ehImagem(url: string | null): boolean { return !!url && /^data:image\//.test(url); }
function ehSim(v: string | null): boolean {
  return ["sim", "true", "1", "yes"].includes((v ?? "").trim().toLowerCase());
}
function duracaoTxt(min?: number | null): string {
  if (!min) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

/** Corpo de uma atividade: execução técnica + questionário + registro fotográfico. */
export function SecaoAtividade({ atividade, numero }: { atividade: AtividadeSecao; numero?: number }) {
  const fotos = atividade.respostas.filter((r) => ehImagem(r.arquivoUrl) || r.campo.tipo === "FOTO" && !!r.arquivoUrl);
  const respostas = atividade.respostas.filter((r) => !ehImagem(r.arquivoUrl) && r.campo.tipo !== "FOTO" && (r.resposta ?? "").trim());

  return (
    <div style={{ breakInside: "avoid" }}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {numero != null && <span className="w-6 h-6 rounded-full bg-acento text-white text-xs font-bold flex items-center justify-center shrink-0">{numero}</span>}
        <h3 className="font-bold text-ink">{atividade.titulo}</h3>
        {atividade.tipoOs && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-ink-muted bg-surface-page border border-surface-border"><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: atividade.tipoOs.cor ?? acento.DEFAULT }} aria-hidden />{atividade.tipoOs.nome}</span>
        )}
      </div>
      <p className="text-xs text-ink-muted mb-3">
        <span data-tecnicos-relatorio>{textoTecnicosAtividade(atividade) ?? "Sem técnico"}</span> · Início {formatarDataHora(atividade.dataAgendada ?? atividade.criadoEm)} · Duração {duracaoTxt(atividade.duracaoMin)}
      </p>

      {(atividade.observacao || atividade.resumo) && (
        <div className="mb-3">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-1">Descrição da atividade</p>
          <p className="text-sm text-ink whitespace-pre-wrap">{atividade.observacao || atividade.resumo}</p>
        </div>
      )}

      {respostas.length > 0 && (
        <div className="mb-3">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-1">Questionário</p>
          <div className="space-y-2">
            {respostas.map((r, i) => (
              <div key={i}>
                <p className="text-sm font-semibold text-ink">{r.campo.label}</p>
                {r.campo.tipo === "SIM_NAO" ? (
                  <p className="text-sm inline-flex items-center gap-1.5">{ehSim(r.resposta)
                    ? <><CheckCircle2 className="w-4 h-4 text-ok-texto" aria-hidden /> Sim</>
                    : <><XCircle className="w-4 h-4 text-atrasado-texto" aria-hidden /> Não</>}</p>
                ) : (
                  <p className="text-sm text-ink-muted whitespace-pre-wrap">{r.resposta}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {fotos.length > 0 && (
        <div className="mb-3">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-1">Registro fotográfico</p>
          <div className="grid grid-cols-2 gap-2">
            {fotos.map((r, i) => (
              <figure key={i} className="border border-surface-border rounded overflow-hidden" style={{ breakInside: "avoid" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.arquivoUrl!} alt={r.campo.label} className="w-full h-44 object-cover" />
                <figcaption className="text-[10px] text-ink-muted text-center py-1 px-1">
                  {r.campo.label} · {formatarDataHora(atividade.criadoEm)}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
