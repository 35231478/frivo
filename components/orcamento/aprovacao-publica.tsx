"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Eraser, PenLine } from "lucide-react";
import { neutro } from "@/lib/ui/tokens";

function mascararCpf(v: string): string {
  const n = v.replace(/\D/g, "").slice(0, 11);
  if (n.length <= 3) return n;
  if (n.length <= 6) return `${n.slice(0, 3)}.${n.slice(3)}`;
  if (n.length <= 9) return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6)}`;
  return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
}

/**
 * Aceite no link público: nome, CPF e assinatura. O servidor grava também data/hora e IP (o texto
 * avisa). `onRecusar` mostra, ao lado, o caminho para recusar com motivo (RecusaPublica).
 */
export function AprovacaoPublica({ token, onRecusar }: { token: string; onRecusar?: () => void }) {
  const router = useRouter();
  const sigRef = useRef<SignatureCanvas | null>(null);
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  function limparAssinatura() {
    sigRef.current?.clear();
  }

  async function confirmar() {
    setErro("");
    if (nome.trim().length < 3) return setErro("Informe seu nome completo.");
    if (cpf.replace(/\D/g, "").length !== 11) return setErro("CPF inválido.");
    if (!sigRef.current || sigRef.current.isEmpty()) {
      return setErro("Por favor, faça sua assinatura.");
    }
    const dataUrl = sigRef.current.getCanvas().toDataURL("image/png");

    setEnviando(true);
    try {
      const res = await fetch(`/api/publico/orcamentos/${token}/aprovar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), cpf, assinaturaUrl: dataUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErro(err.erro ?? "Não foi possível registrar a aprovação.");
        return;
      }
      router.refresh();
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="bg-white border border-surface-border rounded-card p-6 text-center shadow-card" data-resposta-publica>
        <h3 className="font-display text-ink text-xl font-bold mb-2">Responder esta proposta</h3>
        <p className="text-ink-muted text-sm mb-4">
          Aprove com sua assinatura digital ou, se não for seguir, recuse e conte o motivo.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-acento text-white hover:bg-acento-hover font-bold px-6 py-3 rounded-lg transition-colors"
            data-abrir-aprovacao
          >
            <PenLine className="w-5 h-5" />
            Aprovar proposta
          </button>
          {onRecusar && (
            <button
              type="button"
              onClick={onRecusar}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-surface-border text-ink hover:bg-surface-alt font-semibold px-6 py-3 rounded-lg transition-colors"
              data-abrir-recusa
            >
              Recusar
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-acento/40 rounded-card p-6 space-y-4 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-ink flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-success-600" />
          Confirmar aprovação
        </h3>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="text-xs text-ink-muted hover:text-ink"
        >
          cancelar
        </button>
      </div>

      {erro && (
        <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {erro}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-sm font-semibold text-ink">Nome completo</label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Como aparece no seu documento"
            className="mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
            disabled={enviando}
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-ink">CPF</label>
          <input
            value={cpf}
            onChange={(e) => setCpf(mascararCpf(e.target.value))}
            placeholder="000.000.000-00"
            inputMode="numeric"
            className="mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
            disabled={enviando}
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-semibold text-ink">Assinatura</label>
            <button
              type="button"
              onClick={limparAssinatura}
              className="text-xs text-ink-muted hover:text-primary-600 inline-flex items-center gap-1"
            >
              <Eraser className="w-3 h-3" /> Limpar
            </button>
          </div>
          <div className="bg-surface-alt border-2 border-dashed border-surface-border rounded-lg overflow-hidden touch-none">
            <SignatureCanvas
              ref={sigRef}
              penColor={neutro.texto}
              canvasProps={{
                className: "w-full h-40 bg-white",
              }}
            />
          </div>
          <p className="text-xs text-ink-subtle mt-1">Use o dedo (celular) ou mouse para assinar.</p>
        </div>
      </div>

      <p className="text-xs text-ink-muted" data-aviso-registro>
        Ao confirmar, registramos seu nome, CPF, a data e a hora e o endereço IP desta aprovação.
      </p>

      <Button
        variant="success"
        onClick={confirmar}
        loading={enviando}
        className="w-full justify-center text-base py-3"
      >
        <CheckCircle2 className="w-5 h-5" /> Confirmar aprovação
      </Button>
    </div>
  );
}
