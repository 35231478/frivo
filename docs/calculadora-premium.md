# Calculadora de BTU premium (lead magnet)

A página pública `/calculadora` reconstruída como uma experiência premium e interativa — um wizard (uma pergunta por vez) com uma **cena do "projeto" que se forma em tempo real** conforme o cliente responde. O site da Termofrio aponta o botão da calculadora para cá. **A regra de BTU e a captura do lead são as que já existiam** — só a experiência/visual é nova.

## O que é novo

- **Wizard** (`components/publico/calculadora-wizard.tsx`): uma pergunta por vez (tipo de ambiente → tamanho m² → pessoas → sol → aparelhos que esquentam → último andar/cobertura), com transições suaves (`anim-calc-entra`). Suporta **ambientes pequenos e grandes** e **vários ambientes** (Adicionar ambiente; cada um calculado). No fim: o resultado com o BTU recomendado por ambiente, o equipamento, e o pré-orçamento (equipamentos + instalação, somando todos), com os CTAs **"Quero meu orçamento detalhado"** (captura o lead) e **"Falar no WhatsApp"**.
- **Cena do projeto** (`components/publico/cena-projeto.tsx`): um cômodo isométrico vetorial (painel escuro premium) que **cresce com a área** e mostra o **equipamento recomendado instalado**, adaptando a ilustração à forma:
  - pequeno → **hi-wall** na parede;
  - médio/grande → **piso-teto** (gabinete) ou **cassete** (embutido no teto);
  - vários ambientes / grande porte → **multisplit / VRF** (unidade externa + várias internas).
  Sai um **ar frio com flocos** da unidade (SVG + CSS), com brilho frio de fundo. Tudo por token (`cena-*`), sem emoji, e o movimento respeita `prefers-reduced-motion` (`app/globals.css`).

## O que foi reaproveitado (não refeito)

- **Cálculo de BTU** (`lib/leads/btu.ts`): a base por m² e os fatores pessoas/sol são os de sempre. Estendido de forma **aditiva e opcional**: mais tipos de ambiente (quarto, sala, cozinha, escritório, loja, salão, galpão), os fatores **aparelhos** (+600 cada) e **cobertura** (+10%) — sem efeito quando ausentes, então quem não os informa tem o mesmo resultado de antes —, e a **recomendação de equipamento** por capacidade (`equipamentoDoAmbiente`) e de conjunto (`recomendarConjunto` → multisplit/VRF).
- **Captura do lead** (`lib/leads/criar-lead-site.ts` via a server action `enviarLead`): intocada. O lead continua virando **cliente origem = SITE** + **orçamento "Lead do site"**, cai na empresa do `TERMOFRIO_EMPRESA_ID` (multiempresa), e os erros aparecem claros na tela (sem catch silencioso).

## Design

- Tokens novos da cena em `lib/ui/tokens.ts` (`cena`: painel escuro petróleo, ciano do "frio", parede/piso/equipamento/neve) + tailwind. Só esta superfície de marketing usa — o app interno segue claro.
- Animações em `app/globals.css` (fora do ratchet): `calcFloco`, `calcArFrio`, `calcBrilho`, `calcEntra`, todas desligadas em `prefers-reduced-motion`.
- Passa no ratchet (sem hex cru nos componentes, sem emoji, tom impessoal), responsivo (a cena empilha no celular) e acessível (SVG com `role`/`aria-label`, foco e alvos de toque).

## WhatsApp

O número do botão "Falar no WhatsApp" vem de `TERMOFRIO_WHATSAPP` (env) ou do cadastro da empresa (celular/telefone), resolvido no servidor.

## Fora (de propósito)

A calculadora do repositório termofrio-site (separada — será apontada para cá). Mudar a regra de BTU ou a captura do lead.

## Testes

`btu-calculo` (fatores aditivos, aparelhos/cobertura sem efeito quando ausentes, equipamento por capacidade, conjunto multisplit/VRF), `calculadora-wizard-ui` (uma pergunta por vez, a cena reage ao tamanho/tipo, vários ambientes recomendam o conjunto, captura o lead, erro na tela, link do WhatsApp) e `lead-site-pg` (o lead segue criado como antes).
