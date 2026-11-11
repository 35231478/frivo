"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, MapPin, MessageCircle, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/avisos";
import { useTecnico } from "@/components/tecnico/contexto";
import { EVENTOS_AVISO, avisoDoDia, linkWhatsappAviso, rotuloAviso, type EventoAviso, type TomAviso } from "@/lib/tecnico/aviso-cliente";
import type { ExecucaoTela, NovaOperacao, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

const ICONE: Record<EventoAviso, typeof MapPin> = { A_CAMINHO: Navigation, CHEGOU: MapPin };
const ROTULO: Record<EventoAviso, string> = { A_CAMINHO: "A caminho", CHEGOU: "Cheguei" };
const TOM: Record<TomAviso, string> = {
  ok: "bg-success-50 border-success-200 text-success-800",
  espera: "bg-atencao-claro border-atencao/20 text-atencao-texto",
  neutro: "bg-surface-alt border-surface-border text-ink-muted",
};
const NO_WHATSAPP: Record<EventoAviso, string> = { A_CAMINHO: "a caminho", CHEGOU: "chegada" };

/**
 * "A caminho" e "Cheguei", antes do atendimento: o toque registra o horário na OS e o cliente recebe
 * um e-mail curto (se houver sinal na hora). Um toque de cada por dia: depois dele, o botão vira o
 * registro ("avisado às 14:02"). Sem integração de WhatsApp no sistema, um toque abre o WhatsApp do
 * técnico com a mensagem pronta — só com "Exibir contatos do cliente" ligado.
 * "Avisar o cliente" desligado em Equipes › App do colaborador: nada disto aparece.
 */
export function AvisoClienteOs({ r, x, registrar }: { r: RetratoAtividade; x: ExecucaoTela; registrar: (ops: NovaOperacao[]) => Promise<void> }) {
  const { config, estado } = useTecnico();
  const [agora, setAgora] = useState(() => Date.now());
  const [tocando, setTocando] = useState<EventoAviso | null>(null);
  // O texto muda com o tempo ("aviso a enviar" deixa de valer quando a janela passa)
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 30_000); return () => clearInterval(t); }, []);

  if (!config.avisarCliente || !r.avisoCliente || x.bloqueada) return null;
  const feito = { A_CAMINHO: avisoDoDia(x.avisos, "A_CAMINHO", agora), CHEGOU: avisoDoDia(x.avisos, "CHEGOU", agora) };
  // Já chegou: "A caminho" não faz mais sentido (se não foi tocado, sai da tela)
  const eventos = EVENTOS_AVISO.filter((e) => feito[e] || !(e === "A_CAMINHO" && feito.CHEGOU));
  const semSinal = estado.situacao === "offline" || (typeof navigator !== "undefined" && navigator.onLine === false);
  const ultimo: EventoAviso | null = feito.CHEGOU ? "CHEGOU" : feito.A_CAMINHO ? "A_CAMINHO" : null;
  const whatsapp = ultimo && config.exibirContatosCliente ? linkWhatsappAviso(r.avisoCliente.whatsapp, ultimo, r.avisoCliente.empresa) : null;

  async function tocar(evento: EventoAviso) {
    if (tocando || feito[evento]) return;
    setTocando(evento);
    try {
      await registrar([{ tipo: "avisoCliente", atividadeId: x.atividade.id, dados: { evento } }]);
      setAgora(Date.now());
      if (semSinal) toast("Horário registrado no aparelho. Sem sinal, o aviso só sai se ele voltar logo.", "info");
    } catch { /* o aparelho não guardou: o aviso de falta de espaço já apareceu */ } finally {
      setTocando(null);
    }
  }

  return (
    <section className="space-y-2" aria-label="Aviso ao cliente" data-aviso-cliente>
      <div className={cn("grid gap-2", eventos.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
        {eventos.map((evento) => {
          const a = feito[evento];
          const Icone = ICONE[evento];
          if (a) {
            const rotulo = rotuloAviso(evento, a, agora);
            return (
              <button key={evento} type="button" disabled aria-label={rotulo.texto} data-aviso={evento} data-aviso-feito={a.status ?? "no-aparelho"}
                className={cn("rounded-card border px-3 py-2 text-left inline-flex items-center gap-2 touch-target", TOM[rotulo.tom])}>
                {rotulo.tom === "ok" ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <Clock className="w-5 h-5 shrink-0" />}
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">{rotulo.titulo}</span>
                  <span className="block text-xs leading-tight">{rotulo.detalhe}</span>
                </span>
              </button>
            );
          }
          return (
            <button key={evento} type="button" onClick={() => tocar(evento)} disabled={!!tocando} data-aviso={evento}
              className="rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target disabled:opacity-60">
              <Icone className="w-5 h-5" /> {ROTULO[evento]}
            </button>
          );
        })}
      </div>
      {whatsapp && (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" data-aviso-whatsapp={ultimo}
          className="w-full rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target">
          <MessageCircle className="w-5 h-5" /> Avisar pelo WhatsApp ({NO_WHATSAPP[ultimo!]})
        </a>
      )}
      <p className="text-xs text-ink-muted" data-aviso-dica>
        {semSinal ? "Sem sinal: o horário fica registrado; o aviso só sai se o sinal voltar em 5 min." : "Avisa o cliente por e-mail e registra o horário na OS."}
      </p>
    </section>
  );
}
