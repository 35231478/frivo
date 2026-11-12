import type { Metadata } from "next";
import Link from "next/link";
import { PaginaInstitucional, ProseJuridica } from "@/components/publico/pagina-institucional";

export const metadata: Metadata = {
  title: "Termos de Uso e Contrato de Assinatura",
  description:
    "Termos de Uso e Contrato de Assinatura do Frivo: condições de uso, assinatura, pagamento, LGPD e responsabilidades.",
  robots: { index: true, follow: true },
};

export default function TermosPage() {
  return (
    <PaginaInstitucional titulo="Termos de Uso e Contrato de Assinatura" atualizacao="[data]">
      <ProseJuridica>
        <h2>1. Partes e objeto</h2>
        <p>
          Este contrato é celebrado entre <strong>[Razão Social da Frivo], CNPJ [___]</strong>{" "}
          (“Frivo”) e a pessoa jurídica que contrata a assinatura (“Cliente”). Ao criar uma conta e usar
          o Frivo, o Cliente concorda com estes Termos.
        </p>
        <p>
          O objeto é a concessão, ao Cliente, do <strong>direito de uso</strong> do sistema Frivo no
          modelo de assinatura (software como serviço — SaaS), acessado pela internet, conforme o plano
          contratado.
        </p>

        <h2>2. Licença de uso</h2>
        <p>
          A Frivo concede ao Cliente uma licença <strong>não exclusiva, intransferível e revogável</strong>{" "}
          de uso do sistema, durante a vigência da assinatura e conforme o plano.{" "}
          <strong>Não há venda do software</strong>: a propriedade e todos os direitos sobre o Frivo
          permanecem da Frivo. É vedado copiar, revender, sublicenciar, fazer engenharia reversa ou usar
          o sistema fora do contratado.
        </p>

        <h2>3. Conta, acessos e responsabilidade</h2>
        <p>
          O Cliente é responsável pela veracidade dos dados de cadastro, pela guarda das credenciais de
          acesso e pelo uso feito pelos seus usuários. O Cliente deve criar e gerenciar os acessos da sua
          equipe e comunicar imediatamente qualquer uso não autorizado.
        </p>

        <h2>4. Planos, preços, teste grátis e pagamento</h2>
        <p>O Frivo é oferecido em planos, conforme a página de planos vigente.</p>
        <ul>
          <li>
            <strong>Teste grátis:</strong> 7 (sete) dias, sem necessidade de cartão de crédito.
          </li>
          <li>
            <strong>Assinatura:</strong> cobrança mensal conforme o plano e a quantidade de
            usuários/técnicos contratados.
          </li>
          <li>
            <strong>Reajuste:</strong> os valores podem ser reajustados anualmente, por índice oficial,
            mediante aviso prévio.
          </li>
          <li>
            <strong>Pagamento:</strong> por boleto, Pix ou cartão, na forma indicada no sistema. O não
            pagamento pode levar à suspensão do acesso (seção 6).
          </li>
        </ul>

        <h2>5. Prazo, renovação e cancelamento</h2>
        <p>
          A assinatura vigora por prazo indeterminado, renovando-se automaticamente a cada período, até
          que uma das partes a encerre. O Cliente pode <strong>cancelar a qualquer momento</strong>; o
          cancelamento interrompe as renovações seguintes, sem reembolso do período já pago, salvo
          disposição legal.
        </p>

        <h2>6. Suspensão e rescisão</h2>
        <p>
          A Frivo pode suspender ou encerrar o acesso em caso de inadimplência, uso ilícito, violação
          destes Termos ou risco à segurança. Sempre que possível, o Cliente será avisado antes. Encerrado
          o contrato, aplicam-se os efeitos da seção 10.
        </p>

        <h2>7. Obrigações da Frivo</h2>
        <p>
          Disponibilizar o sistema conforme o plano contratado; empregar medidas razoáveis de segurança
          da informação; prestar suporte por <strong>WhatsApp e e-mail</strong>, em horário comercial;
          tratar os dados conforme a <Link href="/privacidade">Política de Privacidade</Link> e a LGPD.
        </p>

        <h2>8. Obrigações do Cliente</h2>
        <p>
          Usar o sistema de forma lícita e conforme estes Termos; garantir a veracidade dos dados
          inseridos; ser o <strong>responsável (controlador)</strong> pelos dados que insere no sistema
          sobre terceiros (seus clientes, colaboradores etc.), inclusive por obter as autorizações e dar
          as informações exigidas pela LGPD aos respectivos titulares; não usar o Frivo para finalidades
          ilegais nem violar direitos de terceiros.
        </p>

        <h2>9. Proteção de dados (LGPD)</h2>
        <p>
          Quanto aos dados que o Cliente insere no sistema (de seus clientes, colaboradores, etc.), o{" "}
          <strong>Cliente é o controlador</strong> e a <strong>Frivo é a operadora</strong>, tratando-os
          em nome do Cliente e seguindo suas instruções. Quanto aos dados da conta e da cobrança do
          Cliente, a <strong>Frivo é a controladora</strong>. Ambas as partes se comprometem a cumprir a
          LGPD. Detalhes na <Link href="/privacidade">Política de Privacidade</Link>, que integra este
          contrato.
        </p>

        <h2>10. Rescisão: dados do Cliente</h2>
        <p>
          Encerrada a assinatura, os dados inseridos pelo Cliente ficam disponíveis para{" "}
          <strong>exportação</strong> por um período razoável; após esse prazo, podem ser{" "}
          <strong>eliminados ou anonimizados</strong>, salvo obrigação legal de guarda. É
          responsabilidade do Cliente exportar seus dados dentro do prazo informado.
        </p>

        <h2>11. Propriedade intelectual</h2>
        <p>
          O Frivo, sua marca, código, telas e conteúdos são de{" "}
          <strong>propriedade exclusiva da Frivo</strong>. A assinatura não transfere qualquer direito de
          propriedade intelectual ao Cliente, apenas o direito de uso descrito na seção 2.
        </p>

        <h2>12. Disponibilidade e limitação de responsabilidade</h2>
        <p>
          A Frivo empenha-se em manter o sistema disponível, mas{" "}
          <strong>não garante funcionamento ininterrupto ou livre de falhas</strong>, podendo haver
          manutenções e indisponibilidades eventuais. Na máxima extensão permitida em lei, a
          responsabilidade da Frivo por perdas e danos limita-se ao{" "}
          <strong>valor pago pelo Cliente nos 12 meses anteriores</strong> ao evento, excluídos danos
          indiretos ou lucros cessantes. A Frivo não responde por decisões ou dados inseridos pelo
          Cliente.
        </p>

        <h2>13. Confidencialidade</h2>
        <p>
          Cada parte manterá sigilo sobre as informações confidenciais da outra a que tiver acesso,
          usando-as apenas para cumprir este contrato.
        </p>

        <h2>14. Alterações destes Termos</h2>
        <p>
          A Frivo pode atualizar estes Termos, comunicando mudanças relevantes pelos canais usuais. O uso
          continuado após a vigência da alteração implica concordância.
        </p>

        <h2>15. Disposições gerais</h2>
        <p>
          Este contrato é regido pelas leis do Brasil. Fica eleito o foro da comarca de{" "}
          <strong>[comarca]</strong>, salvo disposição legal em contrário. A tolerância de uma parte não
          implica renúncia de direitos.
        </p>

        <hr className="my-8 border-surface-border" />
        <p>
          <strong>Contato:</strong> WhatsApp [número] · E-mail [e-mail]
        </p>
      </ProseJuridica>
    </PaginaInstitucional>
  );
}
