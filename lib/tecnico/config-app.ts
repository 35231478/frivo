/**
 * App do colaborador (modo técnico): as permissões/autorizações do app, por empresa.
 * Este módulo é PURO (sem Prisma) — serve ao servidor (carrega de Configuracao) e ao app
 * (tipo + padrões), e trafega nas props da página do técnico (offline-first).
 *
 * Os padrões aqui espelham os @default do schema (prisma/schema.prisma, model Configuracao):
 * esconder valores, marca d'água (com o identificador da OS) e um dispositivo já vêm LIGADOS.
 */

export interface ConfigApp {
  /** Mostra nome/endereço/descrição do cliente no app */
  exibirDadosCliente: boolean;
  /** Mostra os contatos do cliente (Ligar/WhatsApp) no app */
  exibirContatosCliente: boolean;
  /** Esconde qualquer valor de produtos/serviços no app */
  esconderValores: boolean;
  /** Carimba as fotos com marca d'água (data/hora sempre) */
  marcaDagua: boolean;
  /** Marca d'água inclui o identificador da OS */
  marcaDaguaOs: boolean;
  /** Marca d'água inclui o endereço da OS */
  marcaDaguaEndereco: boolean;
  /** Marca d'água inclui as coordenadas (GPS do aparelho) */
  marcaDaguaCoordenadas: boolean;
  /** Exige localização ativa (GPS) para usar o app */
  exigirLocalizacao: boolean;
  /** Foto somente pela câmera (bloqueia a galeria) */
  fotoSomenteCamera: boolean;
  /** Exige preencher o campo de conclusão (resumo) para concluir */
  conclusaoObrigatoria: boolean;
  /** Apenas um dispositivo ativo por colaborador */
  umDispositivo: boolean;
}

export const CONFIG_APP_PADRAO: ConfigApp = {
  exibirDadosCliente: true,
  exibirContatosCliente: true,
  esconderValores: true,
  marcaDagua: true,
  marcaDaguaOs: true,
  marcaDaguaEndereco: false,
  marcaDaguaCoordenadas: false,
  exigirLocalizacao: false,
  fotoSomenteCamera: false,
  conclusaoObrigatoria: false,
  umDispositivo: true,
};

/** Os campos de Configuracao (snake→camel do Prisma) que alimentam o ConfigApp. */
export interface ConfiguracaoApp {
  appExibirDadosCliente: boolean;
  appExibirContatosCliente: boolean;
  appEsconderValores: boolean;
  appMarcaDagua: boolean;
  appMarcaDaguaOs: boolean;
  appMarcaDaguaEndereco: boolean;
  appMarcaDaguaCoordenadas: boolean;
  appExigirLocalizacao: boolean;
  appFotoSomenteCamera: boolean;
  appConclusaoObrigatoria: boolean;
  appUmDispositivo: boolean;
}

/** Os campos a selecionar de Configuracao (reuso no servidor). */
export const SELECT_CONFIG_APP = {
  appExibirDadosCliente: true,
  appExibirContatosCliente: true,
  appEsconderValores: true,
  appMarcaDagua: true,
  appMarcaDaguaOs: true,
  appMarcaDaguaEndereco: true,
  appMarcaDaguaCoordenadas: true,
  appExigirLocalizacao: true,
  appFotoSomenteCamera: true,
  appConclusaoObrigatoria: true,
  appUmDispositivo: true,
} as const;

/** ConfigApp (chaves amigáveis) → payload de Configuracao (chaves app*) para o PUT /api/configuracoes. */
export function configAppParaPayload(c: ConfigApp): ConfiguracaoApp {
  return {
    appExibirDadosCliente: c.exibirDadosCliente,
    appExibirContatosCliente: c.exibirContatosCliente,
    appEsconderValores: c.esconderValores,
    appMarcaDagua: c.marcaDagua,
    appMarcaDaguaOs: c.marcaDaguaOs,
    appMarcaDaguaEndereco: c.marcaDaguaEndereco,
    appMarcaDaguaCoordenadas: c.marcaDaguaCoordenadas,
    appExigirLocalizacao: c.exigirLocalizacao,
    appFotoSomenteCamera: c.fotoSomenteCamera,
    appConclusaoObrigatoria: c.conclusaoObrigatoria,
    appUmDispositivo: c.umDispositivo,
  };
}

/**
 * Linha de Configuracao (ou null, quando a empresa ainda não tem) → ConfigApp.
 * Row ausente = todos os padrões (a linha é criada preguiçosamente em outro lugar).
 */
export function normalizarConfigApp(row: Partial<ConfiguracaoApp> | null | undefined): ConfigApp {
  if (!row) return { ...CONFIG_APP_PADRAO };
  const ou = (v: boolean | null | undefined, padrao: boolean) => (typeof v === "boolean" ? v : padrao);
  return {
    exibirDadosCliente: ou(row.appExibirDadosCliente, CONFIG_APP_PADRAO.exibirDadosCliente),
    exibirContatosCliente: ou(row.appExibirContatosCliente, CONFIG_APP_PADRAO.exibirContatosCliente),
    esconderValores: ou(row.appEsconderValores, CONFIG_APP_PADRAO.esconderValores),
    marcaDagua: ou(row.appMarcaDagua, CONFIG_APP_PADRAO.marcaDagua),
    marcaDaguaOs: ou(row.appMarcaDaguaOs, CONFIG_APP_PADRAO.marcaDaguaOs),
    marcaDaguaEndereco: ou(row.appMarcaDaguaEndereco, CONFIG_APP_PADRAO.marcaDaguaEndereco),
    marcaDaguaCoordenadas: ou(row.appMarcaDaguaCoordenadas, CONFIG_APP_PADRAO.marcaDaguaCoordenadas),
    exigirLocalizacao: ou(row.appExigirLocalizacao, CONFIG_APP_PADRAO.exigirLocalizacao),
    fotoSomenteCamera: ou(row.appFotoSomenteCamera, CONFIG_APP_PADRAO.fotoSomenteCamera),
    conclusaoObrigatoria: ou(row.appConclusaoObrigatoria, CONFIG_APP_PADRAO.conclusaoObrigatoria),
    umDispositivo: ou(row.appUmDispositivo, CONFIG_APP_PADRAO.umDispositivo),
  };
}
