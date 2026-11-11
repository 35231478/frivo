import type { Metadata } from "next";
import Link from "next/link";
import { PaginaInstitucional } from "@/components/publico/pagina-institucional";
import { FaqLista, type FaqItem } from "@/components/publico/faq-lista";

export const metadata: Metadata = {
  title: "Perguntas frequentes",
  description:
    "Perguntas frequentes sobre o Frivo: o que é, uso no dia a dia, teste grátis, planos, suporte, segurança e dados.",
  robots: { index: true, follow: true },
};

const grupos: { titulo: string; itens: FaqItem[] }[] = [
  {
    titulo: "Sobre o Frivo",
    itens: [
      {
        pergunta: "O que é o Frivo?",
        resposta: (
          <p>
            O Frivo é um sistema de gestão para empresas de climatização e refrigeração. Ele organiza,
            num só lugar, as ordens de serviço, a equipe de campo, os equipamentos dos clientes, o estoque
            e o controle financeiro — do orçamento à cobrança.
          </p>
        ),
      },
      {
        pergunta: "Para quem é o Frivo?",
        resposta: (
          <p>
            Para empresas que prestam serviços de climatização e refrigeração: instalação, manutenção
            preventiva e corretiva, PMOC e atendimento em campo. Serve tanto para quem tem poucos técnicos
            quanto para equipes maiores.
          </p>
        ),
      },
      {
        pergunta: "O que o Frivo faz, na prática?",
        resposta: (
          <p>
            Abertura e acompanhamento de ordens de serviço; agenda e roteiro da equipe; ficha e histórico
            de cada equipamento; orçamentos e aprovação; estoque de materiais e peças; financeiro (contas a
            receber e a pagar, boleto, notas fiscais de serviço); portal para o cliente acompanhar; e um
            aplicativo próprio para o técnico em campo.
          </p>
        ),
      },
    ],
  },
  {
    titulo: "Uso no dia a dia",
    itens: [
      {
        pergunta: "Preciso instalar algo?",
        resposta: (
          <p>
            Não. O Frivo funciona na nuvem — você acessa pelo navegador, no computador ou no celular. O
            técnico usa um aplicativo que se instala na tela inicial do celular, sem passar por loja.
          </p>
        ),
      },
      {
        pergunta: "Tem aplicativo para o técnico?",
        resposta: (
          <p>
            Sim. O técnico tem um app próprio onde vê só a agenda dele, executa a ordem de serviço,
            preenche o checklist, tira fotos e registra as medições — tudo pensado para ser rápido no corre
            do dia.
          </p>
        ),
      },
      {
        pergunta: "Funciona sem internet, no campo?",
        resposta: (
          <p>
            Sim. O técnico consegue trabalhar a ordem de serviço, tirar fotos e preencher tudo mesmo sem
            sinal; quando a internet volta, o aplicativo sincroniza sozinho, sem perder nada.
          </p>
        ),
      },
      {
        pergunta: "O Frivo emite nota fiscal e boleto?",
        resposta: (
          <p>
            Sim. O Frivo emite nota fiscal de serviço (NFS-e) e gera cobranças (boleto/Pix), integrando com
            o financeiro.
          </p>
        ),
      },
      {
        pergunta: "Dá para usar com vários técnicos e usuários?",
        resposta: (
          <p>
            Sim. Você cria os acessos da sua equipe, com permissões diferentes: quem é do escritório
            acessa a gestão; o técnico de campo vê só o que é dele.
          </p>
        ),
      },
    ],
  },
  {
    titulo: "Teste, planos e suporte",
    itens: [
      {
        pergunta: "Tem teste grátis?",
        resposta: (
          <p>
            Sim — 7 dias grátis, sem precisar de cartão de crédito. Dá para experimentar com calma antes
            de decidir.
          </p>
        ),
      },
      {
        pergunta: "Quais são os planos?",
        resposta: (
          <p>
            O Frivo tem planos conforme o tamanho da sua operação, com os recursos essenciais sempre
            incluídos e módulos avançados nos planos maiores. Você pode ver os detalhes na página de planos
            ou falar com a gente para escolher o ideal para a sua empresa.
          </p>
        ),
      },
      {
        pergunta: "Como funciona o suporte?",
        resposta: (
          <p>O suporte é por WhatsApp e e-mail. A gente ajuda na configuração inicial e no dia a dia.</p>
        ),
      },
      {
        pergunta: "Consigo trazer meus dados (clientes, produtos) para o Frivo?",
        resposta: (
          <p>
            Sim. É possível importar cadastros para você não começar do zero; o suporte orienta nesse
            processo.
          </p>
        ),
      },
      {
        pergunta: "Como faço para cancelar?",
        resposta: (
          <p>
            Você pode cancelar quando quiser. Antes de encerrar, seus dados ficam disponíveis para
            exportação por um período, para você não perder nada.
          </p>
        ),
      },
    ],
  },
  {
    titulo: "Segurança e dados",
    itens: [
      {
        pergunta: "Meus dados estão seguros?",
        resposta: (
          <p>
            Sim. O acesso é protegido por senha e perfis de permissão, o tráfego é criptografado e fazemos
            backups. Tratamos os dados conforme a LGPD — veja a nossa{" "}
            <Link href="/privacidade">Política de Privacidade</Link>.
          </p>
        ),
      },
      {
        pergunta: "Os dados dos meus clientes são meus?",
        resposta: (
          <p>
            São. Os dados que você cadastra no Frivo (seus clientes, equipamentos, financeiro) são seus; o
            Frivo apenas os processa para o sistema funcionar, seguindo as suas instruções.
          </p>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <PaginaInstitucional titulo="Perguntas frequentes" atualizacao="[data]">
      <div className="space-y-10">
        {grupos.map((grupo) => (
          <section key={grupo.titulo}>
            <h2 className="mb-4 font-display text-lg font-bold text-ink sm:text-xl">{grupo.titulo}</h2>
            <FaqLista itens={grupo.itens} />
          </section>
        ))}
      </div>

      <div className="mt-10 rounded-card border border-surface-border bg-white px-5 py-6">
        <h2 className="font-display text-base font-semibold text-ink">Ainda com dúvida?</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ink/90 sm:text-base">
          Fale com a gente pelo WhatsApp [número] ou pelo e-mail [e-mail]. Teremos prazer em ajudar.
        </p>
      </div>
    </PaginaInstitucional>
  );
}
