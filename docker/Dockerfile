FROM node:24-alpine

RUN apk --no-cache add --virtual build-deps build-base python3 git \
  && npm install -g pnpm@11.25.0

RUN pnpm add -g henri@latest

RUN mkdir /runnable

WORKDIR /runnable

RUN henri new henri-test --skip-install

WORKDIR /runnable/henri-test

RUN pnpm install --prod

EXPOSE 3000

CMD [ "henri", "server", "--production" ]
