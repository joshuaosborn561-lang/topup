# ECR Public mirror of Docker Hub library/node. Railway hits Docker Hub
# 429s on node:22-bookworm-slim; this tag is the same image.
FROM public.ecr.aws/docker/library/node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY tsconfig.json ./
COPY src ./src
COPY CANON.md ./CANON.md
COPY supabase ./supabase
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["npm", "run", "start"]
