"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Eraser, PenLine } from "lucide-react";

function mascararCpf(v: string): string {
  const n = v.replace(/\D/g, "").slice(0, 11);
  if (n.length <= 3) return n;
  if (n.length <= 6) return `${n.slice(0, 3)}.${n.slice(3)}`;
  if (n.length <= 9) return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6)}`;
  return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
}

export function AprovacaoRelatorio({ token }: { token: string }) {
  const router = useRouter();
  const sigRef = useRef<SignatureCanvas | null>(null);
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setErro("");
    if (nome.trim().length < 3) return setErro("Informe seu nome completo.");
    if (cpf.replace(/\D/g, "").length !== 11) return setErro("CPF inválido.");
    if (!sigRef.current || sigRef.current.isEmpty()) return setErro("Por favor, faça sua assinatura.");
    const dataUrl = sigRef.current.getCanvas().toDataURL("image/png");

    setEnviando(true);
    try {
      const res = await fetch(`/api/publico/relatorios/${token}/aprovar`, {
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
      <div className="bg-gradient-to-br from-primary-500 to-success-500 rounded-2xl p-6 text-center shadow-elevated">
        <h3 className="text-white text-xl font-bold mb-2">Aprovar este relatório</h3>
        <p className="text-primary-50 text-sm mb-4">Confirme a aprovação digitalmente com sua assinatura.</p>
        <button type="button" onClick={() => setAberto(true)}
          className="inline-flex items-center gap-2 bg-white text-primary-700 hover:bg-primary-50 font-bold px-6 py-3 rounded-lg transition-all shadow-sm hover:shadow-md">
          <PenLine className="w-5 h-5" /> Aprovar relatório
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border-2 border-success-500 rounded-2xl p-6 space-y-4 shadow-elevated">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-ink flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-success-600" /> Confirmar aprovação</h3>
        <button type="button" onClick={() => setAberto(false)} className="text-xs text-ink-muted hover:text-ink">cancelar</button>
      </div>
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {erro}</div>}
      <div className="space-y-3">
        <div>
          <label className="text-sm font-semibold text-ink">Nome completo</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Como aparece no seu documento" disabled={enviando}
            className="mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all" />
        </div>
        <div>
          <label className="text-sm font-semibold text-ink">CPF</label>
          <input value={cpf} onChange={(e) => setCpf(mascararCpf(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" disabled={enviando}
            className="mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-semibold text-ink">Assinatura</label>
            <button type="button" onClick={() => sigRef.current?.clear()} className="text-xs text-ink-muted hover:text-primary-600 inline-flex items-center gap-1"><Eraser className="w-3 h-3" /> Limpar</button>
          </div>
          <div className="bg-surface-alt border-2 border-dashed border-surface-border rounded-lg overflow-hidden touch-none">
            <SignatureCanvas ref={sigRef} penColor="#0F2744" canvasProps={{ className: "w-full h-40 bg-white" }} />
          </div>
          <p className="text-xs text-ink-subtle mt-1">Use o dedo (celular) ou mouse para assinar.</p>
        </div>
      </div>
      <Button variant="success" onClick={confirmar} loading={enviando} className="w-full justify-center text-base py-3">
        <CheckCircle2 className="w-5 h-5" /> Confirmar aprovação
      </Button>
    </div>
  );
}
