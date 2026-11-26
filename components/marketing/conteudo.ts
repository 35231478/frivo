/**
 * Home de vendas do Frivo (rota "/"): TODO o conteúdo num arquivo só — textos do briefing, a lista dos
 * prints e os links. Trocar um texto, o destino do CTA ou o contato é mexer aqui; a página só diagrama.
 *
 * Regras do briefing: um CTA primário repetido, nenhum número de cliente ou depoimento inventado e
 * nenhum espaço reservado à vista: a prova social e a foto da equipe só aparecem com conteúdo real.
 *
 * Os prints são telas do sistema com a EMPRESA DE DEMONSTRAÇÃO (dados fictícios), gerados por
 * `npm run prints:vendas` (scripts/vendas). Ver public/marketing/prints/LEIA-ME.md.
 */

/** Destino do CTA primário. Um lugar só: quando o cadastro do teste existir, troca-se aqui. */
export const LINK_TESTE_GRATIS = "/teste-gratis";
export const LINK_ENTRAR = "/login";

/** Rótulos do CTA (os do briefing). */
export const CTA = {
  principal: "Teste grátis por 7 dias",
  curto: "Teste grátis",
  planos: "Testar grátis",
  apoio: "Sem cartão de crédito. Cancele quando quiser.",
} as const;

/** Fora dos buscadores até o lançamento (decisão do dono do produto): no dia, `true`. */
export const PUBLICADA = false;

export interface Contato {
  email: string;
  /** WhatsApp de vendas, como aparece na tela — só existe com número configurado */
  whatsapp: string | null;
  linkWhatsapp: string | null;
  linkEmail: string;
}

/**
 * O contato do rodapé e da página do teste grátis. O WhatsApp vem da configuração do ambiente
 * (WHATSAPP_VENDAS, com DDD: "62912345678"); sem ela — ou com um número que não é de telefone —, o
 * WhatsApp não aparece. Número fixo no código, nunca: um número errado no ar é pior que nenhum.
 */
export function contatoDeVendas(env: Record<string, string | undefined> = process.env): Contato {
  const email = "contato@termofrioengenharia.com.br";
  const digitos = (env.WHATSAPP_VENDAS ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  const valido = /^\d{10,11}$/.test(digitos);
  const whatsapp = valido ? `(${digitos.slice(0, 2)}) ${digitos.slice(2, -4)}-${digitos.slice(-4)}` : null;
  return { email, whatsapp, linkWhatsapp: valido ? `https://wa.me/55${digitos}` : null, linkEmail: `mailto:${email}` };
}

/** Endereço público do site: base do canonical e da imagem de Open Graph. */
export const URL_SITE = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXTAUTH_URL ?? "https://app.frivo.com.br";

export const SEO = {
  titulo: "Frivo — sistema de gestão para empresas de climatização",
  descricao:
    "Ordens de serviço, PMOC, equipe em campo, estoque e financeiro num só lugar. Teste grátis por 7 dias, sem cartão de crédito.",
} as const;

// ── Prints do sistema ───────────────────────────────────────────────────────────────────────────

export type FormatoPrint = "desktop" | "celular";
export interface Print {
  /** Nome do arquivo em public/marketing/prints, SEM extensão (.webp, .avif, .png ou .jpg). */
  arquivo: string;
  /** Qual tela do sistema (legenda das miniaturas). */
  tela: string;
  /** Computador = 16:10; celular = 9:19 (o tamanho que `npm run prints:vendas` grava). */
  formato: FormatoPrint;
  /** Texto alternativo. */
  alt: string;
}

// Numeração do dono do produto (01 a 14) + as telas extras de cada bloco. Todas da empresa de demonstração.
export const PRINTS = {
  dashboard: { arquivo: "01-dashboard", tela: "Dashboard", formato: "desktop", alt: "Painel do Frivo com as OS do dia, a agenda e os indicadores" },
  calendario: { arquivo: "02-calendario-os", tela: "Calendário de OS", formato: "desktop", alt: "Calendário do mês com as ordens de serviço de cada técnico" },
  orcamentoAprovado: { arquivo: "03-orcamento-aprovado", tela: "Orçamento aprovado", formato: "desktop", alt: "Orçamento aprovado pelo cliente por link, com a OS gerada e a linha do tempo da proposta" },
  orcamentos: { arquivo: "04-orcamentos", tela: "Orçamentos", formato: "desktop", alt: "Lista de orçamentos com status e totais do período" },
  contratos: { arquivo: "05-contratos", tela: "Contratos", formato: "desktop", alt: "Contratos de manutenção com valor mensal e próxima OS" },
  estoque: { arquivo: "06-estoque-saldos", tela: "Estoque", formato: "desktop", alt: "Saldos do estoque com o aviso de produtos no mínimo" },
  mapa: { arquivo: "07-mapa-equipe", tela: "Mapa da equipe", formato: "desktop", alt: "Mapa com a posição dos técnicos em campo e a OS que cada um executa" },
  desempenho: { arquivo: "08-desempenho", tela: "Desempenho", formato: "desktop", alt: "Ranking do mês por escore de qualidade, com faixas de bônus e o prêmio em disputa" },
  desempenhoTv: { arquivo: "08-desempenho-tv", tela: "Modo TV", formato: "desktop", alt: "Ranking do mês no modo TV, para a parede da empresa" },
  equipes: { arquivo: "09-equipes", tela: "Colaboradores", formato: "desktop", alt: "Colaboradores com cargo, equipe e atividades" },
  financeiro: { arquivo: "10-financeiro-painel", tela: "Financeiro", formato: "desktop", alt: "Dashboard financeiro com a receber, a pagar e entradas e saídas dos últimos meses" },
  appTecnico: { arquivo: "11-app-tecnico", tela: "App do técnico", formato: "celular", alt: "App do técnico com as OS do dia, o endereço e o botão Cheguei" },
  pmoc: { arquivo: "12-pmoc", tela: "PMOC", formato: "desktop", alt: "Cronograma do PMOC com as manutenções geradas para o ano" },
  aceite: { arquivo: "13-aceite", tela: "Aceite do cliente", formato: "celular", alt: "Cliente confirmando o serviço pelo link e avaliando com cinco estrelas" },
  equipamento: { arquivo: "14-equipamento-qr", tela: "Equipamento", formato: "desktop", alt: "Ficha do equipamento com foto, garantia, próxima manutenção e QR Code" },
  qrCelular: { arquivo: "14-qr-celular", tela: "Leitura do QR", formato: "celular", alt: "O que abre no celular ao ler o QR do equipamento: ficha, próxima manutenção e histórico" },
  osAtividades: { arquivo: "15-os-atividades", tela: "OS com atividades", formato: "desktop", alt: "Ordem de serviço com o painel de atividades: etapas concluídas, equipe em deslocamento e próxima visita" },
} as const satisfies Record<string, Print>;

// ── 1. Hero ─────────────────────────────────────────────────────────────────────────────────────

export const HERO = {
  titulo: "O sistema de gestão feito para empresas de climatização.",
  subtitulo:
    "Ordens de serviço, PMOC, equipe em campo, estoque e financeiro num só lugar. Rápido, profissional e especializado no seu setor — não é mais um sistema genérico.",
} as const;

// ── 2. A dor ────────────────────────────────────────────────────────────────────────────────────

export const DOR = {
  titulo: "Gerir uma empresa de climatização não precisa ser um caos de papel e planilha.",
  itens: [
    { icone: "os", texto: "OS perdida e técnico sem saber o que levar." },
    { icone: "pmoc", texto: "PMOC vencendo e você correndo atrás de documento." },
    { icone: "aceite", texto: "Nenhuma prova de que o cliente aceitou o serviço." },
    { icone: "equipe", texto: "Equipe sem meta nem ranking." },
    { icone: "financeiro", texto: "Financeiro, nota fiscal e cobrança espalhados." },
  ],
  fecho: "O Frivo resolve tudo isso — num lugar só, do jeito do seu setor.",
} as const;

// ── 3. Módulos (zigue-zague) ────────────────────────────────────────────────────────────────────

export interface Modulo {
  id: string;
  rotulo: string;
  titulo: string;
  texto: string;
  print: Print;
  /** Segundo print, de celular, sobreposto ao principal. */
  printCelular?: Print;
  /** Segunda tela de computador, logo abaixo do print principal. */
  printAbaixo?: Print;
  /** Mais telas do mesmo assunto, em miniaturas com legenda abaixo do print principal. */
  extras?: Print[];
  /** O print ganha a coluna larga do bloco (as telas que mais vendem). */
  printEmDestaque?: boolean;
  /** O bloco inteiro em destaque (fundo do acento + CTA). */
  destaque?: boolean;
}

export const MODULOS: Modulo[] = [
  {
    id: "ordens-de-servico",
    rotulo: "Ordens de serviço + app do técnico",
    titulo: "Da abertura da OS ao serviço na palma da mão do técnico.",
    texto:
      "Agende, distribua a equipe, acompanhe no calendário. O técnico recebe a agenda no celular, executa o checklist, tira fotos e registra medições — funciona até sem internet.",
    print: PRINTS.osAtividades,
    printCelular: PRINTS.appTecnico,
    printAbaixo: PRINTS.calendario,
    printEmDestaque: true,
  },
  {
    id: "pmoc",
    rotulo: "PMOC automático",
    titulo: "PMOC que gera as manutenções sozinho. Exigência legal, resolvida.",
    texto:
      "Monte o plano uma vez e o Frivo gera as OS de manutenção no cronograma certo (preventiva mensal, limpeza química semestral...). Emite o documento PMOC com ART, avisa antes de vencer e envia ao cliente. Renova o próximo ano em um clique.",
    print: PRINTS.pmoc,
    destaque: true,
  },
  {
    id: "aceite",
    rotulo: "Aceite e avaliação do cliente",
    titulo: "A prova de que o serviço foi entregue — e a nota do cliente.",
    texto:
      "Ao concluir, o cliente assina na hora ou confirma por um link, com registro. E avalia com estrelas. Tudo no relatório da OS.",
    print: PRINTS.aceite,
  },
  {
    id: "desempenho",
    rotulo: "Desempenho da equipe",
    titulo: "Sua equipe com meta, ranking e bônus — medidos pela qualidade.",
    texto:
      "Escore de qualidade por técnico (no prazo, relatório completo, avaliação do cliente, sem retorno), ranking por função, bônus do mês e modo TV pra parede da empresa.",
    print: PRINTS.desempenho,
    extras: [PRINTS.desempenhoTv, PRINTS.equipes],
  },
  {
    id: "equipamentos",
    rotulo: "Equipamentos com QR",
    titulo: "Cada equipamento com ficha, histórico e QR Code.",
    texto:
      "Cadastre pela foto da etiqueta, gere o QR, tenha todo o histórico. O técnico lê o QR em campo e já sabe tudo.",
    print: PRINTS.equipamento,
    printCelular: PRINTS.qrCelular,
  },
  {
    id: "estoque",
    rotulo: "Estoque, compras e materiais",
    titulo: "Controle o que entra, o que sai e o que vai pra cada serviço.",
    texto: "Estoque de peças, pedidos de compra, entrada de nota e material vinculado a cada OS.",
    print: PRINTS.estoque,
  },
  {
    id: "financeiro",
    rotulo: "Financeiro + NFS-e + Boleto",
    titulo: "Do orçamento à cobrança, sem sair do sistema.",
    texto:
      "Orçamento com aprovação por link, contas a pagar/receber, nota fiscal de serviço e cobrança por boleto/Pix, integrados.",
    print: PRINTS.orcamentoAprovado,
    printEmDestaque: true,
    extras: [PRINTS.orcamentos, PRINTS.contratos, PRINTS.financeiro],
  },
  {
    id: "mapa",
    rotulo: "Mapa da equipe",
    titulo: "Veja onde sua equipe está.",
    texto: "Acompanhe no mapa a posição dos técnicos em campo.",
    print: PRINTS.mapa,
    printEmDestaque: true,
  },
];

// ── 4. Por que Frivo ────────────────────────────────────────────────────────────────────────────

export const POR_QUE = {
  titulo: "Rápido como precisa ser. Especializado como o seu setor merece.",
  colunas: [
    { icone: "especializado", titulo: "Especializado em climatização", texto: "PMOC, equipamentos, cronogramas do seu jeito — não é genérico adaptado." },
    { icone: "rapido", titulo: "Simples e rápido", texto: "Sem burocracia; qualquer um usa sem treinamento." },
    { icone: "completo", titulo: "Completo", texto: "Campo, estoque, financeiro, fiscal e gestão de equipe num lugar só." },
  ],
} as const;

// ── 4b. Por que o Frivo existe (a origem: feito dentro de uma empresa de climatização) ──────────

export const ORIGEM = {
  titulo: "Feito por climatização. Para climatização.",
  paragrafos: [
    "O Frivo não nasceu numa sala de programadores. Nasceu dentro de uma empresa de climatização de verdade — a Termofrio Engenharia e Clima — no meio da correria de ordem de serviço, PMOC, equipe em campo e cliente esperando.",
    "Cada tela foi feita resolvendo um problema real do nosso próprio dia a dia — não é teoria de programador. Se existe no Frivo, é porque a gente precisou.",
    "Por isso ele entende o seu negócio como um sistema genérico nunca vai entender: o PMOC que a lei cobra, o técnico que precisa trabalhar sem sinal, o equipamento com histórico, a prova de que o serviço foi aceito. A gente vive isso todo dia — e colocou tudo num sistema pra você viver melhor.",
  ],
  // Depoimento do fundador (real, enviado por ele) — não é prova social de cliente
  depoimento: {
    texto: "Eu precisava de um sistema que entendesse climatização de verdade. Como não existia, a gente construiu — e hoje roda a minha empresa.",
    nome: "Edione Bonfim",
    papel: "fundador · Termofrio Engenharia e Clima",
  },
  /** Foto REAL (equipe/campo), ao lado do texto: entra quando o arquivo existir em public/marketing/prints; sem ele, o texto ocupa a linha. */
  foto: { arquivo: "foto-equipe", alt: "Equipe da Termofrio Engenharia e Clima em campo" },
} as const;

// ── 5. Como funciona ────────────────────────────────────────────────────────────────────────────

export const COMO_FUNCIONA = {
  titulo: "Como funciona",
  passos: [
    { titulo: "Crie sua conta", texto: "Grátis, sem cartão." },
    { titulo: "Cadastre clientes e equipe", texto: "Ajudamos a importar." },
    { titulo: "Comece a abrir OS hoje mesmo", texto: "" },
  ],
} as const;

// ── 6. Prova social (só dado real; vazia, a seção não aparece) ──────────────────────────────────

export interface Depoimento { texto: string; nome: string; empresa: string }
export interface NumeroReal { valor: string; rotulo: string }
export interface LogoCliente { src: string; nome: string }

export const PROVA_SOCIAL: { depoimentos: Depoimento[]; numeros: NumeroReal[]; logos: LogoCliente[] } = {
  depoimentos: [],
  numeros: [],
  logos: [],
};

// ── 7. Planos (teaser) ──────────────────────────────────────────────────────────────────────────

export const PLANOS = {
  titulo: "Comece grátis. Escolha o plano quando decidir.",
  itens: ["7 dias grátis, sem cartão.", "Planos conforme o tamanho da operação."],
} as const;

// ── 8. FAQ (respostas curtas; as completas ficam em /faq) ───────────────────────────────────────

export const FAQ: { pergunta: string; resposta: string }[] = [
  {
    pergunta: "O que é o Frivo?",
    resposta:
      "Um sistema de gestão para empresas de climatização e refrigeração: ordens de serviço, PMOC, equipe de campo, equipamentos, estoque e financeiro num só lugar.",
  },
  {
    pergunta: "Pra quem é?",
    resposta:
      "Para empresas de instalação e manutenção de climatização e refrigeração — de quem tem poucos técnicos a equipes maiores.",
  },
  {
    pergunta: "Funciona offline no campo?",
    resposta:
      "Sim. O técnico executa a OS, tira fotos e preenche tudo sem sinal; quando a internet volta, o app sincroniza sozinho.",
  },
  {
    pergunta: "Emite nota fiscal e boleto?",
    resposta: "Sim. Emite nota fiscal de serviço (NFS-e) e gera cobrança por boleto/Pix, integrados ao financeiro.",
  },
  {
    pergunta: "Tem teste grátis?",
    resposta: "Sim — 7 dias grátis, sem cartão de crédito.",
  },
  {
    pergunta: "Meus dados estão seguros (LGPD)?",
    resposta:
      "Sim. Acesso por senha e perfis de permissão, tráfego criptografado e backups. Os dados são tratados conforme a LGPD.",
  },
];

// ── 9. CTA final ────────────────────────────────────────────────────────────────────────────────

export const CTA_FINAL = {
  titulo: "Pare de perder tempo com papelada. Comece hoje.",
  subtitulo: "7 dias grátis, sem cartão. Em minutos você abre sua primeira OS.",
} as const;

// ── Navegação ───────────────────────────────────────────────────────────────────────────────────

export const MENU = [
  { href: "#recursos", rotulo: "Recursos" },
  { href: "#como-funciona", rotulo: "Como funciona" },
  { href: "#planos", rotulo: "Planos" },
  { href: "#faq", rotulo: "FAQ" },
] as const;

export const RODAPE_LINKS = [
  { href: "#planos", rotulo: "Planos" },
  { href: "/faq", rotulo: "FAQ" },
  { href: "/privacidade", rotulo: "Política de Privacidade" },
  { href: "#contato", rotulo: "Contato" },
] as const;
