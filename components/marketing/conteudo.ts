/**
 * Home de vendas do Frivo (rota "/"): TODO o conteúdo num arquivo só — textos do briefing, a lista dos
 * prints e os links. Trocar um texto, o destino do CTA ou o contato é mexer aqui; a página só diagrama.
 *
 * Regras do briefing: um CTA primário repetido, nenhum número de cliente ou depoimento inventado
 * (PROVA_SOCIAL nasce vazia) e os prints e a foto ficam como espaços reservados nomeados até os
 * arquivos reais chegarem (ver public/marketing/prints/LEIA-ME.md).
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

/**
 * Enquanto houver espaço reservado (prints, foto, prova social), a página fica fora dos buscadores.
 * No lançamento, com as telas reais no lugar: `true`.
 */
export const PUBLICADA = false;

/** Contato do rodapé e da página do teste grátis. O link do WhatsApp sai dos dígitos do número (DDI 55). */
export const CONTATO = { whatsapp: "(62) 99999-9999", email: "contato@termofrioengenharia.com.br" } as const;
export const LINK_WHATSAPP = `https://wa.me/55${CONTATO.whatsapp.replace(/\D/g, "")}`;
export const LINK_EMAIL = `mailto:${CONTATO.email}`;

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
  /** Número na lista do briefing (1 a 10). */
  n: number;
  /** Nome do arquivo em public/marketing/prints, SEM extensão (.webp, .avif, .png ou .jpg). */
  arquivo: string;
  /** Qual tela do sistema entra aqui. */
  tela: string;
  formato: FormatoPrint;
  /** Texto alternativo da imagem real. */
  alt: string;
}

export const PRINTS = {
  dashboard: { n: 1, arquivo: "01-dashboard", tela: "Dashboard", formato: "desktop", alt: "Painel do Frivo com os indicadores do dia" },
  calendario: { n: 2, arquivo: "02-calendario-os", tela: "Calendário de OS", formato: "desktop", alt: "Calendário de ordens de serviço com a equipe distribuída" },
  appTecnico: { n: 3, arquivo: "03-app-tecnico", tela: "App do técnico (Meu dia / execução)", formato: "celular", alt: "App do técnico com a agenda do dia" },
  pmoc: { n: 4, arquivo: "04-pmoc", tela: "PMOC (cronograma + documento PDF)", formato: "desktop", alt: "Cronograma do PMOC e o documento gerado" },
  aceite: { n: 5, arquivo: "05-aceite", tela: "Aceite (assinatura + estrelas)", formato: "celular", alt: "Aceite do cliente com assinatura e avaliação em estrelas" },
  desempenho: { n: 6, arquivo: "06-desempenho", tela: "Desempenho (ranking + TV)", formato: "desktop", alt: "Ranking de desempenho da equipe" },
  equipamento: { n: 7, arquivo: "07-equipamento-qr", tela: "Equipamento + QR", formato: "desktop", alt: "Ficha do equipamento com histórico e QR Code" },
  estoque: { n: 8, arquivo: "08-estoque-materiais", tela: "Estoque / materiais na OS", formato: "desktop", alt: "Materiais do estoque vinculados à ordem de serviço" },
  financeiro: { n: 9, arquivo: "09-orcamento-financeiro", tela: "Orçamento aprovado + financeiro", formato: "desktop", alt: "Orçamento aprovado e o financeiro" },
  mapa: { n: 10, arquivo: "10-mapa-tecnicos", tela: "Mapa dos técnicos", formato: "desktop", alt: "Mapa com a posição dos técnicos em campo" },
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
  destaque?: boolean;
}

export const MODULOS: Modulo[] = [
  {
    id: "ordens-de-servico",
    rotulo: "Ordens de serviço + app do técnico",
    titulo: "Da abertura da OS ao serviço na palma da mão do técnico.",
    texto:
      "Agende, distribua a equipe, acompanhe no calendário. O técnico recebe a agenda no celular, executa o checklist, tira fotos e registra medições — funciona até sem internet.",
    print: PRINTS.calendario,
    printCelular: PRINTS.appTecnico,
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
  },
  {
    id: "equipamentos",
    rotulo: "Equipamentos com QR",
    titulo: "Cada equipamento com ficha, histórico e QR Code.",
    texto:
      "Cadastre pela foto da etiqueta, gere o QR, tenha todo o histórico. O técnico lê o QR em campo e já sabe tudo.",
    print: PRINTS.equipamento,
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
    print: PRINTS.financeiro,
  },
  {
    id: "mapa",
    rotulo: "Mapa da equipe",
    titulo: "Veja onde sua equipe está.",
    texto: "Acompanhe no mapa a posição dos técnicos em campo.",
    print: PRINTS.mapa,
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
  /** Foto REAL (equipe/campo), ao lado do texto. Mesmo esquema dos prints: o arquivo com este nome troca o espaço reservado. */
  foto: { arquivo: "foto-equipe", descricao: "Foto real · equipe / campo", alt: "Equipe da Termofrio Engenharia e Clima em campo" },
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

// ── 6. Prova social (VAZIA de propósito: só entra dado real) ────────────────────────────────────

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
