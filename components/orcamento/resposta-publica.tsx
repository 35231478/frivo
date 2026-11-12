"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AprovacaoPublica } from "@/components/orcamento/aprovacao-publica";
import { cn } from "@/lib/utils";
import { MOTIVO_RECUSA_MAX, MOTIVO_RECUSA_MIN, MOTIVOS_RECUSA } from "@/lib/orcamentos/ciclo";

const campo = "mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

/** Resposta do cliente no link público: aprovar (assinatura) ou recusar (nome + motivo). */
export function RespostaPublica({ token }: { token: string }) {
  const [recusando, setRecusando] = useState(false);
  if (recusando) return <RecusaPublica token={token} onVoltar={() => setRecusando(false)} />;
  return <AprovacaoPublica token={token} onRecusar={() => setRecusando(true)} />;
}

export function RecusaPublica({ token, onVoltar }: { token: string; onVoltar: () => void }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setErro("");
    if (nome.trim().length < 3) return setErro("Informe seu nome.");
    if (motivo.trim().length < MOTIVO_RECUSA_MIN) return setErro("Conte o motivo da recusa (pode escolher um abaixo).");
    setEnviando(true);
    try {
      const res = await fetch(`/api/publico/orcamentos/${token}/recusar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), motivo: motivo.trim() }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setErro(e.erro ?? "Não foi possível registrar a recusa.");
        return;
      }
      router.refresh();
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="bg-white border border-surface-border rounded-card p-6 space-y-4 shadow-card" data-form-recusa>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-ink flex items-center gap-2">
          <XCircle className="w-5 h-5 text-atrasado" aria-hidden /> Recusar a proposta
        </h3>
        <button type="button" onClick={onVoltar} className="text-xs text-ink-muted hover:text-ink">voltar</button>
      </div>
      {erro && (
        <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2 flex items-center gap-2" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden /> {erro}
        </div>
      )}
      <div>
        <label htmlFor="recusa-nome" className="text-sm font-semibold text-ink">Seu nome</label>
        <input id="recusa-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} className={campo} disabled={enviando} data-recusa-nome />
      </div>
      <div>
        <label htmlFor="recusa-motivo" className="text-sm font-semibold text-ink">Motivo</label>
        <div className="flex flex-wrap gap-1.5 mt-1.5" role="group" aria-label="Motivos rápidos">
          {MOTIVOS_RECUSA.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMotivo(m)}
              className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", motivo === m ? "border-acento bg-acento-claro text-acento" : "border-surface-border text-ink-muted hover:border-acento hover:text-acento")}
              data-motivo-rapido={m}
            >
              {m}
            </button>
          ))}
        </div>
        <textarea id="recusa-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={MOTIVO_RECUSA_MAX} className={campo} placeholder="Conte o que não atendeu (ajuda a empresa a melhorar a proposta)" disabled={enviando} data-recusa-motivo />
      </div>
      <p className="text-xs text-ink-muted">Ao confirmar, registramos seu nome, a data e a hora e o endereço IP desta resposta.</p>
      <Button variant="danger" onClick={confirmar} loading={enviando} className="w-full justify-center" data-confirmar-recusa>
        Confirmar recusa
      </Button>
    </div>
  );
}
