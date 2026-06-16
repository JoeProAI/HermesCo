FROM node:22-bookworm-slim

# Install git (required for openclaw npm install)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install openclaw globally
RUN npm install -g openclaw@latest

WORKDIR /app

# Copy and install gateway dependencies
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
