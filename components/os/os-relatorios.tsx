"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { cn, formatarData, formatarMoeda, nomeMes, MESES_PT, LABELS_TIPO_RELATORIO, LABELS_STATUS_RELATORIO, CLASSE_STATUS_RELATORIO } from "@/lib/utils";
import { FileText, Plus, X, ExternalLink, Printer, AlertCircle } from "lucide-react";

interface Relatorio {
  id: string; numero: string; tipo: string; status: string; mesReferencia: number; anoReferencia: number;
  valorFinanceiro: string | null; tokenPublico: string;
}

export function OsRelatorios({ osId, contratoId, concluida }: { osId: string; contratoId?: string | null; concluida: boolean }) {
  const agora = new Date();
  const [relatorios, setRelatorios] = useState<Relatorio[]>([]);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const [tipo, setTipo] = useState("PMOC");
  const [mes, setMes] = useState(agora.getMonth() + 1);
  const [ano, setAno] = useState(agora.getFullYear());
  const [valor, setValor] = useState("");
  const [observacao, setObservacao] = useState("");

  function carregar() {
    fetch(`/api/ordens/${osId}/relatorios`).then((r) => r.json()).then((d) => setRelatorios(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
    if (contratoId) {
      fetch(`/api/contratos/${contratoId}`).then((r) => r.json()).then((c) => {
        if (c?.valorMensal) setValor(String(Number(c.valorMensal)));
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function gerar() {
    setErro("");
    setSalvando(true);
    try {
      const res = await fetch(`/api/ordens/${osId}/relatorios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, mesReferencia: mes, anoReferencia: ano, valorFinanceiro: valor === "" ? null : Number(valor), observacao: observacao.trim() || null }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErro(e.erro ?? "Erro ao gerar."); return; }
      const novo = await res.json();
      setRelatorios((p) => [novo, ...p]);
      setAberto(false);
      setObservacao("");
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-title flex items-center gap-2"><FileText className="w-4 h-4 text-primary-600" /> Relatórios / Medição</h3>
        {!aberto && (
          <Button variant="outline" size="sm" onClick={() => setAberto(true)} disabled={!concluida} title={concluida ? "" : "Disponível para OS concluída"}>
            <Plus className="w-4 h-4" /> Gerar Relatório/Medição
          </Button>
        )}
      </div>
      {!concluida && <p className="text-xs text-ink-muted -mt-2">A geração de relatório fica disponível quando a OS está concluída.</p>}

      {aberto && (
        <div className="border border-primary-200 bg-primary-50/30 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-primary-700">Novo relatório</h4>
            <button onClick={() => setAberto(false)} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
          </div>
          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{erro}</div>}
          <FormGrid cols={3}>
            <FormField label="Tipo de relatório">
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {Object.entries(LABELS_TIPO_RELATORIO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </FormField>
            <FormField label="Mês de referência">
              <Select value={String(mes)} onChange={(e) => setMes(Number(e.target.value))}>
                {MESES_PT.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </Select>
            </FormField>
            <FormField label="Ano">
              <Input type="number" value={ano} onChange={(e) => setAno(Number(e.target.value) || agora.getFullYear())} />
            </FormField>
          </FormGrid>
          <FormField label="Valor financeiro (R$)" hint="Preenchido com o valor do contrato quando disponível">
            <Input type="number" step="0.01" min="0" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
          </FormField>
          <FormField label="Observações adicionais"><Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} /></FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button loading={salvando} onClick={gerar}><FileText className="w-4 h-4" /> Gerar relatório</Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-subtle text-center py-6">Carregando…</p>
      ) : relatorios.length === 0 ? (
        <p className="text-sm text-ink-subtle text-center py-6">Nenhum relatório gerado para esta OS.</p>
      ) : (
        <div className="divide-y divide-surface-border border border-surface-border rounded-lg">
          {relatorios.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2.5 gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold text-primary-600">{r.numero}</p>
                <p className="text-xs text-ink-muted">
                  {LABELS_TIPO_RELATORIO[r.tipo]} · {nomeMes(r.mesReferencia)}/{r.anoReferencia}
                  {r.valorFinanceiro ? ` · ${formatarMoeda(Number(r.valorFinanceiro))}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={CLASSE_STATUS_RELATORIO[r.status]}>{LABELS_STATUS_RELATORIO[r.status]}</span>
                <a href={`/relatorio/${r.tokenPublico}`} target="_blank" rel="noopener" className="p-1.5 text-ink-muted hover:text-primary-600 hover:bg-primary-50 rounded" title="Abrir página do cliente"><ExternalLink className="w-4 h-4" /></a>
                <a href={`/relatorio/${r.tokenPublico}/imprimir`} target="_blank" rel="noopener" className="p-1.5 text-ink-muted hover:text-primary-600 hover:bg-primary-50 rounded" title="Imprimir / PDF"><Printer className="w-4 h-4" /></a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
