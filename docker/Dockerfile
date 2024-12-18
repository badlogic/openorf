FROM node:23

WORKDIR /app/docker

# Install ffmpeg explicitly
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

CMD ["./server.sh"]