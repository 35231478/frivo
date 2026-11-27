"use client";

import { useRouter } from "next/navigation";
import { InativarRegistro } from "@/components/ui/inativar-registro";

/**
 * Inativar / Reabrir / Recusar uma OS. É o botão padrão dos cadastros (InativarRegistro), com o que a
 * OS tem de próprio:
 * - Inativar = a OS vira CANCELADA (nada é apagado). Exige `ordens.excluir`. O impacto
 *   (GET /api/ordens/[id]/impacto) mostra antes o bloqueio da OS já em medição.
 * - Reabrir = volta para ABERTA (PUT { status: "ABERTA" }). Exige `ordens.editar`.
 * - Recusar (gaveta de Solicitações) = o mesmo inativar, com `{ recusa: true }` e textos próprios.
 * Sem a permissão correspondente, não renderiza nada.
 */
export function OsInativarBotao({
  osId, numero, status, variante = "botao", abrirAoMontar = false, onFechar, onAlterado, modo = "inativar", className,
}: {
  osId: string;
  numero: string;
  status: string;
  /** "oculto": só o modal (aberto via `abrirAoMontar`). */
  variante?: "icone" | "botao" | "oculto";
  /** Abre o modal direto (usado quando o usuário escolhe "Cancelada" no select de status). */
  abrirAoMontar?: boolean;
  onFechar?: () => void;
  onAlterado?: (novoStatus: string) => void;
  /** "recusar": recusa de solicitação do cliente (gaveta de Solicitações) — mesmo fluxo, textos próprios. */
  modo?: "inativar" | "recusar";
  className?: string;
}) {
  const router = useRouter();
  const recusar = modo === "recusar";
  const cancelada = !recusar && status === "CANCELADA";

  return (
    <InativarRegistro
      url={`/api/ordens/${osId}`} modulo="ordens" acaoReativar="editar" ativo={!cancelada}
      nome={numero} entidade="OS" feminino variante={variante} className={className}
      abrirAoMontar={abrirAoMontar} onFechar={onFechar}
      rotuloInativar={recusar ? "Recusar" : "Inativar"} rotuloReativar="Reabrir"
      reativarCom={{ metodo: "PUT", corpo: { status: "ABERTA" } }}
      titulo={recusar ? `Recusar a solicitação ${numero}?` : undefined}
      textoInativar={recusar
        ? "A solicitação é recusada e a OS fica Cancelada, também no portal do cliente. Pode ser reaberta depois."
        : "Tem certeza? A OS fica Cancelada e sai das listas e do calendário; nada é apagado e pode ser reaberta depois."}
      textoReativar="A OS volta para Aberta e reaparece nas listas e no calendário."
      corpoInativar={recusar ? { recusa: true } : undefined}
      placeholderMotivo={recusar ? "Ex: fora da área de atendimento, serviço não prestado…" : "Ex: OS aberta em duplicidade, cliente desistiu…"}
      avisoConcluido={recusar ? "Solicitação recusada." : cancelada ? "OS reaberta." : "OS inativada."}
      aoConcluir={(ativa) => {
        onAlterado?.(ativa ? "ABERTA" : "CANCELADA");
        if (!recusar) router.refresh();
      }}
    />
  );
}
