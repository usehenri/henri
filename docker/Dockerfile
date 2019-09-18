FROM mhart/alpine-node

RUN apk --no-cache add --virtual builds-deps build-base python git

RUN yarn global add henri@latest

RUN mkdir /runnable

WORKDIR /runnable

RUN henri new henri-test

WORKDIR /runnable/henri-test

RUN yarn install --no-cache --production

EXPOSE 3000

CMD [ "henri", "server", "--production" ]