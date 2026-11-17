import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ITENS_CONFIGURACOES, ehAbaConfig, itemConfig, podeVerItemConfig } from "@/lib/navegacao/configuracoes";
import { PainelConfiguracoes } from "@/components/config/painel-configuracoes";
import { TelaConfig, temTelaConfig } from "@/components/config/telas";

export const metadata: Metadata = { title: "Configurações" };

/**
 * Configurações: uma página só — 3 abas com cartões, e a tela de cada item numa gaveta
 * (?secao=…). A permissão de cada item é conferida aqui antes de montar a tela, e quem não pode
 * abrir nenhum item vai para /sem-permissao.
 */
export default async function ConfiguracoesPage({ searchParams }: { searchParams: Promise<{ aba?: string; secao?: string }> }) {
  const { aba, secao } = await searchParams;
  const session = await auth();
  const permissoes = session?.user?.permissoes;
  const role = session?.user?.role;

  const visiveis = ITENS_CONFIGURACOES.filter((i) => podeVerItemConfig(i, permissoes, role)).map((i) => i.id);
  // A página se guarda sozinha (o middleware não exige "Configurações › Visualizar" aqui, para quem
  // tem só a permissão de um item — fiscal, admissão, modelos — chegar ao item dele): sem nenhum
  // cartão para abrir, não há o que fazer nesta tela.
  if (visiveis.length === 0) redirect("/sem-permissao");
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
