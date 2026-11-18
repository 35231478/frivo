"use client";

import { Headset } from "lucide-react";
import { Card, CardTitulo } from "@/components/ui/card";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { useAgoraNoNavegador } from "@/lib/ui/use-agora";
import { LABELS_PRIORIDADE, formatarDataHora } from "@/lib/utils";
import {
  alertaDoAtendimento, atendimentoDaOs, temPrazoDeAtendimento, textoAtendimento, type PrazoAtendimento, type SituacaoAtendimento,
} from "@/lib/atendimento/prazo";

/** A cor diz o estado: neutro com folga (ou sem registro), âmbar perto de vencer, vermelho estourado, verde cumprido no prazo */
export const TOM_ATENDIMENTO: Record<SituacaoAtendimento, TomStatus> = {
  SEM_PRAZO: "previsto", NO_PRAZO: "previsto", VENCENDO: "atencao", ESTOURADO: "atrasado", CUMPRIDO: "ok", CUMPRIDO_FORA: "atrasado", SEM_REGISTRO: "previsto",
};

/**
 * PRAZO DE ATENDIMENTO da OS — o que o contrato prometeu ao cliente para este chamado: comparecer
 * até / resolver até. Só aparece no chamado de cliente em contrato. Não é o prazo de execução (o
 * cartão ao lado): aquele é o compromisso interno com a equipe.
 */
export function PrazoDeAtendimento({ os }: { os: any }) {
  // A página nasce no servidor: o que depende da hora ("faltam 34 min") só entra depois de montar
  const relogio = useAgoraNoNavegador();
  if (!temPrazoDeAtendimento(os)) return null;
  const { comparecer, resolver } = atendimentoDaOs(os, new Date(relogio ?? 0));
  const montado = relogio !== null;
  const prometeu = comparecer.situacao !== "SEM_PRAZO" || resolver.situacao !== "SEM_PRAZO";
  return (
    <Card as="section" data-cartao="prazo-atendimento">
      <CardTitulo icone={Headset}>Prazo de atendimento</CardTitulo>
      {prometeu ? (
        <div className="space-y-2.5 text-sm">
          <Linha rotulo="Comparecer até" prazo={comparecer} dado="comparecer" montado={montado} cumprido={comparecer.cumpridoEm ? `Chegou em ${formatarDataHora(comparecer.cumpridoEm)}` : null} />
          <Linha rotulo="Resolver até" prazo={resolver} dado="resolver" montado={montado} cumprido={resolver.cumpridoEm ? `Concluída em ${formatarDataHora(resolver.cumpridoEm)}` : null} />
        </div>
      ) : (
        <p className="text-sm text-ink-muted" data-sem-promessa>
          O contrato não promete prazo de atendimento para a prioridade {LABELS_PRIORIDADE[os.prioridade] ?? os.prioridade}.
        </p>
      )}
      <p className="text-xs text-ink-muted pt-2.5 mt-2.5 border-t border-surface-border" data-chamado-aberto>
        Chamado aberto em {formatarDataHora(os.chamadoAbertoEm)}{os.contrato?.numero ? ` · contrato ${os.contrato.numero}` : ""}
      </p>
    </Card>
  );
}

/** As situações que mudam com o passar do tempo (as outras — cumprido, sem registro — são fatos gravados) */
const DEPENDE_DA_HORA: readonly SituacaoAtendimento[] = ["NO_PRAZO", "VENCENDO", "ESTOURADO"];

function Linha({ rotulo, prazo, dado, cumprido, montado }: { rotulo: string; prazo: PrazoAtendimento; dado: string; cumprido: string | null; montado: boolean }) {
  if (prazo.situacao === "SEM_PRAZO") return null;
  // Antes de montar no navegador, o limite já aparece; o estado que depende do relógio entra em seguida
  const pronto = montado || !DEPENDE_DA_HORA.includes(prazo.situacao);
  return (
    <div data-prazo-atendimento={dado} data-situacao={pronto ? prazo.situacao : undefined}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">{rotulo}</p>
          <p className="tabular-nums font-medium text-ink" data-limite>{formatarDataHora(prazo.limite)}</p>
        </div>
        {pronto && <StatusPill tom={TOM_ATENDIMENTO[prazo.situacao]} tamanho="sm" className="shrink-0">{textoAtendimento(prazo)}</StatusPill>}
      </div>
      {cumprido && <p className="text-xs text-ink-muted mt-0.5" data-cumprido>{cumprido}</p>}
    </div>
  );
}

/** O selo do cabeçalho da OS: só quando o prazo de atendimento pede atenção (vencendo ou estourado). */
export function SeloDeAtendimento({ os }: { os: any }) {
  const relogio = useAgoraNoNavegador();
  const alerta = relogio === null ? null : alertaDoAtendimento(os, new Date(relogio));
  if (!alerta) return null;
  return (
    <StatusPill tom={alerta === "ESTOURADO" ? "atrasado" : "atencao"} tamanho="sm" data-selo-atendimento={alerta}>
      {alerta === "ESTOURADO" ? "Prazo de atendimento estourado" : "Prazo de atendimento vencendo"}
    </StatusPill>
  );
}
