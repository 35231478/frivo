import type { Metadata } from "next";
import { PaginaInstitucional, ProseJuridica } from "@/components/publico/pagina-institucional";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Como o Frivo trata dados pessoais ao fornecer o sistema, em conformidade com a LGPD.",
  robots: { index: true, follow: true },
};

export default function PrivacidadePage() {
  return (
    <PaginaInstitucional titulo="Política de Privacidade" atualizacao="[data de publicação]">
      <ProseJuridica>
        <h2>1. Quem somos</h2>
        <p>
          O Frivo é um sistema de gestão (software como serviço — SaaS) para empresas de climatização e
          refrigeração, fornecido por <strong>[Razão Social da Frivo], CNPJ [___]</strong>, com sede em{" "}
          <strong>[endereço]</strong> (“Frivo”, “nós”).
        </p>
        <p>
          Esta Política explica como tratamos dados pessoais ao fornecer o Frivo, em conformidade com a
          Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — “LGPD”).
        </p>

        <h2>2. Dois papéis diferentes (importante)</h2>
        <p>O Frivo trata dados pessoais em duas situações distintas:</p>
        <ul>
          <li>
            <strong>Como controladora:</strong> dos dados da sua empresa enquanto assinante — cadastro da
            conta, usuários do painel, dados de cobrança e uso do sistema. Aqui nós decidimos as
            finalidades e os meios do tratamento.
          </li>
          <li>
            <strong>Como operadora:</strong> dos dados que você (a empresa assinante) insere no sistema
            sobre a sua operação — seus clientes, seus colaboradores/técnicos, equipamentos, ordens de
            serviço e informações financeiras. Esses dados são seus; nós os tratamos em seu nome e
            seguindo as suas instruções, para fazer o sistema funcionar. A empresa assinante é a
            controladora desses dados.
          </li>
        </ul>

        <h2>3. Dados que tratamos</h2>
        <ul>
          <li>
            <strong>Dados da conta (controladora):</strong> nome e dados de contato do responsável,
            e-mail e senha de acesso, dados da empresa assinante, dados de cobrança da assinatura.
          </li>
          <li>
            <strong>Dados de uso:</strong> registros de acesso, data/hora, dispositivo e navegador, e
            eventos de uso do sistema (para segurança e melhoria).
          </li>
          <li>
            <strong>Dados inseridos pelo assinante (operadora):</strong> cadastros de clientes,
            colaboradores e fornecedores; equipamentos; ordens de serviço, fotos e laudos; dados
            financeiros. Podem incluir dados pessoais de terceiros inseridos pela empresa assinante.
          </li>
          <li>
            <strong>Localização (quando aplicável):</strong> se a empresa assinante ativar recursos de
            localização do colaborador em campo, tratamos dados de geolocalização do dispositivo do
            colaborador, conforme a configuração e o consentimento aplicáveis.
          </li>
          <li>
            <strong>Cookies e tecnologias similares:</strong> usados para manter a sessão, lembrar
            preferências e medir o uso. Veja a seção 9.
          </li>
        </ul>

        <h2>4. Para que usamos (finalidades)</h2>
        <p>
          Fornecer, operar e manter o Frivo; autenticar o acesso e manter a segurança da conta; processar
          a assinatura, cobrança e emissão de documentos fiscais; dar suporte ao cliente; melhorar o
          produto e prevenir fraudes; cumprir obrigações legais e regulatórias.
        </p>

        <h2>5. Bases legais (LGPD)</h2>
        <p>
          Tratamos dados com base em: execução de contrato, cumprimento de obrigação legal, legítimo
          interesse (segurança, prevenção a fraude, melhoria do produto) e consentimento, quando
          aplicável. Para os dados tratados como operadora, a base legal é definida pela empresa assinante
          (controladora).
        </p>

        <h2>6. Compartilhamento de dados</h2>
        <p>
          Não vendemos dados pessoais. Compartilhamos apenas com fornecedores que viabilizam o serviço
          (operadores/subprocessadores), sob contrato e dever de segurança, nas categorias: hospedagem e
          banco de dados; envio de e-mails transacionais; meios de pagamento e cobrança e emissão de notas
          fiscais. Também podemos compartilhar para cumprir obrigação legal ou ordem de autoridade
          competente. A relação atualizada de subprocessadores pode ser disponibilizada mediante
          solicitação.
        </p>

        <h2>7. Armazenamento, segurança e transferência internacional</h2>
        <p>
          Adotamos medidas técnicas e organizacionais para proteger os dados (controle de acesso por
          perfil, senhas com criptografia/hash, tráfego por HTTPS, backups). O banco de dados principal é
          hospedado <strong>[no Brasil / região ___]</strong>. Alguns fornecedores podem tratar dados fora
          do Brasil; nesses casos, buscamos garantias adequadas conforme a LGPD. Nenhum sistema é 100%
          seguro; trabalhamos continuamente para reduzir riscos.
        </p>

        <h2>8. Retenção</h2>
        <p>
          Mantemos os dados pelo tempo necessário às finalidades desta Política e às obrigações legais.
          Encerrada a assinatura, os dados inseridos pela empresa assinante ficam disponíveis para
          exportação por um período razoável e depois são eliminados ou anonimizados, salvo obrigação
          legal de guarda.
        </p>

        <h2>9. Cookies</h2>
        <p>
          Usamos cookies essenciais (sessão/segurança) e cookies de preferência e medição de uso. Você
          pode gerenciar cookies no navegador; desabilitar os essenciais pode afetar o funcionamento.
        </p>

        <h2>10. Direitos do titular (LGPD, art. 18)</h2>
        <p>
          Você pode solicitar: confirmação do tratamento; acesso; correção; anonimização, bloqueio ou
          eliminação de dados desnecessários; portabilidade; informação sobre compartilhamento; e
          revogação de consentimento. Para os dados que uma empresa assinante inseriu no Frivo (em que
          somos operadora), direcione o pedido à empresa assinante (controladora). Nós a apoiamos no
          atendimento.
        </p>

        <h2>11. Contato e Encarregado (DPO)</h2>
        <p>
          Fale conosco sobre privacidade por e-mail: <strong>[e-mail de contato]</strong> e WhatsApp:{" "}
          <strong>[número]</strong>. Encarregado pelo tratamento de dados (DPO): <strong>[nome / e-mail]</strong>.
        </p>

        <h2>12. Alterações desta Política</h2>
        <p>
          Podemos atualizar esta Política. Mudanças relevantes serão comunicadas pelos canais usuais, e a
          data de “última atualização” no topo será alterada.
        </p>
      </ProseJuridica>
    </PaginaInstitucional>
  );
}
