# Lead da calculadora de BTU (correção)

## O que estava quebrado

Investigando por que os leads da calculadora de BTU não chegavam no Frivo:

- **O receptor funciona.** O endpoint `/api/publico/leads` existe, é liberado no middleware e, com payload válido + as envs (`SITE_API_TOKEN`, `TERMOFRIO_EMPRESA_ID`), cria o lead certo: um **cliente origem = SITE** + um **orçamento "Lead do site — <nome>"**, que é exatamente o que a tela **Leads do site** lê. Reproduzi isso num teste real.
- **A calculadora (frontend) não está neste repositório.** Ela vive no site institucional (frivo.com.br), um projeto separado. Então o componente e o handler de envio da calculadora do site não puderam ser rastreados aqui — se o site parou de chamar o endpoint, ou passou a mandar um payload fora do formato, a correção é lá. Este PR não alcança esse repositório.
- **Mesmo com o receptor certo, o lead passava despercebido.** Dois buracos reais neste repositório:
  1. **Sem aviso no sino.** O lead só gerava um **e-mail**, e esse e-mail depende de `TERMOFRIO_EMAIL_NOTIFICACAO` estar configurado. Se não estiver (ou o Resend falhar), **nenhum aviso** — e o sino nunca mostrava "lead novo".
  2. **Falha opaca.** Erros de validação voltavam como um genérico "Dados inválidos" (sem dizer o campo), e a falta do tenant virava um 500 sem pista — difícil diagnosticar um payload do site que mudou.

## O que este PR faz

Garante que **toda submissão que chega ao Frivo** vira lead, avisa e nunca se perde em silêncio — e entrega um caminho ponta a ponta que o Frivo controla.

1. **Criação do lead num só lugar** (`lib/leads/criar-lead-site.ts`, `criarLeadDoSite`): valida com **mensagem de campo clara**, resolve a empresa (multiempresa: `TERMOFRIO_EMPRESA_ID`; sem a env, só numa instalação de uma empresa só — CO10), cria o **cliente origem = SITE** (reaproveitado por e-mail, sem duplicar) e o **orçamento "Lead do site"** com o **contato** e o **contexto do BTU** (ambiente, área, potência) na observação. Devolve `{ ok:false, erro, campo? }` em vez de sumir. O endpoint `/api/publico/leads` (com token) passou a reusar essa função.
2. **Sino + e-mail** (requisito 3): `/api/alertas` passou a contar **"novos leads do site" (24h)** (quem vê orçamentos), e o header mostra o item com link para `/leads-site`. O e-mail continua (best-effort). Agora o lead aparece no sino mesmo sem e-mail configurado.
3. **Calculadora pública first-party** (`/calculadora`, sem login): calcula o BTU por ambiente, mostra um pré-orçamento de referência e, no **"Solicitar orçamento"**, cria o lead **direto** pela função compartilhada (server action, mesma origem, sem token). **Contato obrigatório**, com mensagem clara (padrão do manifesto). É o fluxo ponta a ponta que o Frivo controla — o site pode apontar o botão da calculadora para esta página.
4. **Sem catch silencioso** (requisito 4): validação clara no cliente e no servidor; o endpoint loga e devolve o motivo; a calculadora mostra o erro na tela e não finge sucesso.

## Fora deste PR

A calculadora do site externo (frivo.com.br) — repositório separado; se for ela que parou de chamar/mandou payload errado, a correção é lá. A sugestão prática: apontar o site para `/calculadora` (hospedada pelo app) ou alinhar o payload do site ao `leadSiteSchema`.

## Banco

Nenhuma mudança de schema (🟢). Config necessária em produção: `TERMOFRIO_EMPRESA_ID` (a empresa que recebe os leads) e, para o e-mail, `TERMOFRIO_EMAIL_NOTIFICACAO`; o endpoint do site externo ainda usa `SITE_API_TOKEN`.

## Testes

`lead-site-pg` (cálculo puro de BTU; criarLeadDoSite cria cliente SITE + orçamento "Lead do site" com contato e contexto; aparece em Leads do site; o sino conta o lead com RBAC; validação clara; multiempresa; o endpoint exige token e reusa a função) e `calculadora-btu-ui` (calcula ao digitar, valida o contato, envia, mostra o sucesso; erro do servidor fica na tela).
