import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { ITENS_CONFIGURACOES, ehAbaConfig, itemConfig, podeVerItemConfig } from "@/lib/navegacao/configuracoes";
import { PainelConfiguracoes } from "@/components/config/painel-configuracoes";
import { TelaConfig, temTelaConfig } from "@/components/config/telas";

export const metadata: Metadata = { title: "Configurações" };

/**
 * Configurações: uma página só — 3 abas com cartões, e a tela de cada item numa gaveta
 * (?secao=…). A permissão de cada item é conferida aqui antes de montar a tela.
 */
export default async function ConfiguracoesPage({ searchParams }: { searchParams: Promise<{ aba?: string; secao?: string }> }) {
  const { aba, secao } = await searchParams;
  const session = await auth();
  const permissoes = session?.user?.permissoes;
  const role = session?.user?.role;

  const visiveis = ITENS_CONFIGURACOES.filter((i) => podeVerItemConfig(i, permissoes, role)).map((i) => i.id);
  const item = itemConfig(secao);
  const liberado = !!item && visiveis.includes(item.id) && temTelaConfig(item.id);
  const abaInicial = liberado ? item!.aba : ehAbaConfig(aba) ? aba : null;

  return (
    <PainelConfiguracoes
      visiveis={visiveis}
      abaInicial={abaInicial}
      secaoAberta={liberado ? item!.id : null}
      secaoNegada={secao && !liberado ? secao : null}
    >
      {liberado ? <TelaConfig id={item!.id} /> : null}
    </PainelConfiguracoes>
  );
}
