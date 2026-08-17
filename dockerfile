FROM node:20-alpine

COPY ./Backend .
 
RUN npm install

CMD ["node", "src/index.js"]