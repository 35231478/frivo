"use client";

import { useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { AlertCircle, CheckCircle2, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { neutro } from "@/lib/ui/tokens";
import { MSG_ASSINATURA, MSG_NOME, NOME_MAX, NOME_MIN, aceiteLocalSchema, type AceiteLocal } from "@/lib/os/aceite";

/**
 * Aceite NO LOCAL: o responsável do cliente informa o nome e assina no quadro, na tela de quem está
 * com ele (o app do técnico ou o escritório). `aoConfirmar` devolve a mensagem de erro, ou null se gravou.
 */
export function AssinaturaDoCliente({ resumo, aoConfirmar, aoCancelar }: {
  /** De qual serviço se trata, para quem assina ler antes ("OS-123 · Hospital Santa Clara") */
  resumo: string;
  aoConfirmar: (dados: AceiteLocal) => Promise<string | null>;
  aoCancelar: () => void;
}) {
  const quadro = useRef<SignatureCanvas | null>(null);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setErro("");
    if (nome.trim().length < NOME_MIN) return setErro(MSG_NOME);
    if (!quadro.current || quadro.current.isEmpty()) return setErro(MSG_ASSINATURA);
    const dados = aceiteLocalSchema.safeParse({ nome, assinatura: quadro.current.getCanvas().toDataURL("image/png") });
    if (!dados.success) return setErro(dados.error.issues[0]?.message ?? MSG_ASSINATURA);
    setEnviando(true);
    try {
      const falha = await aoConfirmar(dados.data);
      if (falha) setErro(falha);
    } catch { setErro("Não foi possível gravar a assinatura. Tente de novo."); } finally { setEnviando(false); }
  }

  return (
    <div className="space-y-4" data-assinatura-cliente>
      <p className="text-sm text-ink" data-resumo-aceite>
        <span>Confirmo que o serviço foi realizado: </span><strong>{resumo}</strong>.
      </p>
      {erro && (
        <p role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2 flex items-center gap-2" data-erro-aceite>
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden /> {erro}
        </p>
      )}
      <label className="block">
        <span className="text-sm font-semibold text-ink">Nome de quem recebeu o serviço</span>
        <input aria-label="Nome de quem recebeu o serviço" value={nome} maxLength={NOME_MAX} disabled={enviando} onChange={(e) => setNome(e.target.value)}
          placeholder="Nome completo" autoComplete="off"
          className="mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-3 text-base text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10" />
      </label>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-ink">Assinatura</span>
          <button type="button" onClick={() => quadro.current?.clear()} className="text-xs text-ink-muted hover:text-primary-600 inline-flex items-center gap-1 py-1" data-limpar-assinatura>
            <Eraser className="w-3 h-3" aria-hidden /> Limpar
          </button>
        </div>
        <div className="bg-surface-alt border-2 border-dashed border-surface-border rounded-lg overflow-hidden touch-none">
          <SignatureCanvas ref={quadro} penColor={neutro.texto} canvasProps={{ className: "w-full h-44 bg-white", "aria-label": "Quadro de assinatura" } as React.CanvasHTMLAttributes<HTMLCanvasElement>} />
        </div>
        <p className="text-xs text-ink-subtle mt-1">Assine com o dedo, dentro do quadro.</p>
      </div>
      <p className="text-xs text-ink-muted" data-aviso-registro>
        <span>Ficam registrados o nome, a assinatura, a data e a hora. </span>
        <span>A confirmação entra no relatório da OS.</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={aoCancelar} disabled={enviando} className="py-3">Cancelar</Button>
        <Button type="button" variant="success" onClick={confirmar} loading={enviando} className="py-3" data-confirmar-aceite>
          <CheckCircle2 className="w-5 h-5" aria-hidden /> Confirmar
        </Button>
      </div>
    </div>
  );
}
