"use client";

import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/avisos";
import { EditorPedido } from "@/components/compras/editor-pedido";

export function NovoPedidoAvulso() {
  const router = useRouter();
  return (
    <EditorPedido
      avulso
      onCancelar={() => router.push("/compras/pedidos")}
      onSalvo={(p) => {
        toast(`Pedido ${p.numero} criado.`);
        if (p.whatsappUrl) window.open(p.whatsappUrl, "_blank", "noopener");
        router.push(`/compras/pedidos/${p.id}`);
      }}
    />
  );
}
