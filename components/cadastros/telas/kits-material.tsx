"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { EditorKitMaterial } from "@/components/cadastros/editores/editor-kit-material";
import { formatarMoeda } from "@/lib/utils";

/**
 * Kits de material (E3.2) no padrão: nome + itens (produto + quantidade), editor próprio. A lista mostra quantos
 * itens, o custo de referência (último custo de compra × quantidade, vindo do servidor) e em quantos serviços o
 * kit entra como material padrão.
 */
export function KitsMaterialTela() {
  return (
    <CadastroPadrao
      entidade="kits-material"
      Editor={EditorKitMaterial}
      ajuda="Um kit junta produtos com a quantidade usada por serviço (ex.: kit de instalação: suporte, tubulação, cabo). Na composição do serviço ele entra como um bloco e é “vivo”: mudar o kit muda em todos os serviços que o usam; no orçamento/OS ele vira uma cópia editável. O custo é só referência (último custo de compra), nunca altera preço. Inativar tira o kit das novas escolhas; os serviços que já o usam continuam com ele."
      celula={(col, k) => {
        if (col === "itens") { const n = Array.isArray(k.itens) ? k.itens.length : 0; return n ? `${n} ${n === 1 ? "item" : "itens"}` : "—"; }
        if (col === "custo") {
          const c = k.custoReferencia as { total: number; semCusto: string[] } | undefined;
          if (!c || !Array.isArray(k.itens) || !k.itens.length) return "—";
          return (
            <span className="tabular-nums whitespace-nowrap" data-custo-kit={c.total}>
              {formatarMoeda(c.total)}
              {c.semCusto.length > 0 && <>{" "}<span className="text-[10px] text-atencao-texto ml-1" title="Produto(s) sem custo de compra registrado: soma incompleta">({c.semCusto.length} sem custo)</span></>}
            </span>
          );
        }
        if (col === "uso") return k._count?.servicoMateriais ? `${k._count.servicoMateriais} serviço(s)` : "—";
        return undefined;
      }}
    />
  );
}
