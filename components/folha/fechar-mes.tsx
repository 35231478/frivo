"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2 } from "lucide-react";

/** Grava (ou refaz) a foto do custo de pessoal do mês: o histórico não muda com reajustes futuros. */
export function FecharMes({ competencia, rotulo, jaFechado }: { competencia: string; rotulo: string; jaFechado: boolean }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function fechar() {
    const pergunta = jaFechado
      ? `O mês de ${rotulo} já foi fechado. Refazer a foto com os dados de agora? A foto anterior deste mês será substituída.`
      : `Fechar ${rotulo}? Isso grava o custo de cada colaborador neste mês, para o histórico não mudar quando salários ou encargos mudarem depois.`;
    if (!window.confirm(pergunta)) return;
    setEnviando(true); setMsg(null);
    try {
      const r = await fetch("/api/folha/fechar-mes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ competencia }) });
      const d = await r.json().catch(() => ({}));
      setMsg(r.ok ? { ok: true, texto: `Mês fechado (${d.colaboradores} colaboradores)` } : { ok: false, texto: d.erro ?? "Não foi possível fechar o mês." });
      if (r.ok) router.refresh();
    } catch {
      setMsg({ ok: false, texto: "Erro de conexão." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className={msg.ok ? "flex items-center gap-1 text-xs text-success-600" : "text-xs text-red-600"}>{msg.ok && <Check className="w-3.5 h-3.5" />}{msg.texto}</span>}
      <button type="button" onClick={fechar} disabled={enviando} data-acao="fechar-mes"
        className="btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-60">
        {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
        {jaFechado ? "Refazer fechamento" : "Fechar mês"}
      </button>
    </div>
  );
}
