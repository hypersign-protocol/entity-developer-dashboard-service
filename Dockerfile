FROM node:20.19
WORKDIR /usr/src/app

RUN mkdir -p /geoipdb

RUN curl -o /geoipdb/GeoLite2-City.mmdb https://storage.googleapis.com/geolitecity/GeoLite2-City.mmdb

COPY ./package.json .
COPY ./tsconfig.json .
COPY ./yarn.lock .
COPY . .
RUN yarn install --frozen-lockfile
RUN yarn build
CMD ["yarn", "start:prod"]




