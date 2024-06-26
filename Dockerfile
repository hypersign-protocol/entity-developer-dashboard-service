FROM node:16
WORKDIR /usr/src/app
COPY ./package.json .
COPY ./tsconfig.json .
RUN npm cache clean --force
RUN npm install
COPY . .
RUN npm run build
CMD ["npm","run", "start"]




