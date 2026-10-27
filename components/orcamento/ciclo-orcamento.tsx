import { CheckCircle2, Circle, Eye, Mail, MessageCircle, Link2, Send, XCircle, Clock, FilePen, ArrowRightLeft } from "lucide-react";
import { cn, formatarData } from "@/lib/utils";
import {
  CLASSE_ETAPA, LABELS_ETAPA, ROTULO_EVENTO, etapaCiclo, marcosCiclo, type EtapaCiclo, type OrcamentoCiclo,
} from "@/lib/orcamentos/ciclo";

export interface EventoLinha {
  id: string;
  tipo: string;
  detalhe: string | null;
  ip: string | null;
  criadoEm: Date | string;
  usuario?: { nome: string } | null;
}

/** As etapas do caminho feliz, na ordem (Recusado/Expirado/Cancelado substituem o fim). */
const TRILHA: EtapaCiclo[] = ["RASCUNHO", "ENVIADO", "VISUALIZADO", "APROVADO"];

const ICONE_EVENTO: Record<string, typeof Circle> = {
  ENVIADO: Send, ENVIADO_EMAIL: Mail, ENVIADO_WHATSAPP: MessageCircle, LINK_COPIADO: Link2,
  VISUALIZADO: Eye, APROVADO: CheckCircle2, RECUSADO: XCircle, STATUS: ArrowRightLeft,
};

/** Pílula da etapa do ciclo (lista e tela) */
export function PilulaEtapa({ etapa, desde }: { etapa: EtapaCiclo; desde?: Date | string | null }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5" data-etapa={etapa}>
      <span className={CLASSE_ETAPA[etapa]}>{LABELS_ETAPA[etapa]}</span>
      {desde && <span className="text-[11px] text-ink-subtle tabular-nums">desde {formatarData(desde, etapa === "EXPIRADO" ? "dd/MM" : "dd/MM HH:mm")}</span>}
    </span>
  );
}

/**
 * Ciclo do orçamento na tela interna: a trilha (Rascunho → Enviado → Visualizado → Aprovado, ou o
 * fim que aconteceu: Recusado/Expirado/Cancelado) com a data de cada marco, e a linha do tempo dos
 * envios e respostas (quem, quando, por qual canal, IP do cliente).
 */
export function CicloOrcamento({ orcamento, eventos, agora = new Date() }: { orcamento: OrcamentoCiclo; eventos: EventoLinha[]; agora?: Date }) {
  const etapa = etapaCiclo(orcamento, agora);
  const marcos = marcosCiclo(orcamento, agora);
  const dataDe = (e: EtapaCiclo | "CRIADO") => marcos.find((m) => m.etapa === e);
  const fim: EtapaCiclo | null = ["RECUSADO", "EXPIRADO", "CANCELADO"].includes(etapa) ? etapa : null;
  const trilha: (EtapaCiclo)[] = fim ? [...TRILHA.slice(0, 3), fim] : TRILHA;
  const indiceAtual = Math.max(0, trilha.indexOf(etapa === "CONVERTIDO" ? "APROVADO" : etapa));

  return (
    <section className="space-y-5" data-ciclo-orcamento aria-labelledby="titulo-ciclo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="titulo-ciclo" className="card-title flex items-center gap-2"><Clock className="w-4 h-4 text-primary-600" aria-hidden /> Andamento da proposta</h2>
        <PilulaEtapa etapa={etapa} />
      </div>

      <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Etapas">
        {trilha.map((e, i) => {
          const m = e === "RASCUNHO" ? dataDe("CRIADO") : dataDe(e);
          // Feito = aconteceu (tem data); etapa pulada (ex.: recusou sem abrir o link) fica sem ✓
          const feito = !!m && i <= indiceAtual;
          const atual = i === indiceAtual;
          const ruim = e === "RECUSADO" || e === "EXPIRADO" || e === "CANCELADO";
          return (
            <li
              key={e}
              className={cn(
                "rounded-lg border px-3 py-2",
                atual ? (ruim ? "border-atrasado/40 bg-atrasado-claro" : "border-acento/40 bg-acento-claro") : feito ? "border-surface-border bg-white" : "border-dashed border-surface-border bg-surface-alt/50",
              )}
              aria-current={atual ? "step" : undefined}
              data-marco={e}
            >
              <p className={cn("flex items-center gap-1.5 text-xs font-semibold", feito || atual ? "text-ink" : "text-ink-subtle")}>
                {feito ? <CheckCircle2 className={cn("w-3.5 h-3.5", ruim ? "text-atrasado" : "text-ok")} aria-hidden /> : <Circle className="w-3.5 h-3.5" aria-hidden />}
                {e === "RASCUNHO" ? "Criado" : LABELS_ETAPA[e]}
              </p>
              <p className="text-[11px] text-ink-muted tabular-nums mt-0.5">{m ? formatarData(m.em, e === "EXPIRADO" ? "dd/MM/yyyy" : "dd/MM/yyyy HH:mm") : "—"}</p>
              {m?.detalhe && <p className="text-[11px] text-ink-muted [overflow-wrap:anywhere]" data-marco-detalhe>{m.detalhe}</p>}
            </li>
          );
        })}
      </ol>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">Linha do tempo</p>
        {eventos.length === 0 ? (
          <p className="text-sm text-ink-muted" data-sem-eventos>Nenhum envio registrado ainda.</p>
        ) : (
          <ul className="space-y-2" data-linha-do-tempo>
            {eventos.map((ev) => {
              const Icone = ICONE_EVENTO[ev.tipo] ?? FilePen;
              return (
                <li key={ev.id} className="flex items-start gap-2.5 text-sm" data-evento={ev.tipo}>
                  <Icone className="w-4 h-4 mt-0.5 shrink-0 text-ink-subtle" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-ink">
                      <span className="font-medium">{ROTULO_EVENTO[ev.tipo] ?? ev.tipo}</span>
                      {ev.detalhe && <span className="text-ink-muted [overflow-wrap:anywhere]"> — {ev.detalhe}</span>}
                    </p>
                    <p className="text-xs text-ink-subtle tabular-nums">
                      {formatarData(ev.criadoEm, "dd/MM/yyyy 'às' HH:mm")}
                      {ev.usuario ? ` · ${ev.usuario.nome}` : " · cliente pelo link"}
                      {ev.ip && ` · IP ${ev.ip}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
