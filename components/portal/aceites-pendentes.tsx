import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { caminhoPublicoAceite, rotuloDaPendencia, tituloDasPendencias, type PendenciaAceite } from "@/lib/os/aceite";

/**
 * Portal do cliente: os serviços concluídos que ainda esperam a confirmação dele, em destaque, com
 * o botão de confirmar ao lado de cada um. `obrigatorio`: a empresa pede a confirmação antes de um
 * novo chamado (o texto avisa; a saída de emergência fica no formulário do chamado).
 */
export function AceitesPendentes({ pendencias, obrigatorio = false }: { pendencias: PendenciaAceite[]; obrigatorio?: boolean }) {
  if (!pendencias.length) return null;
  return (
    <section className="bg-atencao-claro border border-atencao/30 rounded-card p-4 sm:p-5 space-y-3" data-aceites-pendentes={pendencias.length} aria-label="Serviços aguardando confirmação">
      <div>
        <h2 className="text-base font-bold text-atencao-texto flex items-center gap-2"><ClipboardCheck className="w-5 h-5" aria-hidden /> {tituloDasPendencias(pendencias.length)}</h2>
        <p className="text-sm text-ink mt-0.5" data-aceites-texto>
          {obrigatorio ? "Confirme os serviços abaixo antes de abrir um novo chamado." : "Leva menos de um minuto: veja o relatório e confirme o recebimento."}
        </p>
      </div>
      <ul className="space-y-2">
        {pendencias.map((p) => (
          <li key={p.osId} className="bg-white border border-surface-border rounded-lg px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap" data-aceite-pendente={p.osId}>
            <span className="text-sm font-medium text-ink min-w-0 break-words">{rotuloDaPendencia(p)}</span>
            <Link href={caminhoPublicoAceite(p.token)} data-confirmar-pendente
              className="inline-flex items-center gap-1.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold px-3 py-2 rounded-lg shrink-0">
              Ver e confirmar
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
