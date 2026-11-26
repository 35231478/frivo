"use client";

/**
 * Orçamento, leva D — "Documento do cliente": as duas opções da impressão/envio DESTE orçamento, junto dos botões de
 * enviar e Gerar PDF. Valem igual no link do cliente, na impressão e no PDF (e no documento desta tela).
 *  - Mostrar materiais ao cliente: dentro de cada serviço, os materiais inclusos nele.
 *  - Mostrar valores dos produtos/materiais: o preço de venda de cada material (só com a primeira ligada).
 * O custo nunca vai ao documento. Sem Orçamentos › editar, ou com o orçamento aprovado/cancelado: só leitura (com o
 * motivo). Salvou: toast e a página recarrega o documento.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { opcoesDoDocumento, type OpcoesDocumentoOrcamento } from "@/lib/orcamentos/documento-opcoes";

export function OpcoesDocumento({ orcamentoId, inicial, podeEditar, travado }: {
  orcamentoId: string;
  inicial: { mostrarMateriais: boolean; mostrarValoresMateriais: boolean };
  /** Orçamentos › editar */
  podeEditar: boolean;
  /** Motivo do cadeado (aprovado, cancelado); null = dá para mudar */
  travado: string | null;
}) {
  const router = useRouter();
  const [op, setOp] = useState<OpcoesDocumentoOrcamento>(opcoesDoDocumento(inicial));
  const [salvando, setSalvando] = useState(false);
  const bloqueado = !podeEditar || !!travado || salvando;

  async function salvar(nova: OpcoesDocumentoOrcamento) {
    const antes = op;
    const efetiva = opcoesDoDocumento(nova);
    setOp(efetiva);
    setSalvando(true);
    try {
      const r = await fetch(`/api/orcamentos/${orcamentoId}/opcoes-documento`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(efetiva),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setOp(antes); toast(d.erro ?? "Não foi possível salvar a opção.", "erro"); return; }
      toast("Documento do cliente atualizado.");
      router.refresh();
    } catch {
      setOp(antes);
      toast("Sem conexão. Tente de novo.", "erro");
    } finally { setSalvando(false); }
  }

  return (
    <section className="border-t border-surface-linha pt-3" aria-label="Documento do cliente" data-opcoes-documento>
      <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Documento do cliente
        <Dica rotulo="Documento do cliente" texto="O que o cliente vê no link, na impressão e no PDF deste orçamento. Desligado, o cliente vê só a linha de cada serviço. Os valores mostrados são sempre o preço de venda; o custo nunca aparece. O padrão para os orçamentos novos fica em Configurações › Orçamentos." />
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-6 divide-y md:divide-y-0 divide-surface-linha">
        <div data-opcao-mostrar-materiais>
          <ToggleSwitch
            label="Mostrar materiais ao cliente"
            description="Dentro de cada serviço, os materiais inclusos nele."
            checked={op.mostrarMateriais}
            disabled={bloqueado}
            onChange={(v) => salvar({ mostrarMateriais: v, mostrarValoresMateriais: v ? op.mostrarValoresMateriais : false })}
          />
        </div>
        <div data-opcao-mostrar-valores>
          <ToggleSwitch
            label="Mostrar valores dos produtos/materiais"
            description={op.mostrarMateriais ? "O preço de venda de cada material." : "Ligue “Mostrar materiais” primeiro."}
            checked={op.mostrarValoresMateriais}
            disabled={bloqueado || !op.mostrarMateriais}
            onChange={(v) => salvar({ mostrarMateriais: op.mostrarMateriais, mostrarValoresMateriais: v })}
          />
        </div>
      </div>
      {(travado || !podeEditar) && (
        <p className="flex items-center gap-1.5 text-xs text-ink-muted" data-opcoes-travadas>
          <Lock className="w-3.5 h-3.5" aria-hidden /> {travado ?? "Só quem edita orçamentos muda estas opções."}
        </p>
      )}
    </section>
  );
}
