# Halftone Platform

Plataforma de alunos em Next.js, PostgreSQL e Prisma, pronta para build via GitHub e Portainer. O stack usa o PostgreSQL já existente na VPS.

## Deploy no Portainer

1. Crie um banco e um usuário para a plataforma no PostgreSQL existente, caso ainda não existam.
2. Crie um stack a partir deste repositório e configure as variáveis de `.env.example`.
3. Troque `AUTH_SECRET`, `N8N_WEBHOOK_SECRET`, `ADMIN_PASSWORD` e `NEXT_PUBLIC_HOTMART_CHECKOUT_URL`.
4. Em `DATABASE_URL`, use o endereço que o container consegue alcançar. Se o PostgreSQL estiver publicado na VPS, normalmente será o IP privado ou hostname da VPS, por exemplo `postgresql://halftone:SENHA@10.0.0.10:5432/halftone`.
5. Faça o build/redeploy. O container aplica o schema, cria/atualiza o admin e inicia a aplicação na porta `3000`.

O `docker-compose.yml` não cria banco, volume ou serviço PostgreSQL local.

## Integração n8n

Envie `POST /api/integration/provision` com o header `x-n8n-secret` e um JSON com `name`, `email`, `hotmartId` e opcionalmente `password`. O endpoint é idempotente: uma nova compra atualiza o cadastro existente e reativa o acesso.

O checkout exibido na tela de login é definido por `NEXT_PUBLIC_HOTMART_CHECKOUT_URL`.

## Halftone Studio

Usuários com `accessStatus=ACTIVE` acessam `/halftone` pelo painel. O preview usa Canvas no navegador; a exportação envia a imagem para `POST /api/halftone`, que processa PNG, JPG, WEBP ou TIFF com ImageMagick e retorna um PNG transparente. Os parâmetros aceitos são `lpi` (10-120), `angle` (-90 a 90), `dpi` (150-600) e `dot` (`fine`, `standard` ou `soft`).