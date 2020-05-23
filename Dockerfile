FROM node:stretch
LABEL maintainer="Shanti Naik <visitsb@gmail.com>"

ADD . /app/
WORKDIR /app

# Fetch required npm packages
RUN /usr/local/bin/yarn install \
  && /usr/local/bin/yarn upgrade \
  && /bin/rm -rf logs \
  ; exit 0

VOLUME /logs

ENTRYPOINT ["/usr/local/bin/node", "app.js"]
CMD ["--config", "somnus.yml"]
