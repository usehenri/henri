FROM mhart/alpine-node

RUN yarn global add henri@latest

RUN mkdir /runnable

WORKDIR /runnable

COPY . /runnable

RUN yarn install --frozen-lockfile --no-cache --production --ignore-engines

RUN yarn cache clean 

EXPOSE 3000

CMD [ "henri", "server", "--production" ]