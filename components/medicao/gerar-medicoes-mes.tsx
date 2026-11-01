"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { MESES_PT } from "@/lib/utils";
import { CalendarRange, X, Check, AlertCircle } from "lucide-react";
import { anoBR, mesBR } from "@/lib/fuso";
import { Dica } from "@/components/ui/dica";

export function GerarMedicoesMes() {
  const router = useRouter();
  const agora = new Date();
  const [aberto, setAberto] = useState(false);
  const [mes, setMes] = useState(mesBR(agora));
  const [ano, setAno] = useState(anoBR(agora));
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState<{ criadas: number; ignoradas: number; foraDaVigencia: string[]; semCobrancaNoMes: string[]; peloAutomatico: string[] } | null>(null);
  const [erro, setErro] = useState("");

  async function gerar() {
    setGerando(true);
    setErro("");
    setResultado(null);
    try {
      const res = await fetch("/api/medicoes/gerar-mes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, ano }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErro(err.erro ?? "Erro ao gerar medições.");
        return;
      }
      const data = await res.json();
      setResultado({ criadas: data.criadas, ignoradas: data.ignoradas, foraDaVigencia: data.foraDaVigencia ?? [], semCobrancaNoMes: data.semCobrancaNoMes ?? [], peloAutomatico: data.peloAutomatico ?? [] });
      router.refresh();
    } catch {
      setErro("Erro de conexão.");
    } finally {
      setGerando(false);
    }
  }

  if (!aberto) {
    return (
      <Button variant="outline" onClick={() => setAberto(true)}>
        <CalendarRange className="w-4 h-4" /> Gerar medições do mês
      </Button>
    );
  }

  return (
    <div className="absolute right-0 top-full mt-2 z-20 w-80 bg-white border border-surface-border rounded-card shadow-card-hover p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-ink">Gerar medições mensais</h4>
        <button onClick={() => { setAberto(false); setResultado(null); setErro(""); }} className="text-ink-muted hover:text-ink">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-ink-muted">
        Gera medições para os clientes com contrato ativo e vigente no mês, respeitando o perfil de faturamento.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Select value={String(mes)} onChange={(e) => setMes(Number(e.target.value))}>
          {MESES_PT.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </Select>
        <Input type="number" value={ano} onChange={(e) => setAno(Number(e.target.value) || anoBR(agora))} />
      </div>

      {erro && (
        <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-xs rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {erro}
        </div>
      )}
      {resultado && (
        <div className="bg-success-50 border border-success-200 text-success-700 text-xs rounded-lg px-3 py-2 flex items-center gap-2">
          <Check className="w-3.5 h-3.5" /> {resultado.criadas} criada(s), {resultado.ignoradas} ignorada(s).
        </div>
      )}
      {resultado && resultado.foraDaVigencia.length > 0 && (
        <p data-fora-vigencia className="text-xs text-ink-muted flex items-center gap-1">
          <span>
            {resultado.foraDaVigencia.length === 1 ? "1 contrato fora da vigência" : `${resultado.foraDaVigencia.length} contratos fora da vigência`}
            {": "}{resultado.foraDaVigencia.slice(0, 3).join(", ")}{resultado.foraDaVigencia.length > 3 ? "…" : ""}
          </span>
          <Dica rotulo="Fora da vigência" lado="esquerda" texto="Contrato que só começa depois deste mês, ou que já terminou antes dele, não gera mensalidade, mesmo com status Ativo. Confira as datas de início e fim no contrato." />
        </p>
      )}

      {resultado && resultado.semCobrancaNoMes.length > 0 && (
        <p data-sem-cobranca-mes className="text-xs text-ink-muted flex items-center gap-1">
          <span>
            {resultado.semCobrancaNoMes.length === 1 ? "1 contrato sem cobrança neste mês" : `${resultado.semCobrancaNoMes.length} contratos sem cobrança neste mês`}
            {": "}{resultado.semCobrancaNoMes.slice(0, 3).join(", ")}{resultado.semCobrancaNoMes.length > 3 ? "…" : ""}
          </span>
          <Dica rotulo="Sem cobrança neste mês" lado="esquerda" texto="Contrato bimestral, trimestral, semestral ou anual só cobra no 1º mês de cada período, contado do início da vigência." />
        </p>
      )}
      {resultado && resultado.peloAutomatico.length > 0 && (
        <p data-pelo-automatico className="text-xs text-ink-muted flex items-center gap-1">
          <span>
            {resultado.peloAutomatico.length === 1 ? "1 contrato fica com o faturamento automático" : `${resultado.peloAutomatico.length} contratos ficam com o faturamento automático`}
            {": "}{resultado.peloAutomatico.slice(0, 3).join(", ")}{resultado.peloAutomatico.length > 3 ? "…" : ""}
          </span>
          <Dica rotulo="Faturamento automático" lado="esquerda" texto="Estes contratos têm a medição criada sozinha no dia de faturamento (uma por contrato). Acompanhe em Financeiro › Faturamento de contratos." />
        </p>
      )}
      <Button onClick={gerar} loading={gerando} className="w-full justify-center">
        <CalendarRange className="w-4 h-4" /> Gerar agora
      </Button>
    </div>
  );
}
