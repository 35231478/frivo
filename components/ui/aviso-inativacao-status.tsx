"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";

/**
 * Inativar pelo SELECT de status (formulário de colaborador/equipe): mostra o mesmo impacto do
 * botão Inativar (GET `${url}/impacto`) e pede o motivo, que vai junto no salvar e entra na
 * anotação — o select não pula nada do que o botão faz.
 */
export function AvisoInativacaoStatus({ url, mostrar, motivo, onMotivo }: {
  url: string; mostrar: boolean; motivo: string; onMotivo: (v: string) => void;
}) {
  const [impacto, setImpacto] = useState<{ bloqueio: string | null; avisos: string[] } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!mostrar) { setImpacto(null); return; }
    let cancelado = false;
    setCarregando(true); setErro("");
    fetch(`${url}/impacto`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => null); if (cancelado) return; if (r.ok && d) setImpacto(d); else setErro(d?.erro ?? "Não foi possível verificar os vínculos."); })
      .catch(() => { if (!cancelado) setErro("Erro de conexão."); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [url, mostrar]);

  if (!mostrar) return null;
  return (
    <div className="space-y-2" data-aviso-inativacao>
      {carregando && <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" /> Verificando vínculos…</p>}
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      {impacto?.bloqueio && (
        <p className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {impacto.bloqueio}</p>
      )}
      {!impacto?.bloqueio && !!impacto?.avisos.length && (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <p className="flex items-center gap-1.5 font-semibold"><Info className="w-4 h-4" /> Ao salvar como inativo:</p>
          <ul className="mt-1 ml-5 list-disc space-y-0.5">{impacto.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {impacto && !impacto.bloqueio && (
        <label className="block">
          <span className="block text-xs font-medium text-ink mb-1">Motivo da inativação (opcional — fica registrado nas observações)</span>
          <textarea value={motivo} onChange={(e) => onMotivo(e.target.value)} rows={2} maxLength={500}
            className="w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 resize-none" />
        </label>
      )}
    </div>
  );
}
