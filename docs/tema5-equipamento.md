# Tema 5 — Quick-fixes de equipamento

**Sem mudança de banco.** Nenhum dos três itens precisou de coluna, índice ou migração.

Os três itens **já estavam resolvidos** no sistema. Este PR prova cada um com teste (não havia
nenhum para foto e série), fecha três pontas pequenas que o levantamento achou e deixa duas perguntas.

## (A) Foto comprimida no cadastro manual (limite de 4,5 MB do Vercel)

### O que já existia
- A galeria do cadastro (`components/ui/galeria-imagens.tsx`) **reduz a foto ao escolher**: lado maior
  1280 px, JPEG qualidade 0,8 — a foto do celular (3–8 MB) vira ~150–400 KB. Máximo de 5 fotos.
- No envio, `aliviarFotos` recomprime foto **antiga** (salva antes da compressão) acima de 600 KB.
- Se ainda assim o servidor recusar (413), a tela diz para remover alguma foto.

### O que mudou
- **O total do conjunto passou a ser conferido.** Cada foto era olhada sozinha: cinco antigas de até
  600 KB passavam uma a uma e, juntas, encostavam no limite. Agora, se o conjunto passar de 2,8 MB
  (~3,7 MB em base64, com folga para o resto do cadastro), as maiores são reduzidas mais um pouco
  (1024 px, qualidade 0,7) até caber. Só o necessário, da maior para a menor; nenhuma foto some.
- Testes (não havia): a galeria reduz na escolha, recusa o que não é imagem, respeita o máximo, e uma
  foto ilegível não trava as outras; `aliviarFotos` em foto antiga grande, no total e nos casos de falha.

## (B) Numeração do QR Code depois do 9999

### O que já existia
- O QR Code usa o **mesmo contador** da OS (`lib/numeracao-server.ts`): o maior já usado é lido como
  **número** (não como texto), sob trava, por empresa. É a mesma correção da OS — foi feita para todos
  os documentos de uma vez. Os códigos novos saem como `QR-10000` (sem ano, sem zeros à esquerda).

### O que mudou
- Só teste, com Postgres real: histórico até `QR-2026-9999` → o próximo é `QR-10000`; depois 10001,
  10002…; 20 gerações ao mesmo tempo não repetem nem pulam; outra empresa segue a própria sequência.

## (C) Aviso de nº de série duplicado (só aviso)

### O que já existia
- Cadastro completo (novo e edição) e cadastro por foto mostram o aviso
  `components/equipamentos/aviso-serie-duplicada.tsx`: qual equipamento já tem a série, onde está, com
  link para conferir, e "Apenas um aviso: é possível salvar assim mesmo."
- A consulta (`GET /api/equipamentos/serie`) ignora maiúsculas e espaços nas pontas, só olha a empresa
  e, na edição, ignora o próprio equipamento.

### O que mudou
- **Cadastro rápido de equipamento** (o "Novo equipamento" de dentro da OS) não avisava. Agora mostra
  o mesmo aviso. Continua sendo só aviso.
- O cadastro rápido passa a gravar a série **sem espaços nas pontas** (o completo já fazia).
- Testes (não havia): a consulta com Postgres real e o aviso na tela, nos três lugares.

## Perguntas para o Zé
1. **Série repetida dentro do mesmo envio em lote** (cadastro por foto com várias etiquetas na mesma
   leva): o aviso compara com o que já está gravado, não com as outras fotos da mesma leva. Quer que
   avise também nesse caso?
2. **App do técnico:** quando o técnico cadastra/edita equipamento em campo, não há aviso de série
   (a consulta precisa de sinal e da permissão do painel). Vale levar o aviso para o app, só quando
   houver sinal?

## Testes
- `tema5-fotos` (5): `aliviarFotos`.
- `tema5-equipamento-ui` (11): galeria, aviso de série, cadastro rápido.
- `tema5-equipamento-pg` (10, Postgres real): QR depois do 9999 e a consulta de série.

## Prints
`docs/prints/tema5-equipamento/` — desktop e celular.
