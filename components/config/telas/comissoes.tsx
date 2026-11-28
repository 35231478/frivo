import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { telaDeComissoes } from "@/lib/comissoes/servidor";
import { PageHeader } from "@/components/ui/page-header";
import { ComissoesClient, type TelaComissoesDados } from "@/components/config/comissoes-client";

/**
 * COM-1 — Configurações › Comercial › Comissões. Valores de pagamento: só com "Desempenho › Gerenciar" (o mesmo de
 * quem configura o bônus e fecha o mês); o servidor confere de novo em cada gravação.
 */
export async function TelaComissoes() {
  const session = await auth();
  const u = session!.user!;
  const podeGerenciar = pode(u.permissoes, "desempenho", "gerenciar", u.role);
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Comissões"
        description="Quem ganha comissão, sobre o quê e quando"
        dica="A comissão nasce na aprovação do orçamento, para o vendedor, e é paga no fechamento do mês (Desempenho › Fechamento): cada pessoa vira uma conta a pagar com bônus e comissão."
        backHref="/configuracoes/operacionais"
      />
      {podeGerenciar ? (
        <ComissoesClient inicial={(await telaDeComissoes(u.empresaId)) as TelaComissoesDados} />
      ) : (
        <p className="card-padded text-sm text-ink-muted" data-sem-permissao-comissoes>As comissões são configuradas por quem tem “Desempenho › Gerenciar”.</p>
      )}
    </div>
  );
}
