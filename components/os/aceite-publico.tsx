"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MSG_NOME, NOME_MAX, NOME_MIN, OBSERVACAO_MAX } from "@/lib/os/aceite";

/**
 * A confirmação do cliente no link público: o nome de quem confirma e, se quiser, uma observação.
 * O servidor grava também a data, a hora e o endereço IP (o texto avisa, como na aprovação do orçamento).
 */
export function AceitePublico({ token, rotulo, nomeSugerido }: {
  token: string;
  /** De qual serviço se trata: "OS-123, concluída em 05/11/2026" */
  rotulo: string;
  nomeSugerido?: string | null;
}) {
  const router = useRouter();
  const [nome, setNome] = useState(nomeSugerido ?? "");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setErro("");
    if (nome.trim().length < NOME_MIN) return setErro(MSG_NOME);
    setEnviando(true);
    try {
      const res = await fetch(`/api/publico/aceites/${encodeURIComponent(token)}/confirmar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: nome.trim(), observacao: observacao.trim() || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErro(d.erro ?? "Não foi possível registrar a confirmação.");
        if (res.status === 409) router.refresh(); // já confirmado (ou OS reaberta): a página mostra o que vale
        return;
      }
      router.refresh();
    } catch { setErro("Erro de conexão. Tente novamente."); } finally { setEnviando(false); }
  }

  const campo = "mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10";
  return (
    <section id="confirmar" className="bg-white border-2 border-acento/40 rounded-card p-5 sm:p-6 space-y-4 shadow-card" data-aceite-publico>
      <div>
        <h2 className="text-lg font-bold text-ink flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-success-600" aria-hidden /> Confirmar o serviço</h2>
        <p className="text-sm text-ink-muted mt-1" data-aceite-rotulo>
          <span>Confirmação do recebimento do serviço da </span><strong className="text-ink">{rotulo}</strong>.
        </p>
      </div>
      {erro && (
        <p role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2 flex items-center gap-2" data-erro-aceite-publico>
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden /> {erro}
        </p>
      )}
      <label className="block">
        <span className="text-sm font-semibold text-ink">Nome completo</span>
        <input aria-label="Nome completo" value={nome} maxLength={NOME_MAX} disabled={enviando} onChange={(e) => setNome(e.target.value)} placeholder="Quem está confirmando" className={campo} />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-ink">Observação <span className="font-normal text-ink-muted">(opcional)</span></span>
        <textarea aria-label="Observação" value={observacao} maxLength={OBSERVACAO_MAX} rows={2} disabled={enviando} onChange={(e) => setObservacao(e.target.value)}
          placeholder="Algo que queira deixar registrado" className={campo} />
      </label>
      <p className="text-xs text-ink-muted" data-aviso-registro>
        Ao confirmar, registramos seu nome, a data e a hora e o endereço IP desta confirmação.
      </p>
      <Button variant="success" onClick={confirmar} loading={enviando} className="w-full justify-center text-base py-3" data-confirmar-aceite-publico>
        <CheckCircle2 className="w-5 h-5" aria-hidden /> Confirmo o recebimento do serviço
      </Button>
    </section>
  );
}
