# 
FROM node:18-alpine

# 
WORKDIR /usr/learnhouse/front

# 
COPY package.json /usr/learnhouse/front/package.json

# 
RUN npm install

# 
COPY ./ /usr/learnhouse

# 
CMD ["npm", "run", "dev"]