FROM node:16
WORKDIR /usr/src/app

RUN mkdir -p /geoipdb

RUN curl -o /geoipdb/GeoLite2-City.mmdb https://storage.googleapis.com/geolitecity/GeoLite2-City.mmdb

COPY ./package.json .
COPY ./tsconfig.json .
RUN npm cache clean --force
RUN npm install
COPY . .
RUN npm run build
CMD ["npm","run", "start"]




