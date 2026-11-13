"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AvaliacaoDoCliente } from "@/components/os/avaliacao-cliente";
import { MSG_NOME, MSG_RESSALVA, NOME_MAX, NOME_MIN, RESSALVA_MAX, RESSALVA_MIN } from "@/lib/os/aceite";

/**
 * A confirmação do cliente no link público. Dois caminhos, os dois com o nome de quem confirma:
 *  - "Confirmo o recebimento do serviço";
 *  - "Tenho uma ressalva": o serviço fica confirmado do mesmo jeito, mas o cliente escreve o que ficou
 *    pendente ou diferente do combinado — fica no registro e a empresa é avisada.
 * Quando a empresa pede (`pedirAvaliacao`), os dois caminhos levam junto a AVALIAÇÃO do serviço — de 1
 * a 5 estrelas, com comentário — sempre opcional: sem tocar nas estrelas, confirma do mesmo jeito.
 * O servidor grava também a data, a hora e o endereço IP (o texto avisa, como na aprovação do orçamento).
 */
export function AceitePublico({ token, rotulo, nomeSugerido, pedirAvaliacao = false }: {
  token: string;
  /** De qual serviço se trata: "OS-123, concluída em 05/11/2026" */
  rotulo: string;
  nomeSugerido?: string | null;
  /** A empresa pede a avaliação do cliente (opção "Pedir avaliação do cliente") */
  pedirAvaliacao?: boolean;
}) {
  const router = useRouter();
  const [nome, setNome] = useState(nomeSugerido ?? "");
  const [comRessalva, setComRessalva] = useState(false);
  const [ressalva, setRessalva] = useState("");
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setErro("");
    if (nome.trim().length < NOME_MIN) return setErro(MSG_NOME);
    if (comRessalva && ressalva.trim().length < RESSALVA_MIN) return setErro(MSG_RESSALVA);
    setEnviando(true);
    try {
      const res = await fetch(`/api/publico/aceites/${encodeURIComponent(token)}/confirmar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          nome: nome.trim(), ressalva: comRessalva ? ressalva.trim() : null,
          ...(pedirAvaliacao && { avaliacao: nota, avaliacaoComentario: nota ? comentario.trim() || null : null }),
        }),
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
    <section id="confirmar" className="bg-white border-2 border-acento/40 rounded-card p-5 sm:p-6 space-y-4 shadow-card" data-aceite-publico={comRessalva ? "RESSALVA" : "CONFIRMAR"}>
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
        <input aria-label="Nome completo" value={nome} maxLength={NOME_MAX} disabled={enviando} onChange={(e) => { setNome(e.target.value); setErro(""); }} placeholder="Quem está confirmando" className={campo} />
      </label>
      {comRessalva && (
        <div className="bg-atencao-claro border border-atencao/30 rounded-lg p-3 space-y-2" data-ressalva-campo>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Qual é a ressalva?</span>
            <textarea aria-label="Ressalva" value={ressalva} maxLength={RESSALVA_MAX} rows={3} disabled={enviando} autoFocus onChange={(e) => { setRessalva(e.target.value); setErro(""); }}
              placeholder="O que ficou pendente ou diferente do combinado" className={campo} />
          </label>
          <p className="text-xs text-ink" data-ressalva-explica>
            <span>O serviço fica confirmado e a ressalva segue junto. </span>
            <span>A empresa é avisada na hora.</span>
          </p>
        </div>
      )}
      {pedirAvaliacao && <AvaliacaoDoCliente nota={nota} comentario={comentario} aoMudarNota={setNota} aoMudarComentario={setComentario} desabilitado={enviando} />}
      <p className="text-xs text-ink-muted" data-aviso-registro>
        Ao confirmar, registramos seu nome, a data e a hora e o endereço IP desta confirmação.
      </p>
      {comRessalva ? (
        <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
          <Button variant="secondary" onClick={() => { setComRessalva(false); setErro(""); }} disabled={enviando} className="justify-center py-3" data-ressalva-voltar>Voltar</Button>
          <Button onClick={confirmar} loading={enviando} className="w-full justify-center text-base py-3" data-confirmar-com-ressalva>
            <MessageSquareWarning className="w-5 h-5" aria-hidden /> Confirmar com ressalva
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Button variant="success" onClick={confirmar} loading={enviando} className="w-full justify-center text-base py-3" data-confirmar-aceite-publico>
            <CheckCircle2 className="w-5 h-5" aria-hidden /> Confirmo o recebimento do serviço
          </Button>
          <Button variant="secondary" onClick={() => { setComRessalva(true); setErro(""); }} disabled={enviando} className="w-full justify-center py-3" data-tenho-ressalva>
            <MessageSquareWarning className="w-5 h-5" aria-hidden /> Tenho uma ressalva
          </Button>
        </div>
      )}
    </section>
  );
}
