"use client";

import { useRouter } from "next/navigation";
import { InativarRegistro } from "@/components/ui/inativar-registro";

/**
 * "Descartar" a nota importada por engano (antes de lançar): o modal padrão dos cadastros, com motivo.
 * A nota é apagada e fica o registro de quem descartou e quando (DELETE /api/compras/notas/[id]).
 * A lançada não mostra o botão (e a rota recusa): o estorno é pela conta a pagar e pelo estoque.
 */
export function DescartarNota({ id, numero, serie, voltarPara = "/estoque/notas" }: { id: string; numero: string; serie: string; voltarPara?: string }) {
  const router = useRouter();
  return (
    <InativarRegistro
      url={`/api/compras/notas/${id}`} modulo="estoque" acaoInativar="gerenciar" acaoReativar="gerenciar"
      ativo nome={`${numero}/${serie}`} entidade="nota" feminino variante="botao" rotuloInativar="Descartar"
      titulo={`Descartar a NF ${numero}/${serie}?`}
      textoInativar="A nota sai do sistema com os itens; fica registrado quem descartou, quando e por quê."
      placeholderMotivo="Ex: XML de outra empresa, nota importada em duplicidade…"
      avisoConcluido="Nota descartada."
      aoConcluir={() => { router.push(voltarPara); router.refresh(); }}
    />
  );
}
