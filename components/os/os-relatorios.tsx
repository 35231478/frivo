"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn, formatarData, formatarDataHora, LABELS_STATUS_OS } from "@/lib/utils";
import {
  FileText, FileBarChart, DollarSign, Camera, ListChecks, Wrench, Users, Clock,
  CornerDownRight, ExternalLink, CalendarRange, AlertCircle,
} from "lucide-react";

interface Atividade {
  id: string; titulo: string; status: string; criadoEm: string; duracaoMin: number | null;
  tipoOsNome: string | null; tipoOsCor: string | null; tecnicoNome: string | null;
  resumo: string; fotos: number; respostas: number;
}
interface Relatorio { id: string; numero: string; escopo: string; tokenPublico: string; status: string }
interface Resumo {
  statusOs: string; totalAtividades: number; totalTecnicos: number; totalFotos: number; totalEquipamentos: number;
  periodoInicio: string | null; periodoFim: string | null; atividades: Atividade[];
}

const STATUS_ATIVIDADE: Record<string, string> = {
  AGENDADA: "bg-violet-50 text-violet-700", EM_ANDAMENTO: "bg-amber-50 text-amber-700",
  CONCLUIDA: "bg-success-50 text-success-700", CANCELADA: "bg-red-50 text-red-700",
};
const LABEL_STATUS_ATIVIDADE: Record<string, string> = {
  AGENDADA: "Agendada", EM_ANDAMENTO: "Em andamento", CONCLUIDA: "Concluída", CANCELADA: "Cancelada",
};

function duracao(min: number | null): string {
  if (!min) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

export function OsRelatorios({ osId }: { osId: string }) {
  const router = useRouter();
  const [relatorios, setRelatorios] = useState<Relatorio[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");

  function carregar() {
    fetch(`/api/ordens/${osId}/relatorios`).then((r) => r.json()).then((d) => {
      setRelatorios(Array.isArray(d.relatorios) ? d.relatorios : []);
      setResumo(d.resumo ?? null);
    }).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const geral = relatorios.find((r) => r.escopo === "GERAL");

  async function gerarMedicao() {
    setGerando(true); setErro("");
    try {
      const res = await fetch(`/api/ordens/${osId}/gerar-medicao-completa`, { method: "POST" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErro(e.erro ?? "Erro ao gerar medição."); return; }
      const data = await res.json();
      if (data.medicaoToken) window.open(`/medicao/${data.medicaoToken}`, "_blank", "noopener");
      router.refresh();
      carregar();
    } catch { setErro("Erro de conexão."); } finally { setGerando(false); }
  }

  if (loading) return <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>;
  if (!resumo) return <p className="text-sm text-ink-subtle text-center py-8">Sem dados.</p>;

  const cards = [
    { label: "Atividades", valor: resumo.totalAtividades, icone: ListChecks },
    { label: "Técnicos", valor: resumo.totalTecnicos, icone: Users },
    { label: "Fotos", valor: resumo.totalFotos, icone: Camera },
    { label: "Equipamentos", valor: resumo.totalEquipamentos, icone: Wrench },
  ];

  return (
    <div className="space-y-5">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{erro}</div>}

      {/* Resumo geral */}
      <div className="border border-surface-border rounded-xl p-4 bg-surface-alt/30">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="bg-white rounded-lg border border-surface-border p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary-50"><c.icone className="w-4 h-4 text-primary-600" /></div>
              <div>
                <p className="text-xl font-bold text-ink leading-none">{c.valor}</p>
                <p className="text-xs text-ink-muted mt-0.5">{c.label}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <div className="text-sm text-ink-muted flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <CalendarRange className="w-4 h-4" />
              {resumo.periodoInicio ? `${formatarData(resumo.periodoInicio)} → ${formatarData(resumo.periodoFim)}` : "Sem período"}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" /> Status: <span className="font-medium text-ink">{LABELS_STATUS_OS[resumo.statusOs] ?? resumo.statusOs}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {geral ? (
              <a href={`/relatorio/os/${geral.tokenPublico}`} target="_blank" rel="noopener" className="btn-secondary">
                <FileBarChart className="w-4 h-4" /> Relatório Geral
              </a>
            ) : (
              <Button variant="secondary" disabled title="Gerado automaticamente quando a OS é concluída">
                <FileBarChart className="w-4 h-4" /> Relatório Geral
              </Button>
            )}
            <Button variant="success" onClick={gerarMedicao} loading={gerando}>
              <DollarSign className="w-4 h-4" /> Gerar Medição
            </Button>
          </div>
        </div>
        {!geral && <p className="text-xs text-ink-subtle mt-2">Os relatórios são gerados automaticamente quando a OS é concluída.</p>}
      </div>

      {/* Hierarquia: relatório geral (pai) + atividades (filhos) */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="p-2 rounded-lg bg-primary-50"><FileBarChart className="w-4 h-4 text-primary-600" /></div>
          <div>
            <p className="text-sm font-bold text-ink">Relatório Geral da OS</p>
            <p className="text-xs text-ink-muted">{geral ? `${geral.numero} · consolida todas as atividades abaixo` : "Disponível após a conclusão da OS"}</p>
          </div>
        </div>

        <div className="ml-5 border-l-2 border-surface-border pl-4 space-y-3 mt-2">
          {resumo.atividades.length === 0 && (
            <p className="text-sm text-ink-subtle py-4">Nenhuma atividade nesta OS.</p>
          )}
          {resumo.atividades.map((a) => (
            <div key={a.id} className="relative">
              <CornerDownRight className="absolute -left-[26px] top-3 w-4 h-4 text-ink-subtle" />
              <div className="border border-surface-border rounded-lg p-3 bg-white hover:border-primary-200 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-ink">{a.titulo}</p>
                      {a.tipoOsNome && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: a.tipoOsCor ?? "#0EA5E9" }}>{a.tipoOsNome}</span>
                      )}
                      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", STATUS_ATIVIDADE[a.status])}>{LABEL_STATUS_ATIVIDADE[a.status] ?? a.status}</span>
                    </div>
                    <p className="text-xs text-ink-muted mt-0.5">
                      {a.tecnicoNome ?? "Sem técnico"} · {formatarDataHora(a.criadoEm)} · {duracao(a.duracaoMin)}
                    </p>
                    {a.resumo && <p className="text-sm text-ink-muted mt-1.5 line-clamp-2">{a.resumo}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-ink-muted">
                      <span className="flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> {a.fotos}</span>
                      <span className="flex items-center gap-1"><ListChecks className="w-3.5 h-3.5" /> {a.respostas} resposta(s)</span>
                    </div>
                  </div>
                  <a href={`/relatorio/atividade/${a.id}`} target="_blank" rel="noopener"
                    className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 px-2.5 py-1.5 rounded-lg">
                    <FileText className="w-3.5 h-3.5" /> Ver relatório <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
