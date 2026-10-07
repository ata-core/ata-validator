FROM node:22-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8
RUN apt-get update && apt-get install -y libre2-dev libabsl-dev libmimalloc-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/app
RUN npm init -y && npm install ata-validator@1.46.1
COPY bowtie_ata.js .
CMD ["node", "bowtie_ata.js"]
