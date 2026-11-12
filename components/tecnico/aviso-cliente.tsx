"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/avisos";
import { useTecnico } from "@/components/tecnico/contexto";
import { MSG_SEM_ESPACO } from "@/lib/tecnico/offline/armazenamento";
import { chaveDiaBR } from "@/lib/fuso";
import { EVENTOS_AVISO, avisoDoDia, linkWhatsappAviso, rotuloAviso, type AvisoTela, type EventoAviso, type TomAviso } from "@/lib/tecnico/aviso-cliente";
import type { ExecucaoTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

const TOM: Record<TomAviso, string> = {
  ok: "bg-success-50 border-success-200 text-success-800",
  espera: "bg-atencao-claro border-atencao/20 text-atencao-texto",
  neutro: "bg-surface-alt border-surface-border text-ink-muted",
};
const NO_WHATSAPP: Record<EventoAviso, string> = { A_CAMINHO: "a caminho", CHEGOU: "chegada" };

/** O relógio da tela: os textos mudam com o tempo ("aviso a enviar" deixa de valer; o dia vira). */
export function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 30_000); return () => clearInterval(t); }, []);
  return agora;
}

/**
 * O TOQUE de "A caminho" / "Cheguei" — o gatilho fica no card da OS (Meu dia / Agenda); a regra é a de
 * sempre: o toque registra o horário na OS e o cliente recebe um e-mail curto (se houver sinal na
 * hora). Um toque de cada por dia. Sem sinal, o horário fica no aparelho e sobe depois; o aviso só
 * sai se o sinal voltar dentro da janela. Devolve true quando o aparelho guardou o toque.
 */
export function useToqueAviso(atividadeId: string) {
  const { motor, config, estado } = useTecnico();
  const [tocando, setTocando] = useState<EventoAviso | null>(null);
  // Dois toques no mesmo instante (antes de a tela redesenhar) contam como um só — por dia: o app
  // que ficou aberto de um dia para o outro volta a aceitar o toque
  const tocados = useRef(new Set<string>());
  const semSinal = estado.situacao === "offline" || (typeof navigator !== "undefined" && navigator.onLine === false);

  const tocar = useCallback(async (evento: EventoAviso): Promise<boolean> => {
    const marca = `${evento}|${chaveDiaBR(Date.now())}`;
    if (!motor || tocados.current.has(marca)) return false;
    tocados.current.add(marca);
    setTocando(evento);
    try {
      await motor.registrar([{ tipo: "avisoCliente", atividadeId, dados: { evento } }]);
      if (semSinal && config.avisarCliente) toast("Horário registrado no aparelho. Sem sinal, o aviso só sai se ele voltar logo.", "info");
      return true;
    } catch {
      // O aparelho não guardou (sem espaço, armazenamento bloqueado): o botão volta a valer
      tocados.current.delete(marca);
      toast(MSG_SEM_ESPACO, "erro");
      return false;
    } finally {
      setTocando(null);
    }
  }, [motor, atividadeId, semSinal, config.avisarCliente]);

  return { tocar, tocando, semSinal };
}

/** O link que abre o WhatsApp do técnico com a mensagem pronta (o sistema não envia WhatsApp sozinho). */
export function useWhatsappAviso(aviso: { empresa: string; whatsapp: string | null } | null | undefined, evento: EventoAviso | null): string | null {
  const { config } = useTecnico();
  if (!evento || !aviso || !config.avisarCliente || !config.exibirContatosCliente) return null;
  return linkWhatsappAviso(aviso.whatsapp, evento, aviso.empresa);
}

/** O registro de um toque já feito: o evento e "avisado às 14:02" (ou o horário e por que não avisou). Só leitura. */
export function RegistroAviso({ evento, aviso, agora, className }: { evento: EventoAviso; aviso: AvisoTela; agora: number; className?: string }) {
  const { config } = useTecnico();
  const rotulo = rotuloAviso(evento, aviso, agora, config.avisarCliente);
  return (
    <p role="status" aria-label={rotulo.texto} data-aviso={evento} data-aviso-feito={aviso.status ?? "no-aparelho"}
      className={cn("rounded-card border px-3 py-2 inline-flex items-center gap-2 min-w-0", TOM[rotulo.tom], className)}>
      {rotulo.tom === "ok" ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <Clock className="w-5 h-5 shrink-0" />}
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">{rotulo.titulo}</span>
        <span className="block text-xs leading-tight">{rotulo.detalhe}</span>
      </span>
    </p>
  );
}

/**
 * Dentro da OS o técnico JÁ CHEGOU (é o "Cheguei" do card que abre a porta): aqui não há botão, só o
 * registro de hoje — "A caminho" (se tocou) e "Cheguei", com o horário e o que aconteceu com o aviso —
 * e o toque que abre o WhatsApp com a mensagem pronta (com "Exibir contatos do cliente" ligado).
 * OS que continua de outro dia, sem toque hoje: nada aparece.
 */
export function ChegadaNaOs({ r, x }: { r: RetratoAtividade; x: ExecucaoTela }) {
  const agora = useAgora();
  const feitos = EVENTOS_AVISO.flatMap((evento) => { const a = avisoDoDia(x.avisos, evento, agora); return a ? [{ evento, a }] : []; });
  const ultimo = feitos.length ? feitos[feitos.length - 1].evento : null;
  const whatsapp = useWhatsappAviso(r.avisoCliente, ultimo);
  // Atividade encerrada (só leitura): o registro fica no histórico da OS, não aqui
  if (x.bloqueada || !feitos.length) return null;
  return (
    <section className="space-y-2" aria-label="Chegada" data-aviso-cliente>
      <div className={cn("grid gap-2", feitos.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
        {feitos.map(({ evento, a }) => <RegistroAviso key={evento} evento={evento} aviso={a} agora={agora} />)}
      </div>
      {whatsapp && (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" data-aviso-whatsapp={ultimo}
          className="w-full rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target">
          <MessageCircle className="w-5 h-5" /> Avisar pelo WhatsApp ({NO_WHATSAPP[ultimo!]})
        </a>
      )}
    </section>
  );
}
