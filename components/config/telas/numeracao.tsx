import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { lerNumeracoes } from "@/lib/numeracao-server";
import { PageHeader } from "@/components/ui/page-header";
import { NumeracaoClient } from "@/components/config/numeracao-client";

/** Configurações › Conta › Numeração de documentos (rota protegida por Configurações › visualizar). */
export async function TelaNumeracao() {
  const session = await auth();
  const u = session!.user!;
  const numeracoes = await lerNumeracoes(u.empresaId);
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Numeração de documentos"
        description="O próximo número de cada documento"
        dica="Para continuar a numeração de onde o sistema anterior parou. A sequência é contínua (não reinicia no ano): o ano no número é só o rótulo de quando o documento nasceu. Só os próximos documentos mudam; os existentes ficam como estão. A NFS-e não entra: o número dela vem da prefeitura."
        backHref="/configuracoes/conta"
      />
      <NumeracaoClient inicial={numeracoes} podeEditar={pode(u.permissoes, "configuracoes", "gerenciar", u.role)} />
    </div>
  );
}
