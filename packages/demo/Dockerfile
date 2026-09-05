FROM node:24-alpine

RUN npm install -g pnpm@11.25.0

RUN pnpm add -g henri@latest

RUN mkdir /runnable

WORKDIR /runnable

COPY . /runnable

RUN pnpm install --frozen-lockfile --prod

EXPOSE 3000

CMD [ "henri", "server", "--production" ]
